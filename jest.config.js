const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  setupFiles: ["<rootDir>/tests/setupEnv.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/tests/bdd/"],
  transform: { ...tsJestTransformCfg },
  collectCoverageFrom: [
    "domain/**/*.ts",
    "src/**/*.ts",
    "!src/index.ts",
    "!src/migrate.ts",
    "!src/ensureDatabase.ts",
    "!src/swagger.ts",
    // Bootstrap e configuracao de bibliotecas, sem regra propria:
    // a conexao com o banco e a instancia do pino sao exercitadas
    // indiretamente pelos testes de integracao dos adaptadores.
    "!src/logger.ts",
    "!src/database.ts",
    "!src/mongo.ts",
    "!src/database/migrations/**",
    "!**/*.d.ts",
  ],
  coverageReporters: ["text", "lcov", "json-summary"],
  // Requisito da Fase 4: cobertura minima de 80% por servico.
  // O pipeline falha automaticamente se o patamar nao for atingido.
  coverageThreshold: {
    global: { statements: 80, branches: 80, functions: 80, lines: 80 },
  },
};
