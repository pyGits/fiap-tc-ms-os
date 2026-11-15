import OrdemServico, {
  StatusOrdemServico,
} from "../../domain/entity/OrdemServico";
import ItemOrdemServico, { TipoItem } from "../../domain/entity/ItemOrdemServico";
import MensageriaGatewayMemoria from "../../domain/gateway/Mock/MensageriaGatewayMemoria";
import TelemetriaGatewayMemoria from "../../domain/gateway/Mock/TelemetriaGatewayMemoria";
import OrdemServicoRepositoryMemoria from "../../domain/repository/Mock/OrdemServicoRepositoryMemoria";
import SagaRepositoryMemoria from "../../domain/repository/Mock/SagaRepositoryMemoria";
import SagaOrquestrador from "../../domain/saga/SagaOrquestrador";
import { EstadoSaga, StatusPasso } from "../../domain/saga/SagaOrdemServico";
import { PASSOS } from "../../domain/saga/DefinicaoSaga";
import ErroDominio from "../../domain/ErroDominio";
import { ItemOrcamento } from "../../src/messaging/contracts";

const ITENS: ItemOrcamento[] = [
  {
    id: "srv-revisao",
    descricao: "Revisao completa",
    quantidade: 1,
    valorUnitario: 450,
    tipo: "SERVICO",
  },
];

type Cenario = {
  orquestrador: SagaOrquestrador;
  sagas: SagaRepositoryMemoria;
  ordens: OrdemServicoRepositoryMemoria;
  mensageria: MensageriaGatewayMemoria;
  telemetria: TelemetriaGatewayMemoria;
};

function montarCenario(): Cenario {
  const sagas = new SagaRepositoryMemoria();
  const ordens = new OrdemServicoRepositoryMemoria();
  const mensageria = new MensageriaGatewayMemoria();
  const telemetria = new TelemetriaGatewayMemoria();

  return {
    sagas,
    ordens,
    mensageria,
    telemetria,
    orquestrador: new SagaOrquestrador(sagas, ordens, mensageria, telemetria),
  };
}

async function abrirOrdem(cenario: Cenario) {
  const ordem = new OrdemServico(undefined, "cliente-1", "veiculo-1");
  ordem.definirItens([
    new ItemOrdemServico({
      referenciaId: "srv-revisao",
      descricao: "Revisao completa",
      tipo: TipoItem.SERVICO,
      quantidade: 1,
      valorUnitario: 450,
    }),
  ]);
  await cenario.ordens.salvar(ordem);

  const saga = await cenario.orquestrador.iniciar(ordem, "corr-1", ITENS);
  ordem.sagaId = saga.id.getValue();
  await cenario.ordens.atualizar(ordem);

  return { ordem, saga };
}

