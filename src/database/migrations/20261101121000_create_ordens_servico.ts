import type { Knex } from "knex";

const STATUS = [
  "RECEBIDA",
  "EM_DIAGNOSTICO",
  "AGUARDANDO_APROVACAO",
  "AGUARDANDO_PAGAMENTO",
  "EM_EXECUCAO",
  "FINALIZADA",
  "ENTREGUE",
  "RECUSADA",
  "CANCELADA",
];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("ordens_servico", (table) => {
    table.uuid("id").primary();
    table.uuid("cliente_id").notNullable();
    table.uuid("veiculo_id").notNullable();
    table.enum("status", STATUS).notNullable().defaultTo("RECEBIDA");
    table.decimal("valor_total", 12, 2).notNullable().defaultTo(0);
    table.timestamp("data_criacao").notNullable().defaultTo(knex.fn.now());
    table.timestamp("data_inicio_execucao").nullable();
    table.timestamp("data_fim_execucao").nullable();
    table.string("motivo_recusa", 255).nullable();
    table.string("motivo_cancelamento", 255).nullable();

    // Referencias por ID para agregados de OUTROS microsservicos.
    // Sao apenas identificadores opacos: nao existe foreign key entre bancos
    // de servicos diferentes, o que preserva o acoplamento fraco.
    table.uuid("saga_id").nullable();
    table.string("orcamento_id", 60).nullable();
    table.string("pagamento_id", 60).nullable();
    table.string("execucao_id", 60).nullable();

    table.timestamps(true, true);

    table
      .foreign("cliente_id")
      .references("id")
      .inTable("clientes")
      .onDelete("RESTRICT");
    table
      .foreign("veiculo_id")
      .references("id")
      .inTable("veiculos")
      .onDelete("RESTRICT");

    table.index(["status"], "idx_os_status");
    table.index(["cliente_id"], "idx_os_cliente");
    table.index(["saga_id"], "idx_os_saga");
  });

  await knex.schema.createTable("ordem_servico_itens", (table) => {
    table.uuid("id").primary();
    table.uuid("ordem_servico_id").notNullable();
    table.string("referencia_id", 60).notNullable();
    table.string("descricao", 150).notNullable();
    table.enum("tipo", ["SERVICO", "PECA", "INSUMO"]).notNullable();
    table.integer("quantidade").notNullable();
    table.decimal("valor_unitario", 12, 2).notNullable();

    table
      .foreign("ordem_servico_id")
      .references("id")
      .inTable("ordens_servico")
      .onDelete("CASCADE");
    table.index(["ordem_servico_id"], "idx_os_itens_os");
  });

  // Historico de transicoes: base do indicador "tempo medio por status"
  // exigido desde a Fase 2 e reaproveitado nos dashboards da Fase 4.
  await knex.schema.createTable("ordem_servico_historico_status", (table) => {
    table.increments("id").primary();
    table.uuid("ordem_servico_id").notNullable();
    table.string("status_anterior", 30).nullable();
    table.string("status_novo", 30).notNullable();
    table.string("motivo", 255).nullable();
    table.timestamp("data").notNullable().defaultTo(knex.fn.now());
    table.bigInteger("duracao_status_anterior_ms").nullable();

    table
      .foreign("ordem_servico_id")
      .references("id")
      .inTable("ordens_servico")
      .onDelete("CASCADE");
    table.index(["ordem_servico_id"], "idx_hist_os");
    table.index(["status_anterior"], "idx_hist_status_anterior");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("ordem_servico_historico_status");
  await knex.schema.dropTableIfExists("ordem_servico_itens");
  await knex.schema.dropTableIfExists("ordens_servico");
}
