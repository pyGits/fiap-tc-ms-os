import MessageConsumer from "../../src/messaging/MessageConsumer";
import MessagePublisher from "../../src/messaging/MessagePublisher";
import RabbitMQMensageriaGateway from "../../src/messaging/RabbitMQMensageriaGateway";
import SagaReplyConsumer from "../../src/messaging/SagaReplyConsumer";
import {
  EXCHANGE,
  FILAS,
  Mensagem,
  ROUTING_KEYS,
  TipoEvento,
  TipoResposta,
} from "../../src/messaging/contracts";
import { runComContexto } from "../../src/context";

// --------------------------------------------------------------------------
// Dubles do amqplib
// --------------------------------------------------------------------------

type Publicacao = {
  exchange: string;
  routingKey: string;
  conteudo: Record<string, unknown>;
};

class CanalFake {
  readonly publicadas: Publicacao[] = [];
  readonly confirmadas: unknown[] = [];
  readonly rejeitadas: Array<{ requeue: boolean }> = [];
  manipulador?: (raw: unknown) => Promise<void>;

  publish(exchange: string, routingKey: string, conteudo: Buffer) {
    this.publicadas.push({
      exchange,
      routingKey,
      conteudo: JSON.parse(conteudo.toString()),
    });
    return true;
  }

  async consume(_fila: string, manipulador: (raw: unknown) => Promise<void>) {
    this.manipulador = manipulador;
    return { consumerTag: "tag" };
  }

  ack(mensagem: unknown) {
    this.confirmadas.push(mensagem);
  }

  nack(_mensagem: unknown, _todas: boolean, requeue: boolean) {
    this.rejeitadas.push({ requeue });
  }
}

class ConexaoFake {
  constructor(readonly canal = new CanalFake()) {}
  async getChannel() {
    return this.canal as never;
  }
  async close() {}
}

// Envelope como o amqplib entrega ao consumidor.
function envelope(mensagem: Mensagem, routingKey = ROUTING_KEYS.SAGA_REPLY) {
  return {
    content: Buffer.from(JSON.stringify(mensagem)),
    fields: { routingKey, deliveryTag: 1 },
    properties: {},
  };
}

function mensagemReply(
  tipo: TipoResposta,
  body: Record<string, unknown>,
  mensagemId = "msg-1",
  tentativa = 1,
): Mensagem {
  return {
    header: {
      mensagemId,
      sagaId: "saga-1",
      correlationId: "corr-1",
      ordemServicoId: "os-1",
      tipo,
      origem: "teste",
      dataEnvio: new Date().toISOString(),
      tentativa,
    },
    body,
  };
}

// --------------------------------------------------------------------------

describe("MessagePublisher", () => {
  it("monta o header padronizado e publica de forma persistente", async () => {
    const conexao = new ConexaoFake();
    const publisher = new MessagePublisher(conexao as never, "servico-teste");

    await runComContexto({ correlationId: "corr-ctx", sagaId: "saga-1" }, () =>
      publisher.publicar({
        routingKey: ROUTING_KEYS.BILLING_COMANDOS,
        tipo: TipoResposta.ORCAMENTO_GERADO,
        sagaId: "saga-1",
        ordemServicoId: "os-1",
        body: { valor: 10 },
      }),
    );

    const publicada = conexao.canal.publicadas[0];
    const header = (publicada.conteudo as { header: Record<string, unknown> })
      .header;

    expect(publicada.exchange).toBe(EXCHANGE);
    expect(publicada.routingKey).toBe(ROUTING_KEYS.BILLING_COMANDOS);
    // O correlationId vem do AsyncLocalStorage: e o que costura o trace
    // distribuido entre os tres microsservicos.
    expect(header.correlationId).toBe("corr-ctx");
    expect(header.origem).toBe("servico-teste");
    expect(header.tentativa).toBe(1);
    expect(header.mensagemId).toBeTruthy();
  });

  it("gera correlationId proprio quando nao ha contexto", async () => {
    const conexao = new ConexaoFake();
    const publisher = new MessagePublisher(conexao as never);

    const header = await publisher.publicar({
      routingKey: ROUTING_KEYS.EVENTOS,
      tipo: TipoEvento.OS_CRIADA,
      sagaId: "saga-1",
      ordemServicoId: "os-1",
      body: {},
    });

    expect(header.correlationId).toBeTruthy();
  });
});

