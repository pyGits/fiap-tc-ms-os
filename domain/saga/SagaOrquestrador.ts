import MensageriaGateway from "../gateway/MensageriaGateway";
import TelemetriaGateway from "../gateway/TelemetriaGateway";
import OrdemServicoRepository from "../repository/OrdemServicoRepository";
import SagaRepository from "../repository/SagaRepository";
import ErroDominio from "../ErroDominio";
import OrdemServico from "../entity/OrdemServico";
import { ItemOrcamento, TipoEvento } from "../../src/messaging/contracts";
import { criarPassosSagaOrdemServico, PASSOS } from "./DefinicaoSaga";
import SagaOrdemServico, { EstadoSaga } from "./SagaOrdemServico";

export type ResultadoPasso = {
  sagaId: string;
  sucesso: boolean;
  motivo?: string;
  dados?: Record<string, unknown>;
};

// ORQUESTRADOR DA SAGA
// ---------------------------------------------------------------------------
// Implementa o padrao Saga na modalidade ORQUESTRADA (Aula 2 do SAGA Pattern):
// um componente central envia comandos aos participantes dizendo que operacao
// cada um deve executar, e reage as respostas recebidas na fila de reply.
//
// Escolha e justificativa (tambem registradas no README e na ADR-001):
//   - a Saga da OS tem 5 passos, um deles com espera por decisao humana e
//     compensacoes em dois participantes distintos. Chris Richardson, citado na
//     Aula 2, recomenda coreografia apenas para sagas simples;
//   - com orquestracao o fluxo inteiro fica em um unico lugar no codigo
//     (DefinicaoSaga.ts), o que elimina as dependencias ciclicas entre servicos
//     que a coreografia costuma criar;
//   - o contra conhecido - ponto unico de falha - e mitigado porque o estado da
//     Saga e persistido a cada passo: se o orquestrador cair, ele retoma do
//     ponto em que parou em vez de perder a transacao.
export default class SagaOrquestrador {
  constructor(
    private readonly sagaRepository: SagaRepository,
    private readonly ordemServicoRepository: OrdemServicoRepository,
    private readonly mensageria: MensageriaGateway,
    private readonly telemetria: TelemetriaGateway,
  ) {}

  // -------------------------------------------------------------------------
  // Inicio: passo 1 (transacao local) + passo 2 (comando ao Billing)
  // -------------------------------------------------------------------------
  async iniciar(
    ordemServico: OrdemServico,
    correlationId: string,
    itens: ItemOrcamento[],
    clienteEmail?: string,
  ): Promise<SagaOrdemServico> {
    const saga = new SagaOrdemServico({
      ordemServicoId: ordemServico.id.getValue(),
      correlationId,
      passos: criarPassosSagaOrdemServico(),
      dadosNegocio: {
        clienteId: ordemServico.clienteId,
        veiculoId: ordemServico.veiculoId,
        clienteEmail,
        itens,
      },
    });

    // Passo 1 - transacao local: a OS ja foi criada no banco do OS Service
    // pelo caso de uso. Marcamos o passo como concluido e seguimos.
    saga.iniciarPassoCorrente();
    saga.concluirPassoCorrente({ ordemServicoId: ordemServico.id.getValue() });
    await this.sagaRepository.salvar(saga);

    this.telemetria.registrarPassoSaga({
      sagaId: saga.id.getValue(),
      ordemServicoId: saga.ordemServicoId,
      passo: PASSOS.CRIAR_OS,
      resultado: "CONCLUIDO",
    });

    await this.mensageria.publicarEvento(
      { sagaId: saga.id.getValue(), ordemServicoId: saga.ordemServicoId },
      TipoEvento.OS_CRIADA,
      { clienteId: ordemServico.clienteId, veiculoId: ordemServico.veiculoId },
    );

    // Passo 2 - comando assincrono ao Billing Service.
    await this.executarPassoGerarOrcamento(saga, itens, clienteEmail);
    return saga;
  }

  private async executarPassoGerarOrcamento(
    saga: SagaOrdemServico,
    itens: ItemOrcamento[],
    clienteEmail?: string,
  ): Promise<void> {
    const passo = saga.iniciarPassoCorrente();
    await this.sagaRepository.salvar(saga);

    this.telemetria.registrarPassoSaga({
      sagaId: saga.id.getValue(),
      ordemServicoId: saga.ordemServicoId,
      passo: passo.nome,
      resultado: "EXECUTANDO",
    });

    await this.mensageria.enviarGerarOrcamento(
      { sagaId: saga.id.getValue(), ordemServicoId: saga.ordemServicoId },
      {
        clienteId: String(saga.dados.clienteId),
        clienteEmail,
        veiculoId: String(saga.dados.veiculoId),
        itens,
      },
    );
  }

