import assert from "assert";
import { Before, DataTable, Given, Then, When } from "@cucumber/cucumber";

import Cliente from "../../../domain/entity/Cliente";
import Veiculo from "../../../domain/entity/Veiculo";
import MensageriaGatewayMemoria from "../../../domain/gateway/Mock/MensageriaGatewayMemoria";
import { criarContainer, Container } from "../../../src/container";

// Estado compartilhado entre os passos de um cenario.
//
// Os participantes da Saga (Billing e Execucao) sao representados pelas suas
// RESPOSTAS: cada passo "Quando o servico X responde..." chama o metodo do
// orquestrador que o consumidor da fila de reply chamaria ao receber a
// mensagem. Assim o cenario exercita a Saga inteira - inclusive o rollback -
// sem subir RabbitMQ, MySQL nem os outros dois servicos.
type Mundo = {
  container: Container;
  mensageria: MensageriaGatewayMemoria;
  clienteId: string;
  veiculoId: string;
  ordemServicoId: string;
  sagaId: string;
  erro?: Error;
};

let mundo: Mundo;

const COMPENSACOES = [
  "CANCELAR_EXECUCAO",
  "ESTORNAR_PAGAMENTO",
  "CANCELAR_ORCAMENTO",
];

Before(() => {
  const container = criarContainer();
  mundo = {
    container,
    mensageria: container.mensageria as MensageriaGatewayMemoria,
    clienteId: "",
    veiculoId: "",
    ordemServicoId: "",
    sagaId: "",
  };
});

// ---------------------------------------------------------------------------
// Contexto
// ---------------------------------------------------------------------------

Given("um cliente cadastrado com o documento {string}", async (documento: string) => {
  const cliente = new Cliente({
    documento,
    nome: "Cliente Demonstracao",
    email: "cliente.demo@oficina.local",
  });
  await mundo.container.clienteRepository.salvar(cliente);
  mundo.clienteId = cliente.id.getValue();
});

Given(
  "um veiculo {string} vinculado a esse cliente",
  async (placa: string) => {
    const veiculo = new Veiculo({
      placa,
      clienteId: mundo.clienteId,
      marca: "Volkswagen",
      modelo: "Gol",
      ano: 2019,
    });
    await mundo.container.veiculoRepository.salvar(veiculo);
    mundo.veiculoId = veiculo.id.getValue();
  },
);

Given(
  "o catalogo contendo o servico {string} no valor de {float}",
  async (id: string, valor: number) => {
    const item = await mundo.container.catalogoRepository.obter(id);
    assert.ok(item, `Item ${id} deveria existir no catalogo`);
    assert.strictEqual(item.valorUnitario, valor);
  },
);

// ---------------------------------------------------------------------------
// Acoes do cliente (entrada sincrona, por REST)
// ---------------------------------------------------------------------------

When(
  "o cliente abre uma ordem de servico com {int} unidade(s) de {string}",
  async (quantidade: number, itemId: string) => {
    const resultado = await mundo.container.abrirOrdemServico.execute({
      clienteId: mundo.clienteId,
      veiculoId: mundo.veiculoId,
      itens: [{ id: itemId, quantidade }],
      correlationId: "bdd-correlation",
    });

    mundo.ordemServicoId = resultado.ordemServicoId;
    mundo.sagaId = resultado.sagaId;
  },
);

When(
  "o cliente tenta abrir uma ordem de servico com {int} unidade(s) de {string}",
  async (quantidade: number, itemId: string) => {
    try {
      await mundo.container.abrirOrdemServico.execute({
        clienteId: mundo.clienteId,
        veiculoId: mundo.veiculoId,
        itens: [{ id: itemId, quantidade }],
        correlationId: "bdd-correlation",
      });
    } catch (erro) {
      mundo.erro = erro as Error;
    }
  },
);

When("o cliente aprova o orcamento", async () => {
  await mundo.container.decidirOrcamento.execute({
    ordemServicoId: mundo.ordemServicoId,
    aprovado: true,
  });
});

When(
  "o cliente recusa o orcamento informando {string}",
  async (motivo: string) => {
    await mundo.container.decidirOrcamento.execute({
      ordemServicoId: mundo.ordemServicoId,
      aprovado: false,
      motivoRecusa: motivo,
    });
  },
);

// ---------------------------------------------------------------------------
// Respostas dos participantes (entrada assincrona, pela fila de reply)
// ---------------------------------------------------------------------------

When(
  "o servico de Billing responde que o orcamento foi gerado no valor de {float}",
  async (valor: number) => {
    await mundo.container.orquestrador.orcamentoGerado(
      mundo.sagaId,
      "orc-bdd-1",
      valor,
    );
  },
);

