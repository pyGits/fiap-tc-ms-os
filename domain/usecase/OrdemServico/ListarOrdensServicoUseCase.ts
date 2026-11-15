import { StatusOrdemServico } from "../../entity/OrdemServico";
import OrdemServicoRepository from "../../repository/OrdemServicoRepository";

export type InputListarOrdensServico = {
  status?: string;
  clienteId?: string;
};

export default class ListarOrdensServicoUseCase {
  constructor(private readonly ordemServicoRepository: OrdemServicoRepository) {}

  async execute(input: InputListarOrdensServico = {}) {
    const status = input.status
      ? (input.status.toUpperCase() as StatusOrdemServico)
      : undefined;

    const ordens = await this.ordemServicoRepository.listar({
      status,
      clienteId: input.clienteId,
    });

    return ordens.map((ordemServico) => ({
      id: ordemServico.id.getValue(),
      clienteId: ordemServico.clienteId,
      veiculoId: ordemServico.veiculoId,
      status: ordemServico.status,
      valorTotal: ordemServico.valorTotal,
      dataCriacao: ordemServico.dataCriacao,
      sagaId: ordemServico.sagaId,
    }));
  }
}
