import SagaOrquestrador from "../../saga/SagaOrquestrador";
import OrdemServicoRepository from "../../repository/OrdemServicoRepository";
import ErroDominio from "../../ErroDominio";

export type InputDecidirOrcamento = {
  ordemServicoId: string;
  aprovado: boolean;
  motivoRecusa?: string;
};

export type OutputDecidirOrcamento = {
  ordemServicoId: string;
  status: string;
  aprovado: boolean;
};

// Passo 3 da Saga: decisao do cliente sobre o orcamento.
//
// Chega por REST (sincrono) porque e um humano quem decide; a partir daqui o
// orquestrador retoma o fluxo assincrono - ou dispara a compensacao, se a
// resposta for uma recusa.
export default class DecidirOrcamentoUseCase {
  constructor(
    private readonly orquestrador: SagaOrquestrador,
    private readonly ordemServicoRepository: OrdemServicoRepository,
  ) {}

  async execute(input: InputDecidirOrcamento): Promise<OutputDecidirOrcamento> {
    if (typeof input.aprovado !== "boolean") {
      throw new ErroDominio(
        "aprovacao.invalida",
        'O campo "aprovado" e obrigatorio e deve ser booleano.',
      );
    }

    await this.orquestrador.aprovacaoRecebida(
      input.ordemServicoId,
      input.aprovado,
      input.motivoRecusa,
    );

    const ordemServico = await this.ordemServicoRepository.obter(
      input.ordemServicoId,
    );
    if (!ordemServico) {
      throw ErroDominio.naoEncontrado(
        "os.nao.encontrada",
        "Ordem de servico nao encontrada.",
      );
    }

    return {
      ordemServicoId: input.ordemServicoId,
      status: ordemServico.status,
      aprovado: input.aprovado,
    };
  }
}
