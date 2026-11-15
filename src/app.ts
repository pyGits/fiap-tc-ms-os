import cors from "cors";
import express, { Express } from "express";
import swaggerUi from "swagger-ui-express";

import { Container } from "./container";
import { correlationIdMiddleware } from "./middleware/correlationId";
import { criarErrorHandler, notFoundHandler } from "./middleware/errorHandler";
import criarOrdemServicoRoutes from "./routes/ordemServico.routes";
import {
  criarCatalogoRoutes,
  criarClienteRoutes,
  criarVeiculoRoutes,
} from "./routes/cadastro.routes";
import { swaggerSpec } from "./swagger";

// A aplicacao recebe o container pronto em vez de montar as dependencias por
// conta propria. E o que permite aos testes de integracao e aos cenarios BDD
// subirem o mesmo app com adaptadores em memoria.
export function criarApp(container: Container): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());
  // Propaga x-correlation-id e x-saga-id: e o que costura, no New Relic, o
  // trace de uma mesma transacao distribuida nos tres microsservicos.
  app.use(correlationIdMiddleware);

  app.get("/", (_req, res) => {
    res.json({
      servico: "fiap-tc-ms-os",
      papel: "orquestrador da Saga de Ordem de Servico",
      documentacao: "/api-docs",
    });
  });

  // Probes do Kubernetes (readiness/liveness) e monitor sintetico do New Relic.
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", servico: "fiap-tc-ms-os" });
  });

  app.use("/ordens-servico", criarOrdemServicoRoutes(container));
  app.use("/clientes", criarClienteRoutes(container));
  app.use("/veiculos", criarVeiculoRoutes(container));
  app.use("/catalogo", criarCatalogoRoutes(container));

  app.get("/api-docs.json", (_req, res) => {
    res.json(swaggerSpec);
  });
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.use(notFoundHandler);
  app.use(criarErrorHandler(container.telemetria));

  return app;
}

export default criarApp;