  // -------------------------------------------------------------------------
  // Passo 2 respondido pelo Billing
  // -------------------------------------------------------------------------
  async orcamentoGerado(
    sagaId: string,
    orcamentoId: string,
    valorTotal: number,
  ): Promise<void> {
    const saga = await this.carregarSaga(sagaId);
    if (saga.estaFinalizada()) return;

    saga.concluirPassoCorrente({ orcamentoId, valorTotal });
    saga.registrarDados({ orcamentoId, valorTotal });

    const ordemServico = await this.carregarOrdemServico(saga.ordemServicoId);
    ordemServico.registrarOrcamentoGerado(orcamentoId, valorTotal);
    ordemServico.sagaId = saga.id.getValue();
    await this.ordemServicoRepository.atualizar(ordemServico);

    // Passo 3: a Saga pausa ate a decisao do cliente.
    saga.iniciarPassoCorrente();
    saga.aguardarAprovacao();
    await this.sagaRepository.salvar(saga);

    this.telemetria.registrarPassoSaga({
      sagaId,
      ordemServicoId: saga.ordemServicoId,
      passo: PASSOS.GERAR_ORCAMENTO,
      resultado: "CONCLUIDO",
    });

    await this.publicarStatus(ordemServico, saga);
  }

  async orcamentoFalhou(sagaId: string, motivo: string): Promise<void> {
    const saga = await this.carregarSaga(sagaId);
    if (saga.estaFinalizada()) return;

    this.telemetria.registrarPassoSaga({
      sagaId,
      ordemServicoId: saga.ordemServicoId,
      passo: PASSOS.GERAR_ORCAMENTO,
      resultado: "FALHOU",
      erro: motivo,
    });

    await this.compensar(saga, motivo);
  }

  // -------------------------------------------------------------------------
  // Passo 3: decisao do cliente (chega por REST, nao por mensageria)
  // -------------------------------------------------------------------------
  async aprovacaoRecebida(
    ordemServicoId: string,
    aprovado: boolean,
    motivoRecusa?: string,
  ): Promise<void> {
    const saga = await this.sagaRepository.obterPorOrdemServico(ordemServicoId);
    if (!saga) {
      throw ErroDominio.naoEncontrado(
        "saga.nao.encontrada",
        "Nenhuma Saga em andamento para esta ordem de servico.",
      );
    }

    if (saga.estado !== EstadoSaga.AGUARDANDO_APROVACAO) {
      throw new ErroDominio(
        "saga.estado.invalido",
        `A Saga nao esta aguardando aprovacao (estado atual: ${saga.estado}).`,
        409,
      );
    }

    const ordemServico = await this.carregarOrdemServico(ordemServicoId);

    // Recusa nao e falha tecnica: e um desfecho de negocio previsto. Mesmo
    // assim o orcamento gerado no Billing precisa ser cancelado, por isso a
    // Saga passa pela compensacao antes de encerrar.
    if (!aprovado) {
      ordemServico.recusarOrcamento(motivoRecusa);
      await this.ordemServicoRepository.atualizar(ordemServico);

      saga.concluirPassoCorrente({ aprovado: false, motivoRecusa });
      await this.sagaRepository.salvar(saga);

      await this.compensar(
        saga,
        motivoRecusa || "Orcamento recusado pelo cliente.",
        false,
      );
      await this.publicarStatus(ordemServico, saga);
      return;
    }

    ordemServico.aprovarOrcamento();
    await this.ordemServicoRepository.atualizar(ordemServico);

    saga.concluirPassoCorrente({ aprovado: true });
    saga.retomar();
    await this.sagaRepository.salvar(saga);

    this.telemetria.registrarPassoSaga({
      sagaId: saga.id.getValue(),
      ordemServicoId,
      passo: PASSOS.AGUARDAR_APROVACAO,
      resultado: "CONCLUIDO",
    });

    await this.publicarStatus(ordemServico, saga);

    // Passo 4: cobranca no Billing (Mercado Pago).
    await this.executarPassoRegistrarPagamento(saga);
  }

  private async executarPassoRegistrarPagamento(
    saga: SagaOrdemServico,
  ): Promise<void> {
    const passo = saga.iniciarPassoCorrente();
    await this.sagaRepository.salvar(saga);

    this.telemetria.registrarPassoSaga({
      sagaId: saga.id.getValue(),
      ordemServicoId: saga.ordemServicoId,
      passo: passo.nome,
      resultado: "EXECUTANDO",
    });

    await this.mensageria.enviarRegistrarPagamento(
      { sagaId: saga.id.getValue(), ordemServicoId: saga.ordemServicoId },
      {
        orcamentoId: String(saga.dados.orcamentoId),
        valor: Number(saga.dados.valorTotal),
        clienteId: String(saga.dados.clienteId),
        simularFalha: Boolean(saga.dados.simularFalhaPagamento),
      },
    );
  }

