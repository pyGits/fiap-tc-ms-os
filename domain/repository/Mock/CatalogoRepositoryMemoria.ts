import CatalogoRepository, { ItemCatalogo } from "../CatalogoRepository";

// Catalogo em memoria com itens tipicos de uma oficina mecanica, usado nos
// testes unitarios e nos cenarios BDD.
export const CATALOGO_PADRAO: ItemCatalogo[] = [
  {
    id: "srv-revisao",
    descricao: "Revisao completa",
    tipo: "SERVICO",
    valorUnitario: 450,
    estoque: null,
  },
  {
    id: "srv-troca-oleo",
    descricao: "Troca de oleo",
    tipo: "SERVICO",
    valorUnitario: 120,
    estoque: null,
  },
  {
    id: "srv-alinhamento",
    descricao: "Alinhamento e balanceamento",
    tipo: "SERVICO",
    valorUnitario: 180,
    estoque: null,
  },
  {
    id: "pec-filtro-oleo",
    descricao: "Filtro de oleo",
    tipo: "PECA",
    valorUnitario: 65.5,
    estoque: 30,
  },
  {
    id: "pec-pastilha-freio",
    descricao: "Pastilha de freio dianteira",
    tipo: "PECA",
    valorUnitario: 289.9,
    estoque: 12,
  },
  {
    id: "ins-oleo-5w30",
    descricao: "Oleo sintetico 5W30 (litro)",
    tipo: "INSUMO",
    valorUnitario: 48.9,
    estoque: 100,
  },
];

export default class CatalogoRepositoryMemoria implements CatalogoRepository {
  private readonly registros = new Map<string, ItemCatalogo>();

  constructor(itens: ItemCatalogo[] = CATALOGO_PADRAO) {
    itens.forEach((item) => this.registros.set(item.id, { ...item }));
  }

  async obter(id: string): Promise<ItemCatalogo | null> {
    const item = this.registros.get(id);
    return item ? { ...item } : null;
  }

  async listar(tipo?: ItemCatalogo["tipo"]): Promise<ItemCatalogo[]> {
    const itens = [...this.registros.values()].map((item) => ({ ...item }));
    return tipo ? itens.filter((item) => item.tipo === tipo) : itens;
  }

  async salvar(item: ItemCatalogo): Promise<void> {
    this.registros.set(item.id, { ...item });
  }

  async excluir(id: string): Promise<void> {
    this.registros.delete(id);
  }

  limpar() {
    this.registros.clear();
  }
}