describe("SagaOrquestrador - caminho feliz", () => {
  it("passo 1 e local e passo 2 publica GERAR_ORCAMENTO", async () => {
    const cenario = montarCenario();
    const { saga } = await abrirOrdem(cenario);

    expect(saga.buscarPasso(PASSOS.CRIAR_OS)?.status).toBe(
      StatusPasso.CONCLUIDO,
    );
    expect(saga.buscarPasso(PASSOS.GERAR_ORCAMENTO)?.status).toBe(
      StatusPasso.EXECUTANDO,
    );
    expect(cenario.mensageria.tipos()).toEqual(["GERAR_ORCAMENTO"]);
    expect(cenario.mensageria.tiposEventos()).toContain("OS_CRIADA");
  });

  it("orcamento gerado pausa a Saga aguardando a decisao do cliente", async () => {
    const cenario = montarCenario();
    const { saga, ordem } = await abrirOrdem(cenario);

    await cenario.orquestrador.orcamentoGerado(saga.id.getValue(), "orc-1", 450);

    const atualizada = await cenario.sagas.obter(saga.id.getValue());
    const osAtualizada = await cenario.ordens.obter(ordem.id.getValue());

    expect(atualizada?.estado).toBe(EstadoSaga.AGUARDANDO_APROVACAO);
    expect(osAtualizada?.status).toBe(StatusOrdemServico.AGUARDANDO_APROVACAO);
    expect(osAtualizada?.orcamentoId).toBe("orc-1");
    // Nenhum comando novo: a Saga nao avanca sem a decisao humana.
    expect(cenario.mensageria.tipos()).toEqual(["GERAR_ORCAMENTO"]);
  });

  it("aprovacao dispara REGISTRAR_PAGAMENTO", async () => {
    const cenario = montarCenario();
    const { saga, ordem } = await abrirOrdem(cenario);

    await cenario.orquestrador.orcamentoGerado(saga.id.getValue(), "orc-1", 450);
    await cenario.orquestrador.aprovacaoRecebida(ordem.id.getValue(), true);

    expect(cenario.mensageria.tipos()).toEqual([
      "GERAR_ORCAMENTO",
      "REGISTRAR_PAGAMENTO",
    ]);

    const comando = cenario.mensageria.buscar("REGISTRAR_PAGAMENTO");
    expect(comando?.body.orcamentoId).toBe("orc-1");
    expect(comando?.body.valor).toBe(450);
  });

  it("pagamento registrado dispara ENFILEIRAR_EXECUCAO", async () => {
    const cenario = montarCenario();
    const { saga, ordem } = await abrirOrdem(cenario);

    await cenario.orquestrador.orcamentoGerado(saga.id.getValue(), "orc-1", 450);
    await cenario.orquestrador.aprovacaoRecebida(ordem.id.getValue(), true);
    await cenario.orquestrador.pagamentoRegistrado(saga.id.getValue(), "pag-1");

    expect(cenario.mensageria.tipos()).toContain("ENFILEIRAR_EXECUCAO");

    const osAtualizada = await cenario.ordens.obter(ordem.id.getValue());
    expect(osAtualizada?.pagamentoId).toBe("pag-1");
  });

  it("conclui a Saga quando a execucao e enfileirada (ultimo passo)", async () => {
    const cenario = montarCenario();
    const { saga, ordem } = await abrirOrdem(cenario);

    await cenario.orquestrador.orcamentoGerado(saga.id.getValue(), "orc-1", 450);
    await cenario.orquestrador.aprovacaoRecebida(ordem.id.getValue(), true);
    await cenario.orquestrador.pagamentoRegistrado(saga.id.getValue(), "pag-1");
    await cenario.orquestrador.execucaoEnfileirada(saga.id.getValue(), "exec-1");

    const atualizada = await cenario.sagas.obter(saga.id.getValue());
    const osAtualizada = await cenario.ordens.obter(ordem.id.getValue());

    expect(atualizada?.estado).toBe(EstadoSaga.CONCLUIDA);
    expect(osAtualizada?.status).toBe(StatusOrdemServico.EM_EXECUCAO);
    expect(osAtualizada?.execucaoId).toBe("exec-1");
    expect(cenario.telemetria.sagasConcluidas).toHaveLength(1);
    expect(cenario.mensageria.tiposEventos()).toContain("SAGA_CONCLUIDA");
  });
});