describe("RabbitMQMensageriaGateway", () => {
  it("roteia cada comando para a fila do participante correto", async () => {
    const conexao = new ConexaoFake();
    const gateway = new RabbitMQMensageriaGateway(
      new MessagePublisher(conexao as never, "os"),
    );
    const ctx = { sagaId: "saga-1", ordemServicoId: "os-1" };

    await gateway.enviarGerarOrcamento(ctx, {
      clienteId: "c1",
      veiculoId: "v1",
      itens: [],
    });
    await gateway.enviarCancelarOrcamento(ctx, { motivo: "rollback" });
    await gateway.enviarRegistrarPagamento(ctx, {
      orcamentoId: "orc-1",
      valor: 10,
      clienteId: "c1",
    });
    await gateway.enviarEstornarPagamento(ctx, { motivo: "rollback" });
    await gateway.enviarEnfileirarExecucao(ctx, {
      clienteId: "c1",
      veiculoId: "v1",
      itens: [],
    });
    await gateway.enviarCancelarExecucao(ctx, { motivo: "rollback" });
    await gateway.publicarEvento(ctx, TipoEvento.SAGA_CONCLUIDA, {});

    const rotas = conexao.canal.publicadas.map((item) => item.routingKey);

    expect(rotas).toEqual([
      ROUTING_KEYS.BILLING_COMANDOS,
      ROUTING_KEYS.BILLING_COMANDOS,
      ROUTING_KEYS.BILLING_COMANDOS,
      ROUTING_KEYS.BILLING_COMANDOS,
      ROUTING_KEYS.EXECUCAO_COMANDOS,
      ROUTING_KEYS.EXECUCAO_COMANDOS,
      ROUTING_KEYS.EVENTOS,
    ]);
  });
});

describe("MessageConsumer", () => {
  it("restaura o contexto e confirma a mensagem processada", async () => {
    const conexao = new ConexaoFake();
    const consumer = new MessageConsumer(conexao as never);

    let correlationVisto: string | undefined;
    await consumer.consumir(FILAS.SAGA_REPLY, {
      [TipoResposta.ORCAMENTO_GERADO]: async () => {
        const { getCorrelationId } = await import("../../src/context");
        correlationVisto = getCorrelationId() ?? undefined;
      },
    });

    await conexao.canal.manipulador!(
      envelope(mensagemReply(TipoResposta.ORCAMENTO_GERADO, {})),
    );

    expect(correlationVisto).toBe("corr-1");
    expect(conexao.canal.confirmadas).toHaveLength(1);
  });

  it("descarta mensagem duplicada (idempotencia por mensagemId)", async () => {
    const conexao = new ConexaoFake();
    const consumer = new MessageConsumer(conexao as never);

    let execucoes = 0;
    await consumer.consumir(FILAS.SAGA_REPLY, {
      [TipoResposta.ORCAMENTO_GERADO]: async () => {
        execucoes += 1;
      },
    });

    const mensagem = envelope(
      mensagemReply(TipoResposta.ORCAMENTO_GERADO, {}, "msg-duplicada"),
    );
    await conexao.canal.manipulador!(mensagem);
    await conexao.canal.manipulador!(mensagem);

    expect(execucoes).toBe(1);
    expect(consumer.jaProcessada("msg-duplicada")).toBe(true);
  });

  it("rejeita sem reenfileirar quando o JSON e invalido", async () => {
    const conexao = new ConexaoFake();
    const consumer = new MessageConsumer(conexao as never);

    await consumer.consumir(FILAS.SAGA_REPLY, {});

    await conexao.canal.manipulador!({
      content: Buffer.from("isto nao e json"),
      fields: { routingKey: ROUTING_KEYS.SAGA_REPLY },
    });

    expect(conexao.canal.rejeitadas).toEqual([{ requeue: false }]);
  });

  it("confirma mensagem sem manipulador registrado em vez de travar a fila", async () => {
    const conexao = new ConexaoFake();
    const consumer = new MessageConsumer(conexao as never);

    await consumer.consumir(FILAS.SAGA_REPLY, {});
    await conexao.canal.manipulador!(
      envelope(mensagemReply(TipoResposta.EXECUCAO_CANCELADA, {})),
    );

    expect(conexao.canal.confirmadas).toHaveLength(1);
    expect(conexao.canal.publicadas).toHaveLength(0);
  });

  it("reenfileira com tentativa incrementada quando o processamento falha", async () => {
    const conexao = new ConexaoFake();
    const consumer = new MessageConsumer(conexao as never, 3);

    await consumer.consumir(FILAS.SAGA_REPLY, {
      [TipoResposta.ORCAMENTO_GERADO]: async () => {
        throw new Error("falha transitoria");
      },
    });

    await conexao.canal.manipulador!(
      envelope(mensagemReply(TipoResposta.ORCAMENTO_GERADO, {}, "msg-1", 1)),
    );

    const republicada = conexao.canal.publicadas[0];
    const header = (republicada.conteudo as { header: { tentativa: number } })
      .header;

    expect(republicada.routingKey).toBe(ROUTING_KEYS.SAGA_REPLY);
    expect(header.tentativa).toBe(2);
    // A mensagem original e confirmada: a nova copia ja esta na fila.
    expect(conexao.canal.confirmadas).toHaveLength(1);
  });

  it("envia para a dead letter ao esgotar as tentativas", async () => {
    const conexao = new ConexaoFake();
    const consumer = new MessageConsumer(conexao as never, 3);

    await consumer.consumir(FILAS.SAGA_REPLY, {
      [TipoResposta.ORCAMENTO_GERADO]: async () => {
        throw new Error("falha permanente");
      },
    });

    await conexao.canal.manipulador!(
      envelope(mensagemReply(TipoResposta.ORCAMENTO_GERADO, {}, "msg-1", 3)),
    );

    expect(conexao.canal.publicadas[0].routingKey).toBe(
      ROUTING_KEYS.DEAD_LETTER,
    );
    expect(conexao.canal.publicadas[0].conteudo).toHaveProperty("falha");
  });

  it("ignora entrega nula do broker", async () => {
    const conexao = new ConexaoFake();
    const consumer = new MessageConsumer(conexao as never);

    await consumer.consumir(FILAS.SAGA_REPLY, {});
    await conexao.canal.manipulador!(null);

    expect(conexao.canal.confirmadas).toHaveLength(0);
  });
});

