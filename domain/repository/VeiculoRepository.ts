import Veiculo from "../entity/Veiculo";

export default interface VeiculoRepository {
  salvar(veiculo: Veiculo): Promise<void>;
  obter(id: string): Promise<Veiculo | null>;
  obterPorPlaca(placa: string): Promise<Veiculo | null>;
  listarPorCliente(clienteId: string): Promise<Veiculo[]>;
  listar(): Promise<Veiculo[]>;
  excluir(id: string): Promise<void>;
}
