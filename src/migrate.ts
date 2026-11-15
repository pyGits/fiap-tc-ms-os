import "dotenv/config";
import knex from "knex";
import path from "path";

// Runner de migrations para producao: usa os arquivos JA compilados (.js),
// dispensando ts-node na imagem final. Executado pelo initContainer no
// Kubernetes antes de o container da aplicacao subir.
async function run() {
  const db = knex({
    client: "mysql2",
    connection: {
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "fiap_tc_os",
    },
    migrations: {
      directory: path.join(__dirname, "database", "migrations"),
      loadExtensions: [".js"],
    },
  });

  try {
    const [, aplicadas] = await db.migrate.latest();
    if (aplicadas.length === 0) {
      console.log("Nenhuma migration pendente.");
    } else {
      console.log("Migrations aplicadas:", aplicadas);
    }
  } finally {
    await db.destroy();
  }
}

run().catch((erro) => {
  console.error("Falha ao aplicar migrations:", erro);
  process.exit(1);
});
