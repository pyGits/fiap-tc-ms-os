"use strict";

// Configuracao do agente do New Relic (observabilidade herdada da Fase 3).
//
// Distributed tracing LIGADO e o ponto central da Fase 4: e o que permite ver,
// em um unico trace, o caminho de uma requisicao que atravessa o OS Service, o
// Billing e a Execucao passando pelo RabbitMQ.
exports.config = {
  app_name: [process.env.NEW_RELIC_APP_NAME || "fiap-tc-ms-os"],
  license_key: process.env.NEW_RELIC_LICENSE_KEY,
  logging: {
    level: process.env.NEW_RELIC_LOG_LEVEL || "info",
    filepath: "stdout",
  },
  distributed_tracing: { enabled: true },
  application_logging: {
    enabled: true,
    forwarding: { enabled: true },
    local_decorating: { enabled: false },
  },
  allow_all_headers: true,
  attributes: {
    // Os identificadores de correlacao e de saga viram atributos do trace.
    include: [
      "request.headers.x-correlation-id",
      "request.headers.x-saga-id",
      "request.parameters.*",
    ],
    exclude: [
      "request.headers.cookie",
      "request.headers.authorization",
      "request.headers.proxyAuthorization",
      "request.headers.setCookie*",
      "request.headers.x-*",
      "response.headers.cookie",
      "response.headers.authorization",
    ],
  },
  transaction_tracer: { enabled: true, record_sql: "obfuscated" },
  error_collector: { enabled: true, ignore_status_codes: [401, 404, 409] },
};