When("o servico de Billing confirma o pagamento", async () => {
  await mundo.container.orquestrador.pagamentoRegistrado(
    mundo.sagaId,
    "pag-bdd-1",
  );
});

When(
  "o servico de Billing informa que o pagamento falhou por {string}",
  async (motivo: string) => {
    await mundo.container.orquestrador.pagamentoFalhou(mundo.sagaId, motivo);
  },
);

When("o servico de Execucao confirma o enfileiramento", async () => {
  await mundo.container.orquestrador.execucaoEnfileirada(
    mundo.sagaId,
    "exec-bdd-1",
  );
});

When(
  "o servico de Execucao informa que o enfileiramento falhou por {string}",
  async (motivo: string) => {
    await mundo.container.orquestrador.execucaoFalhou(mundo.sagaId, motivo);
  },
);

When("o mecanico finaliza a execucao", async () => {
  await mundo.container.finalizarOrdemServico.execute({
    ordemServicoId: mundo.ordemServicoId,
    execucaoId: "exec-bdd-1",
  });
});

When("o veiculo e entregue ao cliente", async () => {
  await mundo.container.entregarOrdemServico.execute({
    ordemServicoId: mundo.ordemServicoId,
  });
});

// ---------------------------------------------------------------------------
// Verificacoes
// ---------------------------------------------------------------------------

Then(
  "a ordem de servico deve estar com o status {string}",
  async (status: string) => {
    const ordem = await mundo.container.ordemServicoRepository.obter(
      mundo.ordemServicoId,
    );
    assert.ok(ordem, "Ordem de servico nao encontrada");
    assert.strictEqual(ordem.status, status);
  },
);

Then("a Saga deve estar no estado {string}", async (estado: string) => {
  const saga = await mundo.container.sagaRepository.obter(mundo.sagaId);
  assert.ok(saga, "Saga nao encontrada");
  assert.strictEqual(saga.estado, estado);
});

Then(
  "o passo {string} da Saga deve estar {string}",
  async (passo: string, status: string) => {
    const saga = await mundo.container.sagaRepository.obter(mundo.sagaId);
    assert.ok(saga, "Saga nao encontrada");
    assert.strictEqual(saga.buscarPasso(passo)?.status, status);
  },
);

Then(
  "o comando {string} deve ter sido enviado ao servico de Billing",
  (comando: string) => {
    assert.ok(
      mundo.mensageria.tipos().includes(comando),
      `Comando ${comando} nao foi enviado. Enviados: ${mundo.mensageria.tipos().join(", ")}`,
    );
  },
);

Then(
  "o comando {string} deve ter sido enviado ao servico de Execucao",
  (comando: string) => {
    assert.ok(
      mundo.mensageria.tipos().includes(comando),
      `Comando ${comando} nao foi enviado. Enviados: ${mundo.mensageria.tipos().join(", ")}`,
    );
  },
);

Then("o comando {string} nao deve ter sido enviado", (comando: string) => {
  assert.ok(
    !mundo.mensageria.tipos().includes(comando),
    `Comando ${comando} nao deveria ter sido enviado`,
  );
});

// A ORDEM da tabela importa: as compensacoes acontecem do passo mais recente
// para o mais antigo, e e isso que garante um estado final consistente.
Then(
  "as transacoes compensatorias executadas devem ser, nesta ordem:",
  (tabela: DataTable) => {
    const esperadas = tabela.raw().map((linha) => linha[0].trim());
    const executadas = mundo.mensageria
      .tipos()
      .filter((tipo) => COMPENSACOES.includes(tipo));

    assert.deepStrictEqual(executadas, esperadas);
  },
);

Then("nenhuma transacao compensatoria deve ter sido executada", () => {
  const executadas = mundo.mensageria
    .tipos()
    .filter((tipo) => COMPENSACOES.includes(tipo));

  assert.deepStrictEqual(executadas, []);
});

Then("nenhuma cobranca deve ter sido solicitada ao cliente", () => {
  assert.ok(
    !mundo.mensageria.tipos().includes("REGISTRAR_PAGAMENTO"),
    "Nao deveria ter sido solicitada cobranca",
  );
});

Then("nenhum comando deve ter sido enviado aos participantes da Saga", () => {
  assert.deepStrictEqual(mundo.mensageria.tipos(), []);
});

Then(
  "a abertura deve falhar com a mensagem contendo {string}",
  (trecho: string) => {
    assert.ok(mundo.erro, "Era esperada uma falha na abertura da OS");
    assert.ok(
      mundo.erro.message.includes(trecho),
      `Mensagem inesperada: ${mundo.erro.message}`,
    );
  },
);
