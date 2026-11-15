import ErroDominio from "../../ErroDominio";
import OrdemServicoRepository from "../../repository/OrdemServicoRepository";
import SagaRepository from "../../repository/SagaRepository";

export type OutputConsultarOrdemServico = {
  id: string;
  clienteId: string;
  veiculoId: string;
  status: string;
  valorTotal: number;
  dataCriacao: Date;
  orcamentoId?: string;
  pagamentoId?: string;
  execucaoId?: string;
  itens: Array<{
    descricao: string;
    tipo: string;
    quantidade: number;
    valorUnitario: number;
    total: number;
  }>;
  // Visao do andamento da transacao distribuida: e o que permite responder
  // "em que ponto do fluxo esta a OS?" sem consultar os outros servicos.
  saga?: {
    id: string;
    estado: string;
    passoAtual: number;
    erro?: string;
    passos: Array<{
      nome: string;
      ordem: number;
      participante: string;
      status: string;
      erro?: string;
    }>;
  };
};

export default class ConsultarOrdemServicoUseCase {
  constructor(
    private readonly ordemServicoRepository: OrdemServicoRepository,
    private readonly sagaRepository: SagaRepository,
  ) {}

  async execute(id: string): Promise<OutputConsultarOrdemServico> {
    const ordemServico = await this.ordemServicoRepository.obter(id);
    if (!ordemServico) {
      throw ErroDominio.naoEncontrado(
        "os.nao.encontrada",
        "Ordem de servico nao encontrada.",
      );
    }

    const saga = await this.sagaRepository.obterPorOrdemServico(id);

    return {
      id: ordemServico.id.getValue(),
      clienteId: ordemServico.clienteId,
      veiculoId: ordemServico.veiculoId,
      status: ordemServico.status,
      valorTotal: ordemServico.valorTotal,
      dataCriacao: ordemServico.dataCriacao,
      orcamentoId: ordemServico.orcamentoId,
      pagamentoId: ordemServico.pagamentoId,
      execucaoId: ordemServico.execucaoId,
      itens: ordemServico.itens.map((item) => ({
        descricao: item.descricao,
        tipo: item.tipo,
        quantidade: item.quantidade,
        valorUnitario: item.valorUnitario,
        total: item.getTotal(),
      })),
      saga: saga
        ? {
            id: saga.id.getValue(),
            estado: saga.estado,
            passoAtual: saga.passoAtual,
            erro: saga.erro,
            passos: saga.passos.map((passo) => ({
              nome: passo.nome,
              ordem: passo.ordem,
              participante: passo.participante,
              status: passo.status,
              erro: passo.erro,
            })),
          }
        : undefined,
    };
  }
}
