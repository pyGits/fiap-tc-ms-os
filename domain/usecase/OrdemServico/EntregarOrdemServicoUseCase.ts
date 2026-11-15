import ErroDominio from "../../ErroDominio";
import TelemetriaGateway from "../../gateway/TelemetriaGateway";
import OrdemServicoRepository from "../../repository/OrdemServicoRepository";

export default class EntregarOrdemServicoUseCase {
  constructor(
    private readonly ordemServicoRepository: OrdemServicoRepository,
    private readonly telemetria: TelemetriaGateway,
  ) {}

  async execute(input: { ordemServicoId: string }) {
    const ordemServico = await this.ordemServicoRepository.obter(
      input.ordemServicoId,
    );
    if (!ordemServico) {
      throw ErroDominio.naoEncontrado(
        "os.nao.encontrada",
        "Ordem de servico nao encontrada.",
      );
    }

    ordemServico.entregar();
    await this.ordemServicoRepository.atualizar(ordemServico);
    this.telemetria.registrarTransicoesStatus(ordemServico);

    return {
      ordemServicoId: ordemServico.id.getValue(),
      status: ordemServico.status,
    };
  }
}
