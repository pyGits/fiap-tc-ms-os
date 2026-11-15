import type { Knex } from "knex";

// Saga log do orquestrador.
//
// A Saga nao e ACID: cada passo e uma transacao local isolada. Persistir o
// estado e o que permite, depois de uma queda do orquestrador, saber em qual
// passo a transacao parou e quais passos ja precisam ser compensados.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("saga_instancias", (table) => {
    table.uuid("id").primary();
    table.uuid("ordem_servico_id").notNullable();
    table.string("correlation_id", 100).notNullable();
    table
      .enum("estado", [
        "INICIADA",
        "EM_ANDAMENTO",
        "AGUARDANDO_APROVACAO",
        "CONCLUIDA",
        "COMPENSANDO",
        "COMPENSADA",
        "FALHA",
      ])
      .notNullable()
      .defaultTo("INICIADA");
    table.integer("passo_atual").notNullable().defaultTo(0);
    table.string("erro", 500).nullable();
    // Dados de negocio que acompanham a Saga entre os passos.
    table.json("dados").nullable();
    table.timestamp("criada_em").notNullable().defaultTo(knex.fn.now());
    table.timestamp("atualizada_em").notNullable().defaultTo(knex.fn.now());

    table
      .foreign("ordem_servico_id")
      .references("id")
      .inTable("ordens_servico")
      .onDelete("CASCADE");
    table.index(["estado"], "idx_saga_estado");
    table.index(["ordem_servico_id"], "idx_saga_os");
    table.index(["correlation_id"], "idx_saga_correlation");
  });

  await knex.schema.createTable("saga_passos", (table) => {
    table.increments("id").primary();
    table.uuid("saga_id").notNullable();
    table.string("nome", 60).notNullable();
    table.integer("ordem").notNullable();
    table.string("participante", 60).notNullable();
    table.string("comando", 60).notNullable();
    table.string("compensacao", 60).nullable();
    table
      .enum("status", [
        "PENDENTE",
        "EXECUTANDO",
        "CONCLUIDO",
        "FALHOU",
        "COMPENSANDO",
        "COMPENSADO",
        "NAO_EXECUTADO",
      ])
      .notNullable()
      .defaultTo("PENDENTE");
    table.timestamp("iniciado_em").nullable();
    table.timestamp("concluido_em").nullable();
    table.string("erro", 500).nullable();
    table.json("resposta").nullable();

    table
      .foreign("saga_id")
      .references("id")
      .inTable("saga_instancias")
      .onDelete("CASCADE");
    table.unique(["saga_id", "nome"], { indexName: "uq_saga_passo" });
    table.index(["saga_id"], "idx_saga_passos_saga");
  });

  // Idempotencia dos consumidores: a mesma resposta reentregue pelo RabbitMQ
  // (at-least-once delivery) nao pode avancar a Saga duas vezes.
  // Aula 5 de "Estrutura de Microsservicos": event handlers idempotentes.
  await knex.schema.createTable("mensagens_processadas", (table) => {
    table.string("mensagem_id", 100).primary();
    table.string("tipo", 60).notNullable();
    table.uuid("saga_id").nullable();
    table.timestamp("processada_em").notNullable().defaultTo(knex.fn.now());

    table.index(["saga_id"], "idx_msg_saga");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("mensagens_processadas");
  await knex.schema.dropTableIfExists("saga_passos");
  await knex.schema.dropTableIfExists("saga_instancias");
}
