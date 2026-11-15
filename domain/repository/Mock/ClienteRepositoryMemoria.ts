import Cliente from "../../entity/Cliente";
import ClienteRepository from "../ClienteRepository";

export default class ClienteRepositoryMemoria implements ClienteRepository {
  private readonly registros = new Map<string, Cliente>();

  async salvar(cliente: Cliente): Promise<void> {
    this.registros.set(cliente.id.getValue(), cliente);
  }

  async atualizar(cliente: Cliente): Promise<void> {
    this.registros.set(cliente.id.getValue(), cliente);
  }

  async obter(id: string): Promise<Cliente | null> {
    return this.registros.get(id) ?? null;
  }

  async obterPorDocumento(documento: string): Promise<Cliente | null> {
    const somenteDigitos = documento.replace(/\D/g, "");
    return (
      [...this.registros.values()].find(
        (cliente) => cliente.documento.getValue() === somenteDigitos,
      ) ?? null
    );
  }

  async listar(): Promise<Cliente[]> {
    return [...this.registros.values()];
  }

  async excluir(id: string): Promise<void> {
    this.registros.delete(id);
  }

  limpar() {
    this.registros.clear();
  }
}
