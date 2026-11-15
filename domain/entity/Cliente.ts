import ErroDominio from "../ErroDominio";
import CPFCNPJ from "../vo/CPFCNPJ";
import Email from "../vo/Email";
import ID from "../vo/ID";

export enum StatusCliente {
  ATIVO = "ATIVO",
  INATIVO = "INATIVO",
}

export default class Cliente {
  readonly id: ID;
  readonly documento: CPFCNPJ;
  nome: string;
  email?: Email;
  telefone?: string;
  status: StatusCliente;

  constructor(dados: {
    id?: ID;
    documento: string;
    nome: string;
    email?: string;
    telefone?: string;
    status?: StatusCliente;
  }) {
    if (!dados.nome || dados.nome.trim().length < 3) {
      throw new ErroDominio(
        "cliente.nome.invalido",
        "Nome do cliente deve ter ao menos 3 caracteres.",
      );
    }

    this.id = dados.id ?? new ID();
    this.documento = new CPFCNPJ(dados.documento);
    this.nome = dados.nome.trim();
    this.email = dados.email ? new Email(dados.email) : undefined;
    this.telefone = dados.telefone;
    this.status = dados.status ?? StatusCliente.ATIVO;
  }

  atualizar(dados: { nome?: string; email?: string; telefone?: string }) {
    if (dados.nome !== undefined) {
      if (dados.nome.trim().length < 3) {
        throw new ErroDominio(
          "cliente.nome.invalido",
          "Nome do cliente deve ter ao menos 3 caracteres.",
        );
      }
      this.nome = dados.nome.trim();
    }
    if (dados.email !== undefined) this.email = new Email(dados.email);
    if (dados.telefone !== undefined) this.telefone = dados.telefone;
  }

  inativar() {
    this.status = StatusCliente.INATIVO;
  }

  ativar() {
    this.status = StatusCliente.ATIVO;
  }

  estaAtivo(): boolean {
    return this.status === StatusCliente.ATIVO;
  }
}
