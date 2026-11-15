import pino from "pino";
import { getContexto } from "./context";

// Logs estruturados em JSON (Fase 3), agora com sagaId para rastrear o fluxo
// distribuido: uma unica consulta no New Relic por sagaId mostra a linha do
// tempo completa da transacao nos tres microsservicos.
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: {
    service: process.env.SERVICE_NAME || "fiap-ms",
    env: process.env.APP_ENV || process.env.NODE_ENV || "local",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  mixin() {
    const contexto = getContexto();
    if (!contexto) return {};
    const extra: Record<string, string> = { correlationId: contexto.correlationId };
    if (contexto.sagaId) extra.sagaId = contexto.sagaId;
    if (contexto.ordemServicoId) extra.ordemServicoId = contexto.ordemServicoId;
    return extra;
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "password",
      "senha",
      "accessToken",
      "*.password",
      "*.passwordHash",
      "*.accessToken",
    ],
    censor: "[REDACTED]",
  },
});

export default logger;
