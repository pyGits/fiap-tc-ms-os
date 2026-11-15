import Cliente from "../entity/Cliente";

export default interface ClienteRepository {
  salvar(cliente: Cliente): Promise<void>;
  atualizar(cliente: Cliente): Promise<void>;
  obter(id: string): Promise<Cliente | null>;
  obterPorDocumento(documento: string): Promise<Cliente | null>;
  listar(): Promise<Cliente[]>;
  excluir(id: string): Promise<void>;
}
