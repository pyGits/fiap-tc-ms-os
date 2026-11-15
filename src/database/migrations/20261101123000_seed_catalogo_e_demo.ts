import type { Knex } from "knex";

// Dados minimos para a demonstracao do video e para os testes de integracao.
// CPFs de teste gerados em gerador de CPF ficticio - nao sao dados reais.
const CATALOGO = [
  {
    id: "srv-revisao",
    descricao: "Revisao completa",
    tipo: "SERVICO",
    valor_unitario: 450,
    estoque: null,
  },
  {
    id: "srv-troca-oleo",
    descricao: "Troca de oleo",
    tipo: "SERVICO",
    valor_unitario: 120,
    estoque: null,
  },
  {
    id: "srv-alinhamento",
    descricao: "Alinhamento e balanceamento",
    tipo: "SERVICO",
    valor_unitario: 180,
    estoque: null,
  },
  {
    id: "srv-troca-pastilhas",
    descricao: "Troca de pastilhas de freio",
    tipo: "SERVICO",
    valor_unitario: 220,
    estoque: null,
  },
  {
    id: "pec-filtro-oleo",
    descricao: "Filtro de oleo",
    tipo: "PECA",
    valor_unitario: 65.5,
    estoque: 30,
  },
  {
    id: "pec-pastilha-freio",
    descricao: "Pastilha de freio dianteira",
    tipo: "PECA",
    valor_unitario: 289.9,
    estoque: 12,
  },
  {
    id: "pec-filtro-ar",
    descricao: "Filtro de ar",
    tipo: "PECA",
    valor_unitario: 89.9,
    estoque: 25,
  },
  {
    id: "ins-oleo-5w30",
    descricao: "Oleo sintetico 5W30 (litro)",
    tipo: "INSUMO",
    valor_unitario: 48.9,
    estoque: 100,
  },
  {
    id: "ins-fluido-freio",
    descricao: "Fluido de freio DOT4 (500ml)",
    tipo: "INSUMO",
    valor_unitario: 32.5,
    estoque: 40,
  },
];

const CLIENTE_DEMO_ID = "11111111-1111-4111-8111-111111111111";
const VEICULO_DEMO_ID = "22222222-2222-4222-8222-222222222222";

export async function up(knex: Knex): Promise<void> {
  const existentes = await knex("catalogo_itens").count({ total: "id" }).first();
  if (!Number(existentes?.total ?? 0)) {
    await knex("catalogo_itens").insert(CATALOGO);
  }

  const cliente = await knex("clientes").where({ id: CLIENTE_DEMO_ID }).first();
  if (!cliente) {
    await knex("clientes").insert({
      id: CLIENTE_DEMO_ID,
      documento: "52998224725",
      nome: "Cliente Demonstracao",
      email: "cliente.demo@oficina.local",
      telefone: "11999990000",
      status: "ATIVO",
    });
  }

  const veiculo = await knex("veiculos").where({ id: VEICULO_DEMO_ID }).first();
  if (!veiculo) {
    await knex("veiculos").insert({
      id: VEICULO_DEMO_ID,
      placa: "ABC1D23",
      cliente_id: CLIENTE_DEMO_ID,
      marca: "Volkswagen",
      modelo: "Gol",
      ano: 2019,
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex("veiculos").where({ id: VEICULO_DEMO_ID }).del();
  await knex("clientes").where({ id: CLIENTE_DEMO_ID }).del();
  await knex("catalogo_itens")
    .whereIn(
      "id",
      CATALOGO.map((item) => item.id),
    )
    .del();
}
