import type { Knex } from "knex";
import CatalogoRepository, { ItemCatalogo } from "../CatalogoRepository";

type LinhaCatalogo = {
  id: string;
  descricao: string;
  tipo: ItemCatalogo["tipo"];
  valor_unitario: string | number;
  estoque: number | null;
};

export default class CatalogoRepositoryMySQL implements CatalogoRepository {
  constructor(private readonly db: Knex) {}

  async obter(id: string): Promise<ItemCatalogo | null> {
    const linha = await this.db("catalogo_itens")
      .where({ id })
      .first<LinhaCatalogo | undefined>();
    return linha ? this.hidratar(linha) : null;
  }

  async listar(tipo?: ItemCatalogo["tipo"]): Promise<ItemCatalogo[]> {
    const consulta = this.db("catalogo_itens").select<LinhaCatalogo[]>("*");
    if (tipo) consulta.where({ tipo });

    const linhas = await consulta.orderBy("descricao", "asc");
    return linhas.map((linha) => this.hidratar(linha));
  }

  async salvar(item: ItemCatalogo): Promise<void> {
    await this.db("catalogo_itens")
      .insert({
        id: item.id,
        descricao: item.descricao,
        tipo: item.tipo,
        valor_unitario: item.valorUnitario,
        estoque: item.estoque ?? null,
      })
      .onConflict("id")
      .merge(["descricao", "tipo", "valor_unitario", "estoque"]);
  }

  async excluir(id: string): Promise<void> {
    await this.db("catalogo_itens").where({ id }).del();
  }

  private hidratar(linha: LinhaCatalogo): ItemCatalogo {
    return {
      id: linha.id,
      descricao: linha.descricao,
      tipo: linha.tipo,
      valorUnitario: Number(linha.valor_unitario),
      estoque: linha.estoque === null ? null : Number(linha.estoque),
    };
  }
}
