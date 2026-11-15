import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import { runComContexto } from "../context";
import logger from "../logger";

export const CORRELATION_ID_HEADER = "x-correlation-id";
export const SAGA_ID_HEADER = "x-saga-id";

// Correlacao entre requisicoes: o API Gateway injeta x-correlation-id; quando a
// requisicao chega direto (dev local), geramos um UUID. Ambos os cabecalhos sao
// devolvidos na resposta e propagados por AsyncLocalStorage ate a mensageria.
export const correlationIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const lerHeader = (nome: string): string | undefined => {
    const valor = req.headers[nome];
    return Array.isArray(valor) ? valor[0] : valor;
  };

  const correlationId = lerHeader(CORRELATION_ID_HEADER) || randomUUID();
  const sagaId = lerHeader(SAGA_ID_HEADER);

  res.setHeader(CORRELATION_ID_HEADER, correlationId);
  if (sagaId) res.setHeader(SAGA_ID_HEADER, sagaId);

  runComContexto({ correlationId, sagaId }, () => {
    const inicio = Date.now();

    res.on("finish", () => {
      logger.info(
        {
          metodo: req.method,
          rota: req.originalUrl,
          status: res.statusCode,
          duracaoMs: Date.now() - inicio,
        },
        "requisicao concluida",
      );
    });

    next();
  });
};
