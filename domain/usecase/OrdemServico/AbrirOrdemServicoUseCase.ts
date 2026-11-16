import OrdemServico from "../../entity/OrdemServico";
import ItemOrdemServico, { TipoItem } from "../../entity/ItemOrdemServico";
import ErroDominio from "../../ErroDominio";
import ClienteRepository from "../../repository/ClienteRepository";
import CatalogoRepository from "../../repository/CatalogoRepository";
import OrdemServicoRepository from "../../repository/OrdemServicoRepository";
import VeiculoRepository from "../../repository/VeiculoRepository";
import SagaOrquestrador from "../../saga/SagaOrquestrador";
import { ItemOrcamento } from "../../../src/messaging/contracts";

export type ItemEntrada = { id: string; quantidade: number };

export type InputAbrirOrdemServico = {
  clienteId: string;
  veiculoId: string;
  itens: ItemEntrada[];
  correlationId: string;
  // Opcoes de demonstracao do rollback no video: forcam uma falha controlada
  // no participante indicado. Nao fazem parte do fluxo de negocio normal.
  simularFalhaPagamento?: boolean;
  simularFalhaExecucao?: boolean;
};

export type OutputAbrirOrdemServico = {
  ordemServicoId: string;
  sagaId: string;
  status: string;
  valorEstimado: number;
};

// Caso de uso que abre a OS e dispara a Saga.
//
// A transacao local (gravar a OS no MySQL do OS Service) e a publicacao do
// primeiro comando acontecem aqui, na mesma unidade de trabalho logica - e o
// "tudo ou nada" citado na Aula 5 do SAGA Pattern: se a OS nao for gravada, a
// Saga nao comeca.
export default class AbrirOrdemServicoUseCase {
  constructor(
    private readonly ordemServicoRepository: OrdemServicoRepository,
    private readonly clienteRepository: ClienteRepository,
    private readonly veiculoRepository: VeiculoRepository,
    private readonly catalogoRepository: CatalogoRepository,
    private readonly orquestrador: SagaOrquestrador,
  ) {}

  async execute(input: InputAbrirOrdemServico): Promise<OutputAbrirOrdemServico> {
    const cliente = await this.clienteRepository.obter(input.clienteId);
    if (!cliente) {
      throw ErroDominio.naoEncontrado(
        "cliente.nao.encontrado",
        "Cliente nao encontrado.",
      );
    }
    if (!cliente.estaAtivo()) {
      throw new ErroDominio("cliente.inativo", "Cliente esta inativo.", 409);
    }

    const veiculo = await this.veiculoRepository.obter(input.veiculoId);
    if (!veiculo) {
      throw ErroDominio.naoEncontrado(
        "veiculo.nao.encontrado",
        "Veiculo nao encontrado.",
      );
    }
    if (veiculo.clienteId !== cliente.id.getValue()) {
      throw new ErroDominio(
        "veiculo.de.outro.cliente",
        "O veiculo informado nao pertence a este cliente.",
        409,
      );
    }

    if (!input.itens || input.itens.length === 0) {
      throw new ErroDominio(
        "os.itens.obrigatorios",
        "Informe ao menos um item (servico, peca ou insumo) para a ordem de servico.",
      );
    }

    const { itensDominio, itensMensagem } = await this.montarItens(input.itens);

    const ordemServico = new OrdemServico(
      undefined,
      cliente.id.getValue(),
      veiculo.id.getValue(),
    );
    ordemServico.definirItens(itensDominio);

    await this.ordemServicoRepository.salvar(ordemServico);

    // As flags de simulacao vao JUNTO com a criacao da Saga: os passos 4 e 5
    // recarregam a Saga do banco antes de publicar o comando, portanto elas
    // precisam estar persistidas desde o inicio para serem repassadas ao
    // participante quando o passo correspondente for executado.
    const saga = await this.orquestrador.iniciar(
      ordemServico,
      input.correlationId,
      itensMensagem,
      cliente.email?.getValue(),
      {
        simularFalhaPagamento: input.simularFalhaPagamento,
        simularFalhaExecucao: input.simularFalhaExecucao,
      },
    );

    ordemServico.sagaId = saga.id.getValue();
    await this.ordemServicoRepository.atualizar(ordemServico);

    return {
      ordemServicoId: ordemServico.id.getValue(),
      sagaId: saga.id.getValue(),
      status: ordemServico.status,
      valorEstimado: ordemServico.valorTotal,
    };
  }

  private async montarItens(entradas: ItemEntrada[]): Promise<{
    itensDominio: ItemOrdemServico[];
    itensMensagem: ItemOrcamento[];
  }> {
    const itensDominio: ItemOrdemServico[] = [];
    const itensMensagem: ItemOrcamento[] = [];

    for (const entrada of entradas) {
      const catalogo = await this.catalogoRepository.obter(entrada.id);
      if (!catalogo) {
        throw ErroDominio.naoEncontrado(
          "catalogo.item.nao.encontrado",
          `Item ${entrada.id} nao encontrado no catalogo.`,
        );
      }

      if (
        catalogo.estoque !== null &&
        catalogo.estoque !== undefined &&
        catalogo.estoque < entrada.quantidade
      ) {
        throw new ErroDominio(
          "catalogo.estoque.insuficiente",
          `Estoque insuficiente para "${catalogo.descricao}" (disponivel: ${catalogo.estoque}).`,
          409,
        );
      }

      const item = new ItemOrdemServico({
        referenciaId: catalogo.id,
        descricao: catalogo.descricao,
        tipo: catalogo.tipo as TipoItem,
        quantidade: entrada.quantidade,
        valorUnitario: catalogo.valorUnitario,
      });

      itensDominio.push(item);
      itensMensagem.push({
        id: catalogo.id,
        descricao: catalogo.descricao,
        quantidade: entrada.quantidade,
        valorUnitario: catalogo.valorUnitario,
        tipo: catalogo.tipo,
      });
    }

    return { itensDominio, itensMensagem };
  }
}
