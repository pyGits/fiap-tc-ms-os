import OrdemServico from "../../domain/entity/OrdemServico";
import TelemetriaGateway, {
  ResultadoPassoSaga,
} from "../../domain/gateway/TelemetriaGateway";
import { getContexto, getCorrelationId } from "../context";
import logger from "../logger";

// Carrega o agente do New Relic apenas quando ha licenca configurada, para que
// testes e ambiente local rodem sem o agente (e sem erro de require).
type AgenteNewRelic = {
  recordCustomEvent: (nome: string, atributos: Record<string, unknown>) => void;
  noticeError?: (erro: Error, atributos?: Record<string, unknown>) => void;
};

function carregarAgente(): AgenteNewRelic | null {
  if (!process.env.NEW_RELIC_LICENSE_KEY) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("newrelic") as AgenteNewRelic;
  } catch (erro) {
    logger.warn(
      { erro: erro instanceof Error ? erro.message : String(erro) },
      "agente New Relic indisponivel; telemetria apenas em log",
    );
    return null;
  }
}

// Observabilidade de negocio da Fase 4.
//
// Alem dos eventos herdados da Fase 3 (volume de OS e tempo medio por status),
// a Saga distribuida exige metricas proprias: sem elas um rollback parcial
// passa silencioso. Custom events publicados:
//   OrdemServicoStatus - transicoes de status da OS
//   SagaPasso          - inicio/fim e resultado de cada passo
//   SagaCompensacao    - cada transacao compensatoria executada (alerta)
//   SagaConcluida      - duracao ponta a ponta da Saga
//   SagaCompensada     - Sagas que terminaram em rollback (alerta)
//   IntegracaoFalha    - falhas em integracoes externas
export default class NewRelicTelemetriaGateway implements TelemetriaGateway {
  private readonly agente: AgenteNewRelic | null;
  private readonly env: string;
  private readonly servico: string;

  constructor(agente: AgenteNewRelic | null = carregarAgente()) {
    this.agente = agente;
    this.env = process.env.APP_ENV || process.env.NODE_ENV || "local";
    this.servico = process.env.SERVICE_NAME || "fiap-tc-ms-os";
  }

  registrarTransicoesStatus(ordemServico: OrdemServico): void {
    for (const transicao of ordemServico.transicoesRegistradas) {
      this.publicar("OrdemServicoStatus", {
        ordemServicoId: ordemServico.id.getValue(),
        clienteId: ordemServico.clienteId,
        veiculoId: ordemServico.veiculoId,
        statusAnterior: transicao.statusAnterior ?? "NENHUM",
        statusNovo: transicao.statusNovo,
        transicao: `${transicao.statusAnterior ?? "NENHUM"}->${transicao.statusNovo}`,
        duracaoStatusAnteriorMs: transicao.duracaoStatusAnteriorMs ?? 0,
        valorTotal: ordemServico.valorTotal,
        sagaId: ordemServico.sagaId ?? "",
      });
    }

    ordemServico.limparTransicoesRegistradas();
  }

  registrarPassoSaga(dados: {
    sagaId: string;
    ordemServicoId: string;
    passo: string;
    resultado: ResultadoPassoSaga;
    erro?: string;
  }): void {
    this.publicar("SagaPasso", {
      sagaId: dados.sagaId,
      ordemServicoId: dados.ordemServicoId,
      passo: dados.passo,
      resultado: dados.resultado,
      erro: dados.erro ?? "",
    });
  }

  registrarCompensacao(dados: {
    sagaId: string;
    ordemServicoId: string;
    passo: string;
    motivo: string;
  }): void {
    this.publicar("SagaCompensacao", {
      sagaId: dados.sagaId,
      ordemServicoId: dados.ordemServicoId,
      passo: dados.passo,
      motivo: dados.motivo,
    });
  }

  registrarSagaConcluida(dados: {
    sagaId: string;
    ordemServicoId: string;
    duracaoMs: number;
  }): void {
    this.publicar("SagaConcluida", {
      sagaId: dados.sagaId,
      ordemServicoId: dados.ordemServicoId,
      duracaoMs: dados.duracaoMs,
    });
  }

  registrarSagaCompensada(dados: {
    sagaId: string;
    ordemServicoId: string;
    motivo: string;
  }): void {
    this.publicar("SagaCompensada", {
      sagaId: dados.sagaId,
      ordemServicoId: dados.ordemServicoId,
      motivo: dados.motivo,
    });
  }

  registrarFalhaIntegracao(dados: {
    integracao: string;
    operacao: string;
    erro: string;
  }): void {
    this.publicar("IntegracaoFalha", {
      integracao: dados.integracao,
      operacao: dados.operacao,
      erro: dados.erro,
    });
  }

  private publicar(evento: string, atributos: Record<string, unknown>) {
    const contexto = getContexto();

    const payload = {
      ...atributos,
      servico: this.servico,
      env: this.env,
      correlationId: getCorrelationId() ?? "",
      // O sagaId no contexto permite correlacionar, no New Relic, os eventos
      // dos TRES microsservicos em um unico trace distribuido.
      sagaIdContexto: contexto?.sagaId ?? "",
    };

    // Sempre loga: garante rastreabilidade mesmo sem o agente (dev local).
    logger.info({ evento, ...payload }, "evento de telemetria");

    this.agente?.recordCustomEvent(evento, payload);
  }
}
