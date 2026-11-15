import OrdemServico from "../entity/OrdemServico";

export type ResultadoPassoSaga = "EXECUTANDO" | "CONCLUIDO" | "FALHOU";

// Porta de observabilidade de negocio (Fase 3, ampliada na Fase 4).
//
// O dominio nao conhece o New Relic; a implementacao concreta fica na borda.
// Cada metodo alimenta um custom event usado nos dashboards e alertas:
//   OrdemServicoStatus - volume de OS e tempo medio por status
//   SagaPasso          - duracao e resultado de cada passo da transacao
//   SagaCompensacao    - rollbacks executados (alerta operacional)
//   SagaConcluida      - throughput e duracao ponta a ponta da Saga
export default interface TelemetriaGateway {
  registrarTransicoesStatus(ordemServico: OrdemServico): void;

  registrarPassoSaga(dados: {
    sagaId: string;
    ordemServicoId: string;
    passo: string;
    resultado: ResultadoPassoSaga;
    erro?: string;
  }): void;

  registrarCompensacao(dados: {
    sagaId: string;
    ordemServicoId: string;
    passo: string;
    motivo: string;
  }): void;

  registrarSagaConcluida(dados: {
    sagaId: string;
    ordemServicoId: string;
    duracaoMs: number;
  }): void;

  registrarSagaCompensada(dados: {
    sagaId: string;
    ordemServicoId: string;
    motivo: string;
  }): void;

  registrarFalhaIntegracao(dados: {
    integracao: string;
    operacao: string;
    erro: string;
  }): void;
}
