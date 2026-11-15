import OrdemServicoRepository from "../../repository/OrdemServicoRepository";

// Indicador de negocio da Fase 3 preservado na Fase 4: tempo medio que as
// ordens permanecem em cada status. Alimenta o dashboard de monitoramento.
export default class MonitorarTempoMedioUseCase {
  constructor(private readonly ordemServicoRepository: OrdemServicoRepository) {}

  async execute() {
    const porStatus = await this.ordemServicoRepository.tempoMedioPorStatus();

    return {
      tempoMedioPorStatus: porStatus.map((item) => ({
        status: item.status,
        ordens: item.ordens,
        tempoMedioMs: item.tempoMedioMs,
        tempoMedioMinutos: Number((item.tempoMedioMs / 60000).toFixed(2)),
        tempoMedioHoras: Number((item.tempoMedioMs / 3600000).toFixed(2)),
      })),
    };
  }
}
