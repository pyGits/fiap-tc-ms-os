import SagaOrdemServico, { EstadoSaga } from "../saga/SagaOrdemServico";

// Porta de persistencia do saga log. Precisa ser duravel: e o que permite
// retomar ou compensar uma Saga depois de uma queda do orquestrador.
export default interface SagaRepository {
  salvar(saga: SagaOrdemServico): Promise<void>;
  obter(id: string): Promise<SagaOrdemServico | null>;
  obterPorOrdemServico(ordemServicoId: string): Promise<SagaOrdemServico | null>;
  listarPorEstado(estado: EstadoSaga): Promise<SagaOrdemServico[]>;
}
