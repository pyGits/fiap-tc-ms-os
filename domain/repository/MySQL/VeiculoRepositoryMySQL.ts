import type { Knex } from "knex";
import Veiculo from "../../entity/Veiculo";
import ID from "../../vo/ID";
import VeiculoRepository from "../VeiculoRepository";

type LinhaVeiculo = {
  id: string;
  placa: string;
  cliente_id: string;
  marca: string;
  modelo: string;
  ano: number;
};

export default class VeiculoRepositoryMySQL implements VeiculoRepository {
  constructor(private readonly db: Knex) {}

  async salvar(veiculo: Veiculo): Promise<void> {
    await this.db("veiculos").insert({
      id: veiculo.id.getValue(),
      placa: veiculo.placa.getValue(),
      cliente_id: veiculo.clienteId,
      marca: veiculo.marca,
      modelo: veiculo.modelo,
      ano: veiculo.ano,
    });
  }

  async obter(id: string): Promise<Veiculo | null> {
    const linha = await this.db("veiculos")
      .where({ id })
      .first<LinhaVeiculo | undefined>();
    return linha ? this.hidratar(linha) : null;
  }

  async obterPorPlaca(placa: string): Promise<Veiculo | null> {
    const linha = await this.db("veiculos")
      .where({ placa: placa.replace(/[^A-Za-z0-9]/g, "").toUpperCase() })
      .first<LinhaVeiculo | undefined>();
    return linha ? this.hidratar(linha) : null;
  }

  async listarPorCliente(clienteId: string): Promise<Veiculo[]> {
    const linhas = await this.db("veiculos")
      .where({ cliente_id: clienteId })
      .select<LinhaVeiculo[]>("*");
    return linhas.map((linha) => this.hidratar(linha));
  }

  async listar(): Promise<Veiculo[]> {
    const linhas = await this.db("veiculos")
      .orderBy("placa", "asc")
      .select<LinhaVeiculo[]>("*");
    return linhas.map((linha) => this.hidratar(linha));
  }

  async excluir(id: string): Promise<void> {
    await this.db("veiculos").where({ id }).del();
  }

  private hidratar(linha: LinhaVeiculo): Veiculo {
    return new Veiculo({
      id: new ID(linha.id),
      placa: linha.placa,
      clienteId: linha.cliente_id,
      marca: linha.marca,
      modelo: linha.modelo,
      ano: Number(linha.ano),
    });
  }
}
