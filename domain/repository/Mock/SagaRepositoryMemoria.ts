import SagaOrdemServico, { EstadoSaga } from "../../saga/SagaOrdemServico";
import SagaRepository from "../SagaRepository";

export default class SagaRepositoryMemoria implements SagaRepository {
  private readonly registros = new Map<string, SagaOrdemServico>();

  async salvar(saga: SagaOrdemServico): Promise<void> {
    this.registros.set(saga.id.getValue(), saga);
  }

  async obter(id: string): Promise<SagaOrdemServico | null> {
    return this.registros.get(id) ?? null;
  }

  async obterPorOrdemServico(
    ordemServicoId: string,
  ): Promise<SagaOrdemServico | null> {
    return (
      [...this.registros.values()].find(
        (saga) => saga.ordemServicoId === ordemServicoId,
      ) ?? null
    );
  }

  async listarPorEstado(estado: EstadoSaga): Promise<SagaOrdemServico[]> {
    return [...this.registros.values()].filter((saga) => saga.estado === estado);
  }

  limpar() {
    this.registros.clear();
  }
}
