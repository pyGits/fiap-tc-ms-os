import Veiculo from "../../entity/Veiculo";
import VeiculoRepository from "../VeiculoRepository";

export default class VeiculoRepositoryMemoria implements VeiculoRepository {
  private readonly registros = new Map<string, Veiculo>();

  async salvar(veiculo: Veiculo): Promise<void> {
    this.registros.set(veiculo.id.getValue(), veiculo);
  }

  async obter(id: string): Promise<Veiculo | null> {
    return this.registros.get(id) ?? null;
  }

  async obterPorPlaca(placa: string): Promise<Veiculo | null> {
    const normalizada = placa.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    return (
      [...this.registros.values()].find(
        (veiculo) => veiculo.placa.getValue() === normalizada,
      ) ?? null
    );
  }

  async listarPorCliente(clienteId: string): Promise<Veiculo[]> {
    return [...this.registros.values()].filter(
      (veiculo) => veiculo.clienteId === clienteId,
    );
  }

  async listar(): Promise<Veiculo[]> {
    return [...this.registros.values()];
  }

  async excluir(id: string): Promise<void> {
    this.registros.delete(id);
  }

  limpar() {
    this.registros.clear();
  }
}
