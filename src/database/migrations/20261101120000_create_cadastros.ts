import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("clientes", (table) => {
    table.uuid("id").primary();
    table.string("documento", 14).notNullable().unique();
    table.string("nome", 150).notNullable();
    table.string("email", 150).nullable();
    table.string("telefone", 20).nullable();
    table.enum("status", ["ATIVO", "INATIVO"]).notNullable().defaultTo("ATIVO");
    table.timestamps(true, true);
  });

  await knex.schema.createTable("veiculos", (table) => {
    table.uuid("id").primary();
    table.string("placa", 7).notNullable().unique();
    table.uuid("cliente_id").notNullable();
    table.string("marca", 60).notNullable();
    table.string("modelo", 60).notNullable();
    table.integer("ano").notNullable();
    table.timestamps(true, true);

    table
      .foreign("cliente_id")
      .references("id")
      .inTable("clientes")
      .onDelete("RESTRICT");
    table.index(["cliente_id"], "idx_veiculos_cliente");
  });

  await knex.schema.createTable("catalogo_itens", (table) => {
    table.string("id", 60).primary();
    table.string("descricao", 150).notNullable();
    table.enum("tipo", ["SERVICO", "PECA", "INSUMO"]).notNullable();
    table.decimal("valor_unitario", 12, 2).notNullable();
    // Servicos nao tem estoque; pecas e insumos tem.
    table.integer("estoque").nullable();
    table.timestamps(true, true);

    table.index(["tipo"], "idx_catalogo_tipo");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("catalogo_itens");
  await knex.schema.dropTableIfExists("veiculos");
  await knex.schema.dropTableIfExists("clientes");
}
