// Catalogo de itens cobraveis (servicos, pecas e insumos) usado para montar o
// orcamento. Permanece no OS Service porque e o contexto que abre a OS; o
// Billing apenas recebe os itens ja precificados pela mensagem.
export type ItemCatalogo = {
  id: string;
  descricao: string;
  tipo: "SERVICO" | "PECA" | "INSUMO";
  valorUnitario: number;
  estoque?: number | null;
};

export default interface CatalogoRepository {
  obter(id: string): Promise<ItemCatalogo | null>;
  listar(tipo?: ItemCatalogo["tipo"]): Promise<ItemCatalogo[]>;
  salvar(item: ItemCatalogo): Promise<void>;
  excluir(id: string): Promise<void>;
}