describe("SagaOrquestrador - rollback (transacoes compensatorias)", () => {
  it("falha no orcamento cancela a OS sem compensacoes externas", async () => {
    const cenario = montarCenario();
    const { saga, ordem } = await abrirOrdem(cenario);

    await cenario.orquestrador.orcamentoFalhou(
      saga.id.getValue(),
      "Item fora de linha",
    );

    const atualizada = await cenario.sagas.obter(saga.id.getValue());
    const osAtualizada = await cenario.ordens.obter(ordem.id.getValue());

    expect(atualizada?.estado).toBe(EstadoSaga.COMPENSADA);
    expect(osAtualizada?.status).toBe(StatusOrdemServico.CANCELADA);
    // O orcamento nunca foi criado: nao havia o que cancelar no Billing.
    expect(cenario.mensageria.tipos()).not.toContain("CANCELAR_ORCAMENTO");
  });

  it("falha no pagamento compensa o orcamento e cancela a OS", async () => {
    const cenario = montarCenario();
    const { saga, ordem } = await abrirOrdem(cenario);

    await cenario.orquestrador.orcamentoGerado(saga.id.getValue(), "orc-1", 450);
    await cenario.orquestrador.aprovacaoRecebida(ordem.id.getValue(), true);
    await cenario.orquestrador.pagamentoFalhou(
      saga.id.getValue(),
      "Cartao recusado",
    );

    const atualizada = await cenario.sagas.obter(saga.id.getValue());
    const osAtualizada = await cenario.ordens.obter(ordem.id.getValue());

    expect(atualizada?.estado).toBe(EstadoSaga.COMPENSADA);
    expect(osAtualizada?.status).toBe(StatusOrdemServico.CANCELADA);
    expect(cenario.mensageria.tipos()).toContain("CANCELAR_ORCAMENTO");
    // Nunca houve cobranca aprovada: estornar seria errado.
    expect(cenario.mensageria.tipos()).not.toContain("ESTORNAR_PAGAMENTO");

    const compensacao = cenario.mensageria.buscar("CANCELAR_ORCAMENTO");
    expect(compensacao?.body.orcamentoId).toBe("orc-1");
  });

  // Este e o cenario que a Fase 4 pede para demonstrar no video: a falha
  // acontece no ULTIMO passo e o rollback precisa desfazer tudo.
  it("falha na execucao compensa em ORDEM INVERSA: pagamento e depois orcamento", async () => {
    const cenario = montarCenario();
    const { saga, ordem } = await abrirOrdem(cenario);

    await cenario.orquestrador.orcamentoGerado(saga.id.getValue(), "orc-1", 450);
    await cenario.orquestrador.aprovacaoRecebida(ordem.id.getValue(), true);
    await cenario.orquestrador.pagamentoRegistrado(saga.id.getValue(), "pag-1");
    await cenario.orquestrador.execucaoFalhou(
      saga.id.getValue(),
      "Fila da oficina cheia",
    );

    const compensacoes = cenario.mensageria
      .tipos()
      .filter((tipo) => tipo.startsWith("ESTORNAR") || tipo.startsWith("CANCELAR"));

    // A ordem importa: desfaz-se do passo mais recente para o mais antigo.
    expect(compensacoes).toEqual(["ESTORNAR_PAGAMENTO", "CANCELAR_ORCAMENTO"]);

    const atualizada = await cenario.sagas.obter(saga.id.getValue());
    const osAtualizada = await cenario.ordens.obter(ordem.id.getValue());

    expect(atualizada?.estado).toBe(EstadoSaga.COMPENSADA);
    expect(osAtualizada?.status).toBe(StatusOrdemServico.CANCELADA);
    expect(osAtualizada?.motivoCancelamento).toContain("Fila da oficina cheia");

    // Cada passo com efeito externo fica marcado como COMPENSADO no saga log.
    expect(atualizada?.buscarPasso(PASSOS.REGISTRAR_PAGAMENTO)?.status).toBe(
      StatusPasso.COMPENSADO,
    );
    expect(atualizada?.buscarPasso(PASSOS.GERAR_ORCAMENTO)?.status).toBe(
      StatusPasso.COMPENSADO,
    );
    // O passo que falhou nao e compensado: ele nunca produziu efeito.
    expect(atualizada?.buscarPasso(PASSOS.ENFILEIRAR_EXECUCAO)?.status).toBe(
      StatusPasso.FALHOU,
    );

    expect(cenario.telemetria.compensacoes).toContain(PASSOS.REGISTRAR_PAGAMENTO);
    expect(cenario.telemetria.sagasCompensadas).toHaveLength(1);
    expect(cenario.mensageria.tiposEventos()).toContain("SAGA_COMPENSADA");
  });

  it("estorno leva o pagamentoId registrado nos dados da Saga", async () => {
    const cenario = montarCenario();
    const { saga, ordem } = await abrirOrdem(cenario);

    await cenario.orquestrador.orcamentoGerado(saga.id.getValue(), "orc-1", 450);
    await cenario.orquestrador.aprovacaoRecebida(ordem.id.getValue(), true);
    await cenario.orquestrador.pagamentoRegistrado(saga.id.getValue(), "pag-77");
    await cenario.orquestrador.execucaoFalhou(saga.id.getValue(), "falhou");

    expect(cenario.mensageria.buscar("ESTORNAR_PAGAMENTO")?.body.pagamentoId).toBe(
      "pag-77",
    );
  });

  // Recusa do cliente: desfecho de negocio, nao falha tecnica - mas o
  // orcamento ja criado no Billing tambem precisa ser cancelado.
  it("recusa do orcamento compensa o Billing e deixa a OS como RECUSADA", async () => {
    const cenario = montarCenario();
    const { saga, ordem } = await abrirOrdem(cenario);

    await cenario.orquestrador.orcamentoGerado(saga.id.getValue(), "orc-1", 450);
    await cenario.orquestrador.aprovacaoRecebida(
      ordem.id.getValue(),
      false,
      "Cliente achou caro",
    );

    const atualizada = await cenario.sagas.obter(saga.id.getValue());
    const osAtualizada = await cenario.ordens.obter(ordem.id.getValue());

    expect(atualizada?.estado).toBe(EstadoSaga.COMPENSADA);
    // RECUSADA, nao CANCELADA: o desfecho de negocio e preservado.
    expect(osAtualizada?.status).toBe(StatusOrdemServico.RECUSADA);
    expect(osAtualizada?.motivoRecusa).toBe("Cliente achou caro");
    expect(cenario.mensageria.tipos()).toContain("CANCELAR_ORCAMENTO");
  });
});

