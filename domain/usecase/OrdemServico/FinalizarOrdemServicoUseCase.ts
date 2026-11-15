import ErroDominio from "../../ErroDominio";
import TelemetriaGateway from "../../gateway/TelemetriaGateway";
import OrdemServicoRepository from "../../repository/OrdemServicoRepository";

export type InputFinalizarOrdemServico = {
  ordemServicoId: string;
  execucaoId?: string;
};

// Disparado pelo evento EXECUCAO_FINALIZADA vindo do servico de Execucao.
//
// Este trecho e COREOGRAFADO: a execucao termina quando o mecanico conclui o
// reparo, fora do caminho sincrono da Saga. O servico de Execucao apenas
// publica o fato e o OS Service reage, sem que nenhum dos dois conheca o outro.
export default class FinalizarOrdemServicoUseCase {
  constructor(
    private readonly ordemServicoRepository: OrdemServicoRepository,
    private readonly telemetria: TelemetriaGateway,
  ) {}

  async execute(input: InputFinalizarOrdemServico) {
    const ordemServico = await this.ordemServicoRepository.obter(
      input.ordemServicoId,
    );
    if (!ordemServico) {
      throw ErroDominio.naoEncontrado(
        "os.nao.encontrada",
        "Ordem de servico nao encontrada.",
      );
    }

    ordemServico.finalizar();
    await this.ordemServicoRepository.atualizar(ordemServico);
    this.telemetria.registrarTransicoesStatus(ordemServico);

    return {
      ordemServicoId: ordemServico.id.getValue(),
      status: ordemServico.status,
    };
  }
}
