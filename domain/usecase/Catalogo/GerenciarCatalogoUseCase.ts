import { randomUUID } from "crypto";
import ErroDominio from "../../ErroDominio";
import CatalogoRepository, {
  ItemCatalogo,
} from "../../repository/CatalogoRepository";

export type InputItemCatalogo = {
  descricao: string;
  tipo: ItemCatalogo["tipo"];
  valorUnitario: number;
  estoque?: number | null;
};

const TIPOS_VALIDOS: ItemCatalogo["tipo"][] = ["SERVICO", "PECA", "INSUMO"];

// Catalogo de servicos, pecas e insumos cobraveis.
//
// Servicos nao tem estoque (estoque = null); pecas e insumos tem. A validacao
// de disponibilidade acontece na abertura da OS, antes de a Saga comecar - e
// mais barato recusar cedo do que compensar depois.
export default class GerenciarCatalogoUseCase {
  constructor(private readonly catalogoRepository: CatalogoRepository) {}

  async criar(input: InputItemCatalogo): Promise<ItemCatalogo> {
    this.validar(input);

    const item: ItemCatalogo = {
      id: randomUUID(),
      descricao: input.descricao.trim(),
      tipo: input.tipo,
      valorUnitario: input.valorUnitario,
      estoque: input.tipo === "SERVICO" ? null : (input.estoque ?? 0),
    };

    await this.catalogoRepository.salvar(item);
    return item;
  }

  async obter(id: string): Promise<ItemCatalogo> {
    const item = await this.catalogoRepository.obter(id);
    if (!item) {
      throw ErroDominio.naoEncontrado(
        "catalogo.item.nao.encontrado",
        "Item do catalogo nao encontrado.",
      );
    }
    return item;
  }

  async listar(tipo?: ItemCatalogo["tipo"]): Promise<ItemCatalogo[]> {
    if (tipo && !TIPOS_VALIDOS.includes(tipo)) {
      throw new ErroDominio(
        "catalogo.tipo.invalido",
        `Tipo invalido. Use um de: ${TIPOS_VALIDOS.join(", ")}.`,
      );
    }
    return this.catalogoRepository.listar(tipo);
  }

  async atualizar(id: string, input: Partial<InputItemCatalogo>): Promise<ItemCatalogo> {
    const atual = await this.obter(id);

    const atualizado: ItemCatalogo = {
      ...atual,
      descricao: input.descricao?.trim() ?? atual.descricao,
      valorUnitario: input.valorUnitario ?? atual.valorUnitario,
      estoque: input.estoque !== undefined ? input.estoque : atual.estoque,
    };

    this.validar({
      descricao: atualizado.descricao,
      tipo: atualizado.tipo,
      valorUnitario: atualizado.valorUnitario,
      estoque: atualizado.estoque,
    });

    await this.catalogoRepository.salvar(atualizado);
    return atualizado;
  }

  async excluir(id: string) {
    await this.obter(id);
    await this.catalogoRepository.excluir(id);
    return { id, excluido: true };
  }

  private validar(input: InputItemCatalogo) {
    if (!input.descricao || input.descricao.trim().length < 3) {
      throw new ErroDominio(
        "catalogo.descricao.invalida",
        "Descricao deve ter ao menos 3 caracteres.",
      );
    }
    if (!TIPOS_VALIDOS.includes(input.tipo)) {
      throw new ErroDominio(
        "catalogo.tipo.invalido",
        `Tipo invalido. Use um de: ${TIPOS_VALIDOS.join(", ")}.`,
      );
    }
    if (!Number.isFinite(input.valorUnitario) || input.valorUnitario < 0) {
      throw new ErroDominio(
        "catalogo.valor.invalido",
        "Valor unitario nao pode ser negativo.",
      );
    }
    if (
      input.estoque !== null &&
      input.estoque !== undefined &&
      input.estoque < 0
    ) {
      throw new ErroDominio(
        "catalogo.estoque.invalido",
        "Estoque nao pode ser negativo.",
      );
    }
  }
}