describe("SagaOrquestrador - consistencia e idempotencia", () => {
  it("ignora resposta de uma Saga ja finalizada (mensagem reentregue)", async () => {
    const cenario = montarCenario();
    const { saga, ordem } = await abrirOrdem(cenario);

    await cenario.orquestrador.orcamentoGerado(saga.id.getValue(), "orc-1", 450);
    await cenario.orquestrador.aprovacaoRecebida(ordem.id.getValue(), true);
    await cenario.orquestrador.pagamentoRegistrado(saga.id.getValue(), "pag-1");
    await cenario.orquestrador.execucaoEnfileirada(saga.id.getValue(), "exec-1");

    const quantidadeAntes = cenario.mensageria.enviadas.length;

    // Reentrega da mesma resposta depois de a Saga concluir.
    await cenario.orquestrador.execucaoEnfileirada(saga.id.getValue(), "exec-1");

    expect(cenario.mensageria.enviadas).toHaveLength(quantidadeAntes);
  });

  it("recusa aprovacao quando a Saga nao esta aguardando decisao", async () => {
    const cenario = montarCenario();
    const { ordem } = await abrirOrdem(cenario);

    // Ainda em GERAR_ORCAMENTO: nao ha orcamento para aprovar.
    await expect(
      cenario.orquestrador.aprovacaoRecebida(ordem.id.getValue(), true),
    ).rejects.toThrow(ErroDominio);
  });

  it("falha ao decidir sobre uma OS sem Saga", async () => {
    const cenario = montarCenario();

    await expect(
      cenario.orquestrador.aprovacaoRecebida("os-inexistente", true),
    ).rejects.toThrow(ErroDominio);
  });

  it("registra telemetria de cada passo executado", async () => {
    const cenario = montarCenario();
    const { saga, ordem } = await abrirOrdem(cenario);

    await cenario.orquestrador.orcamentoGerado(saga.id.getValue(), "orc-1", 450);
    await cenario.orquestrador.aprovacaoRecebida(ordem.id.getValue(), true);

    const passos = cenario.telemetria.passos.map((item) => item.passo);

    expect(passos).toContain(PASSOS.CRIAR_OS);
    expect(passos).toContain(PASSOS.GERAR_ORCAMENTO);
    expect(passos).toContain(PASSOS.AGUARDAR_APROVACAO);
  });
});
