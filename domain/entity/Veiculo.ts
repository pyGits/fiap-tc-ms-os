import ErroDominio from "../ErroDominio";
import ID from "../vo/ID";
import Placa from "../vo/Placa";

export default class Veiculo {
  readonly id: ID;
  readonly placa: Placa;
  clienteId: string;
  marca: string;
  modelo: string;
  ano: number;

  constructor(dados: {
    id?: ID;
    placa: string;
    clienteId: string;
    marca: string;
    modelo: string;
    ano: number;
  }) {
    if (!dados.marca || !dados.modelo) {
      throw new ErroDominio(
        "veiculo.dados.obrigatorios",
        "Marca e modelo do veiculo sao obrigatorios.",
      );
    }

    const anoAtual = new Date().getFullYear();
    if (!Number.isInteger(dados.ano) || dados.ano < 1900 || dados.ano > anoAtual + 1) {
      throw new ErroDominio(
        "veiculo.ano.invalido",
        `Ano do veiculo deve estar entre 1900 e ${anoAtual + 1}.`,
      );
    }

    this.id = dados.id ?? new ID();
    this.placa = new Placa(dados.placa);
    this.clienteId = dados.clienteId;
    this.marca = dados.marca.trim();
    this.modelo = dados.modelo.trim();
    this.ano = dados.ano;
  }

  descricao(): string {
    return `${this.marca} ${this.modelo} ${this.ano} (${this.placa.getValue()})`;
  }
}
