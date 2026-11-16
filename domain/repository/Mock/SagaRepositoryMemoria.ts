import ID from "../../vo/ID";
import SagaOrdemServico, { EstadoSaga } from "../../saga/SagaOrdemServico";
import SagaRepository from "../SagaRepository";

// Repositorio de Saga em memoria, usado nos testes e no container de
// desenvolvimento.
//
// IMPORTANTE: `salvar` grava uma COPIA DESACOPLADA da Saga, e `obter` devolve
// uma nova instancia a cada chamada. Isso reproduz o comportamento do
// SagaRepositoryMySQL, que serializa o agregado (e a coluna `dados` como JSON)
// e o reidrata na leitura.
//
// Guardar a propria instancia seria mais simples, mas transformaria este dublê
// em um cache de referencias: uma mutacao feita na entidade DEPOIS do `salvar`
// apareceria na leitura seguinte sem nunca ter sido persistida. Testes
// passariam com codigo que falha contra o banco real - foi exatamente o que
// aconteceu com as flags de simulacao de falha da Saga.
export default class SagaRepositoryMemoria implements SagaRepository {
  private readonly registros = new Map<string, SagaOrdemServico>();

  async salvar(saga: SagaOrdemServico): Promise<void> {
    this.registros.set(saga.id.getValue(), this.copiar(saga));
  }

  async obter(id: string): Promise<SagaOrdemServico | null> {
    const saga = this.registros.get(id);
    return saga ? this.copiar(saga) : null;
  }

  async obterPorOrdemServico(
    ordemServicoId: string,
  ): Promise<SagaOrdemServico | null> {
    const saga = [...this.registros.values()].find(
      (candidata) => candidata.ordemServicoId === ordemServicoId,
    );
    return saga ? this.copiar(saga) : null;
  }

  async listarPorEstado(estado: EstadoSaga): Promise<SagaOrdemServico[]> {
    return [...this.registros.values()]
      .filter((saga) => saga.estado === estado)
      .map((saga) => this.copiar(saga));
  }

  limpar() {
    this.registros.clear();
  }

  // Equivalente ao par salvar/reidratar do repositorio MySQL.
  private copiar(saga: SagaOrdemServico): SagaOrdemServico {
    return new SagaOrdemServico({
      id: new ID(saga.id.getValue()),
      ordemServicoId: saga.ordemServicoId,
      correlationId: saga.correlationId,
      passos: saga.passos.map((passo) => ({
        ...passo,
        resposta: passo.resposta
          ? (JSON.parse(JSON.stringify(passo.resposta)) as Record<
              string,
              unknown
            >)
          : undefined,
      })),
      estado: saga.estado,
      passoAtual: saga.passoAtual,
      dadosNegocio: JSON.parse(JSON.stringify(saga.dados)) as Record<
        string,
        unknown
      >,
      criadaEm: new Date(saga.criadaEm),
      atualizadaEm: new Date(saga.atualizadaEm),
      erro: saga.erro,
    });
  }
}
