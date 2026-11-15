import ErroDominio from "../ErroDominio";
import ID from "../vo/ID";

export enum TipoItem {
  SERVICO = "SERVICO",
  PECA = "PECA",
  INSUMO = "INSUMO",
}

// Item do orcamento da OS (mao de obra, peca ou insumo).
//
// Na Fase 3 havia tres classes quase identicas (ItemServico, ItemPeca,
// ItemInsumo). Aqui elas foram unificadas em uma unica entidade com o tipo como
// atributo: menos duplicacao, mesma regra de negocio e um unico ponto de teste.
export default class ItemOrdemServico {
  readonly id: ID;
  readonly referenciaId: string;
  readonly descricao: string;
  readonly tipo: TipoItem;
  readonly quantidade: number;
  readonly valorUnitario: number;

  constructor(dados: {
    id?: ID;
    referenciaId: string;
    descricao: string;
    tipo: TipoItem;
    quantidade: number;
    valorUnitario: number;
  }) {
    if (!dados.descricao || dados.descricao.trim().length === 0) {
      throw new ErroDominio("item.descricao.obrigatoria", "Descricao do item e obrigatoria.");
    }
    if (!Number.isFinite(dados.quantidade) || dados.quantidade <= 0) {
      throw new ErroDominio(
        "item.quantidade.invalida",
        "Quantidade do item deve ser maior que zero.",
      );
    }
    if (!Number.isFinite(dados.valorUnitario) || dados.valorUnitario < 0) {
      throw new ErroDominio(
        "item.valor.invalido",
        "Valor unitario do item nao pode ser negativo.",
      );
    }

    this.id = dados.id ?? new ID();
    this.referenciaId = dados.referenciaId;
    this.descricao = dados.descricao.trim();
    this.tipo = dados.tipo;
    this.quantidade = dados.quantidade;
    this.valorUnitario = dados.valorUnitario;
  }

  getTotal(): number {
    return Number((this.quantidade * this.valorUnitario).toFixed(2));
  }
}
