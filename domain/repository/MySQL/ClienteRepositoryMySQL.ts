import type { Knex } from "knex";
import Cliente, { StatusCliente } from "../../entity/Cliente";
import ID from "../../vo/ID";
import ClienteRepository from "../ClienteRepository";

type LinhaCliente = {
  id: string;
  documento: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  status: StatusCliente;
};

export default class ClienteRepositoryMySQL implements ClienteRepository {
  constructor(private readonly db: Knex) {}

  async salvar(cliente: Cliente): Promise<void> {
    await this.db("clientes").insert(this.paraLinha(cliente));
  }

  async atualizar(cliente: Cliente): Promise<void> {
    await this.db("clientes")
      .where({ id: cliente.id.getValue() })
      .update({
        nome: cliente.nome,
        email: cliente.email?.getValue() ?? null,
        telefone: cliente.telefone ?? null,
        status: cliente.status,
        updated_at: new Date(),
      });
  }

  private paraLinha(cliente: Cliente) {
    return {
      id: cliente.id.getValue(),
      documento: cliente.documento.getValue(),
      nome: cliente.nome,
      email: cliente.email?.getValue() ?? null,
      telefone: cliente.telefone ?? null,
      status: cliente.status,
    };
  }

  async obter(id: string): Promise<Cliente | null> {
    const linha = await this.db("clientes")
      .where({ id })
      .first<LinhaCliente | undefined>();
    return linha ? this.hidratar(linha) : null;
  }

  async obterPorDocumento(documento: string): Promise<Cliente | null> {
    const linha = await this.db("clientes")
      .where({ documento: documento.replace(/\D/g, "") })
      .first<LinhaCliente | undefined>();
    return linha ? this.hidratar(linha) : null;
  }

  async listar(): Promise<Cliente[]> {
    const linhas = await this.db("clientes")
      .orderBy("nome", "asc")
      .select<LinhaCliente[]>("*");
    return linhas.map((linha) => this.hidratar(linha));
  }

  async excluir(id: string): Promise<void> {
    await this.db("clientes").where({ id }).del();
  }

  private hidratar(linha: LinhaCliente): Cliente {
    return new Cliente({
      id: new ID(linha.id),
      documento: linha.documento,
      nome: linha.nome,
      email: linha.email ?? undefined,
      telefone: linha.telefone ?? undefined,
      status: linha.status,
    });
  }
}