describe("SagaReplyConsumer", () => {
  // Dublê do orquestrador: registra qual metodo cada resposta acionou.
  function orquestradorFake() {
    const chamadas: Array<{ metodo: string; args: unknown[] }> = [];
    const registrar =
      (metodo: string) =>
      async (...args: unknown[]) => {
        chamadas.push({ metodo, args });
      };

    return {
      chamadas,
      orquestrador: {
        orcamentoGerado: registrar("orcamentoGerado"),
        orcamentoFalhou: registrar("orcamentoFalhou"),
        pagamentoRegistrado: registrar("pagamentoRegistrado"),
        pagamentoFalhou: registrar("pagamentoFalhou"),
        execucaoEnfileirada: registrar("execucaoEnfileirada"),
        execucaoFalhou: registrar("execucaoFalhou"),
      } as never,
    };
  }

  it("roteia cada resposta para o metodo correspondente do orquestrador", async () => {
    const { chamadas, orquestrador } = orquestradorFake();
    const conexao = new ConexaoFake();
    const consumer = new SagaReplyConsumer(
      orquestrador,
      new MessageConsumer(conexao as never),
    );

    const manipuladores = consumer.manipuladores();

    await manipuladores[TipoResposta.ORCAMENTO_GERADO](
      mensagemReply(TipoResposta.ORCAMENTO_GERADO, {
        orcamentoId: "orc-1",
        valorTotal: "450",
      }),
    );
    await manipuladores[TipoResposta.PAGAMENTO_REGISTRADO](
      mensagemReply(TipoResposta.PAGAMENTO_REGISTRADO, { pagamentoId: "pag-1" }),
    );
    await manipuladores[TipoResposta.EXECUCAO_ENFILEIRADA](
      mensagemReply(TipoResposta.EXECUCAO_ENFILEIRADA, { execucaoId: "exec-1" }),
    );

    expect(chamadas.map((item) => item.metodo)).toEqual([
      "orcamentoGerado",
      "pagamentoRegistrado",
      "execucaoEnfileirada",
    ]);
    // O valor chega como string no JSON e precisa ser numerico no dominio.
    expect(chamadas[0].args).toEqual(["saga-1", "orc-1", 450]);
  });

  it("repassa o motivo das falhas, com texto padrao quando ausente", async () => {
    const { chamadas, orquestrador } = orquestradorFake();
    const conexao = new ConexaoFake();
    const consumer = new SagaReplyConsumer(
      orquestrador,
      new MessageConsumer(conexao as never),
    );
    const manipuladores = consumer.manipuladores();

    await manipuladores[TipoResposta.ORCAMENTO_FALHOU](
      mensagemReply(TipoResposta.ORCAMENTO_FALHOU, {}),
    );
    await manipuladores[TipoResposta.PAGAMENTO_FALHOU](
      mensagemReply(TipoResposta.PAGAMENTO_FALHOU, { motivo: "Cartao recusado" }),
    );
    await manipuladores[TipoResposta.EXECUCAO_FALHOU](
      mensagemReply(TipoResposta.EXECUCAO_FALHOU, { motivo: "Fila cheia" }),
    );

    expect(chamadas[0].args[1]).toBe("Falha ao gerar o orcamento.");
    expect(chamadas[1].args[1]).toBe("Cartao recusado");
    expect(chamadas[2].args[1]).toBe("Fila cheia");
  });

  it("aciona o manipulador de finalizacao quando a execucao termina", async () => {
    const { orquestrador } = orquestradorFake();
    const conexao = new ConexaoFake();
    const finalizadas: Array<[string, string]> = [];

    const consumer = new SagaReplyConsumer(
      orquestrador,
      new MessageConsumer(conexao as never),
      async (ordemServicoId, execucaoId) => {
        finalizadas.push([ordemServicoId, execucaoId]);
      },
    );

    await consumer.manipuladores()[TipoResposta.EXECUCAO_FINALIZADA](
      mensagemReply(TipoResposta.EXECUCAO_FINALIZADA, {
        execucaoId: "exec-1",
        finalizadaEm: new Date().toISOString(),
      }),
    );

    expect(finalizadas).toEqual([["os-1", "exec-1"]]);
  });

  it("nao quebra quando a finalizacao chega sem manipulador configurado", async () => {
    const { orquestrador } = orquestradorFake();
    const conexao = new ConexaoFake();
    const consumer = new SagaReplyConsumer(
      orquestrador,
      new MessageConsumer(conexao as never),
    );

    await expect(
      consumer.manipuladores()[TipoResposta.EXECUCAO_FINALIZADA](
        mensagemReply(TipoResposta.EXECUCAO_FINALIZADA, { execucaoId: "e" }),
      ),
    ).resolves.toBeUndefined();
  });

  it("apenas registra as confirmacoes de compensacao", async () => {
    const { chamadas, orquestrador } = orquestradorFake();
    const conexao = new ConexaoFake();
    const consumer = new SagaReplyConsumer(
      orquestrador,
      new MessageConsumer(conexao as never),
    );
    const manipuladores = consumer.manipuladores();

    await manipuladores[TipoResposta.ORCAMENTO_CANCELADO](
      mensagemReply(TipoResposta.ORCAMENTO_CANCELADO, {}),
    );
    await manipuladores[TipoResposta.PAGAMENTO_ESTORNADO](
      mensagemReply(TipoResposta.PAGAMENTO_ESTORNADO, {}),
    );
    await manipuladores[TipoResposta.EXECUCAO_CANCELADA](
      mensagemReply(TipoResposta.EXECUCAO_CANCELADA, {}),
    );

    // Compensacoes nao avancam a Saga: o orquestrador ja marcou os passos.
    expect(chamadas).toHaveLength(0);
  });

  it("registra o consumidor na fila de reply ao iniciar", async () => {
    const { orquestrador } = orquestradorFake();
    const conexao = new ConexaoFake();
    const consumer = new SagaReplyConsumer(
      orquestrador,
      new MessageConsumer(conexao as never),
    );

    await consumer.iniciar();

    expect(conexao.canal.manipulador).toBeDefined();
  });
});
