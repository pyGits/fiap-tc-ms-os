import { NextFunction, Request, Response } from "express";
import { getContexto } from "../context";
import logger from "../logger";
import ErroDominio from "../../domain/ErroDominio";

// Contrato minimo de telemetria exigido pelo handler. Declarado aqui de forma
// estrutural para que a borda HTTP nao dependa da interface completa do
// dominio - qualquer gateway com este metodo serve.
export type TelemetriaErro = {
  registrarFalhaIntegracao(dados: {
    integracao: string;
    operacao: string;
    erro: string;
  }): void;
};

// Tratamento de erro global: log JSON (com correlationId e sagaId) e resposta
// padronizada. Seguindo a Aula 4 de "Modelo API para microsservicos", nao
// devolvemos stacktrace nem detalhes da tecnologia ao cliente.
export const criarErrorHandler =
  (telemetria?: TelemetriaErro) =>
  (erro: unknown, req: Request, res: Response, _next: NextFunction) => {
    const contexto = getContexto();
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    const status = erro instanceof ErroDominio ? erro.status : 500;

    const dados = {
      erro: mensagem,
      stack: erro instanceof Error ? erro.stack : undefined,
      rota: req.originalUrl,
      metodo: req.method,
      status,
    };

    if (status >= 500) {
      logger.error(dados, "erro nao tratado");
      // Erro 5xx vira evento de telemetria: e o que dispara o alerta.
      // Erro 4xx e decisao de negocio (regra violada), nao falha do servico.
      telemetria?.registrarFalhaIntegracao({
        integracao: process.env.SERVICE_NAME || "servico",
        operacao: `${req.method} ${req.originalUrl}`,
        erro: mensagem,
      });
    } else {
      logger.warn(dados, "requisicao invalida");
    }

    if (res.headersSent) return;

    res.status(status).json({
      erro: {
        codigo: erro instanceof ErroDominio ? erro.codigo : "erro.interno",
        descricao: status >= 500 ? "Erro interno do servico." : mensagem,
      },
      correlationId: contexto?.correlationId,
      sagaId: contexto?.sagaId,
    });
  };

// Rota inexistente: resposta padronizada em vez do HTML padrao do Express.
export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({
    erro: { codigo: "rota.nao.encontrada", descricao: "Rota nao encontrada." },
    path: req.originalUrl,
    correlationId: getContexto()?.correlationId,
  });
};