  // -------------------------------------------------------------------------
  // Passo 4 respondido pelo Billing
  // -------------------------------------------------------------------------
  async pagamentoRegistrado(sagaId: string, pagamentoId: string): Promise<void> {
    const saga = await this.carregarSaga(sagaId);
    if (saga.estaFinalizada()) return;

    saga.concluirPassoCorrente({ pagamentoId });
    saga.registrarDados({ pagamentoId });

    const ordemServico = await this.carregarOrdemServico(saga.ordemServicoId);
    ordemServico.registrarPagamento(pagamentoId);
    await this.ordemServicoRepository.atualizar(ordemServico);

    await this.sagaRepository.salvar(saga);

    this.telemetria.registrarPassoSaga({
      sagaId,
      ordemServicoId: saga.ordemServicoId,
      passo: PASSOS.REGISTRAR_PAGAMENTO,
      resultado: "CONCLUIDO",
    });

    // Passo 5: envia a OS para a fila de execucao da oficina.
    await this.executarPassoEnfileirarExecucao(saga);
  }

  async pagamentoFalhou(sagaId: string, motivo: string): Promise<void> {
    const saga = await this.carregarSaga(sagaId);
    if (saga.estaFinalizada()) return;

    this.telemetria.registrarPassoSaga({
      sagaId,
      ordemServicoId: saga.ordemServicoId,
      passo: PASSOS.REGISTRAR_PAGAMENTO,
      resultado: "FALHOU",
      erro: motivo,
    });

    await this.compensar(saga, motivo);
  }

  private async executarPassoEnfileirarExecucao(
    saga: SagaOrdemServico,
  ): Promise<void> {
    const passo = saga.iniciarPassoCorrente();
    await this.sagaRepository.salvar(saga);

    this.telemetria.registrarPassoSaga({
      sagaId: saga.id.getValue(),
      ordemServicoId: saga.ordemServicoId,
      passo: passo.nome,
      resultado: "EXECUTANDO",
    });

    await this.mensageria.enviarEnfileirarExecucao(
      { sagaId: saga.id.getValue(), ordemServicoId: saga.ordemServicoId },
      {
        clienteId: String(saga.dados.clienteId),
        veiculoId: String(saga.dados.veiculoId),
        itens: (saga.dados.itens as ItemOrcamento[]) ?? [],
        simularFalha: Boolean(saga.dados.simularFalhaExecucao),
      },
    );
  }

  // -------------------------------------------------------------------------
  // Passo 5 respondido pelo servico de Execucao - ultimo passo da Saga
  // -------------------------------------------------------------------------
  async execucaoEnfileirada(sagaId: string, execucaoId: string): Promise<void> {
    const saga = await this.carregarSaga(sagaId);
    if (saga.estaFinalizada()) return;

    saga.concluirPassoCorrente({ execucaoId });
    saga.registrarDados({ execucaoId });

    const ordemServico = await this.carregarOrdemServico(saga.ordemServicoId);
    ordemServico.registrarExecucaoIniciada(execucaoId);
    await this.ordemServicoRepository.atualizar(ordemServico);

    await this.sagaRepository.salvar(saga);

    this.telemetria.registrarPassoSaga({
      sagaId,
      ordemServicoId: saga.ordemServicoId,
      passo: PASSOS.ENFILEIRAR_EXECUCAO,
      resultado: "CONCLUIDO",
    });

    this.telemetria.registrarSagaConcluida({
      sagaId,
      ordemServicoId: saga.ordemServicoId,
      duracaoMs: saga.atualizadaEm.getTime() - saga.criadaEm.getTime(),
    });

    await this.mensageria.publicarEvento(
      { sagaId, ordemServicoId: saga.ordemServicoId },
      TipoEvento.SAGA_CONCLUIDA,
      { estado: saga.estado, passos: saga.passos.length },
    );

    await this.publicarStatus(ordemServico, saga);
  }

  async execucaoFalhou(sagaId: string, motivo: string): Promise<void> {
    const saga = await this.carregarSaga(sagaId);
    if (saga.estaFinalizada()) return;

    this.telemetria.registrarPassoSaga({
      sagaId,
      ordemServicoId: saga.ordemServicoId,
      passo: PASSOS.ENFILEIRAR_EXECUCAO,
      resultado: "FALHOU",
      erro: motivo,
    });

    await this.compensar(saga, motivo);
  }

