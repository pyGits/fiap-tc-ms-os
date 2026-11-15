import "dotenv/config";
import knex from "knex";

// Banco PROPRIO do OS Service (MySQL).
//
// Nenhum outro microsservico tem credencial para este banco - o requisito
// "nenhum servico acessa diretamente o banco de dados de outro" e garantido
// por isolamento de rede/credencial, nao por convencao de codigo.
const database = knex({
  client: "mysql2",
  connection: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "fiap_tc_os",
  },
  pool: { min: 0, max: 10 },
});

export default database;
