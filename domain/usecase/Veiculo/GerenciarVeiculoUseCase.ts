import Veiculo from "../../entity/Veiculo";
import ErroDominio from "../../ErroDominio";
import ClienteRepository from "../../repository/ClienteRepository";
import VeiculoRepository from "../../repository/VeiculoRepository";

export type InputCriarVeiculo = {
  placa: string;
  clienteId: string;
  marca: string;
  modelo: string;
  ano: number;
};

export default class GerenciarVeiculoUseCase {
  constructor(
    private readonly veiculoRepository: VeiculoRepository,
    private readonly clienteRepository: ClienteRepository,
  ) {}

  async criar(input: InputCriarVeiculo) {
    const cliente = await this.clienteRepository.obter(input.clienteId);
    if (!cliente) {
      throw ErroDominio.naoEncontrado(
        "cliente.nao.encontrado",
        "Cliente nao encontrado.",
      );
    }

    const veiculo = new Veiculo(input);

    const existente = await this.veiculoRepository.obterPorPlaca(
      veiculo.placa.getValue(),
    );
    if (existente) {
      throw ErroDominio.conflito(
        "veiculo.placa.duplicada",
        "Ja existe um veiculo cadastrado com esta placa.",
      );
    }

    await this.veiculoRepository.salvar(veiculo);
    return this.apresentar(veiculo);
  }

  async obter(id: string) {
    const veiculo = await this.veiculoRepository.obter(id);
    if (!veiculo) {
      throw ErroDominio.naoEncontrado(
        "veiculo.nao.encontrado",
        "Veiculo nao encontrado.",
      );
    }
    return this.apresentar(veiculo);
  }

  async listar(clienteId?: string) {
    const veiculos = clienteId
      ? await this.veiculoRepository.listarPorCliente(clienteId)
      : await this.veiculoRepository.listar();

    return veiculos.map((veiculo) => this.apresentar(veiculo));
  }

  async excluir(id: string) {
    const veiculo = await this.veiculoRepository.obter(id);
    if (!veiculo) {
      throw ErroDominio.naoEncontrado(
        "veiculo.nao.encontrado",
        "Veiculo nao encontrado.",
      );
    }

    await this.veiculoRepository.excluir(id);
    return { id, excluido: true };
  }

  private apresentar(veiculo: Veiculo) {
    return {
      id: veiculo.id.getValue(),
      placa: veiculo.placa.getValue(),
      mercosul: veiculo.placa.isMercosul(),
      clienteId: veiculo.clienteId,
      marca: veiculo.marca,
      modelo: veiculo.modelo,
      ano: veiculo.ano,
      descricao: veiculo.descricao(),
    };
  }
}