  // -------------------------------------------------------------------------
  // ROLLBACK: transacoes compensatorias
  // -------------------------------------------------------------------------
  // Executadas na ordem INVERSA a da execucao. Como nao existe o "I" do ACID
  // entre servicos (Aula 3 do SAGA Pattern), nao ha como fazer um rollback
  // atomico: cada efeito ja aplicado precisa ser desfeito por uma operacao de
  // negocio propria (cancelar o orcamento, estornar o pagamento, cancelar a
  // execucao), levando o sistema de volta a um estado valido.
  private async compensar(
    saga: SagaOrdemServico,
    motivo: string,
    registrarFalha = true,
  ): Promise<void> {
    if (registrarFalha) {
      saga.registrarFalha(motivo);
    } else {
      saga.estado = EstadoSaga.COMPENSANDO;
      saga.erro = motivo;
    }
    await this.sagaRepository.salvar(saga);

    const ctx = {
      sagaId: saga.id.getValue(),
      ordemServicoId: saga.ordemServicoId,
    };

    for (const passo of saga.passosParaCompensar()) {
      saga.marcarCompensando(passo.nome);
      await this.sagaRepository.salvar(saga);

      this.telemetria.registrarCompensacao({
        sagaId: ctx.sagaId,
        ordemServicoId: ctx.ordemServicoId,
        passo: passo.nome,
        motivo,
      });

      switch (passo.nome) {
        case PASSOS.ENFILEIRAR_EXECUCAO:
          await this.mensageria.enviarCancelarExecucao(ctx, { motivo });
          break;

        case PASSOS.REGISTRAR_PAGAMENTO:
          await this.mensageria.enviarEstornarPagamento(ctx, {
            pagamentoId: saga.dados.pagamentoId as string | undefined,
            motivo,
          });
          break;

        case PASSOS.GERAR_ORCAMENTO:
          await this.mensageria.enviarCancelarOrcamento(ctx, {
            orcamentoId: saga.dados.orcamentoId as string | undefined,
            motivo,
          });
          break;

        case PASSOS.CRIAR_OS:
          // Compensacao local: a OS volta para um estado final valido. Nao
          // apagamos o registro - o historico da tentativa e informacao de
          // negocio e alimenta os indicadores de falha.
          await this.compensarOrdemServico(saga, motivo);
          break;

        default:
          break;
      }

      saga.marcarCompensado(passo.nome);
      await this.sagaRepository.salvar(saga);
    }

    if (saga.estado !== EstadoSaga.COMPENSADA) {
      saga.estado = EstadoSaga.COMPENSADA;
      await this.sagaRepository.salvar(saga);
    }

    this.telemetria.registrarSagaCompensada({
      sagaId: ctx.sagaId,
      ordemServicoId: ctx.ordemServicoId,
      motivo,
    });

    await this.mensageria.publicarEvento(ctx, TipoEvento.SAGA_COMPENSADA, {
      motivo,
    });
  }

  private async compensarOrdemServico(
    saga: SagaOrdemServico,
    motivo: string,
  ): Promise<void> {
    const ordemServico = await this.carregarOrdemServico(saga.ordemServicoId);

    // Uma OS recusada pelo cliente ja esta num estado final legitimo; nao faz
    // sentido sobrescrever esse desfecho com CANCELADA.
    if (ordemServico.estaEmEstadoFinal()) return;

    ordemServico.cancelar(motivo);
    await this.ordemServicoRepository.atualizar(ordemServico);
  }

  // -------------------------------------------------------------------------
  // Auxiliares
  // -------------------------------------------------------------------------
  private async carregarSaga(sagaId: string): Promise<SagaOrdemServico> {
    const saga = await this.sagaRepository.obter(sagaId);
    if (!saga) {
      throw ErroDominio.naoEncontrado(
        "saga.nao.encontrada",
        `Saga ${sagaId} nao encontrada.`,
      );
    }
    return saga;
  }

  private async carregarOrdemServico(id: string): Promise<OrdemServico> {
    const ordemServico = await this.ordemServicoRepository.obter(id);
    if (!ordemServico) {
      throw ErroDominio.naoEncontrado(
        "os.nao.encontrada",
        `Ordem de servico ${id} nao encontrada.`,
      );
    }
    return ordemServico;
  }

  private async publicarStatus(
    ordemServico: OrdemServico,
    saga: SagaOrdemServico,
  ): Promise<void> {
    this.telemetria.registrarTransicoesStatus(ordemServico);

    await this.mensageria.publicarEvento(
      { sagaId: saga.id.getValue(), ordemServicoId: saga.ordemServicoId },
      TipoEvento.OS_STATUS_ALTERADO,
      { status: ordemServico.status, clienteId: ordemServico.clienteId },
    );
  }
}
