import { CognitoJwtVerifier } from "aws-jwt-verify";
import { NextFunction, Request, Response } from "express";
import "dotenv/config";
import logger from "../logger";

// Autenticacao mantida da Fase 3: o token e emitido pela Function Serverless
// (fiap-tc-lambda-auth) via Amazon Cognito e validado primeiro pelo JWT
// authorizer do API Gateway.
//
// Cada microsservico valida o token DE NOVO (defesa em profundidade): dentro do
// cluster o Service continua alcancavel por qualquer pod da VPC, e na Fase 4
// sao tres servicos expostos em vez de um.
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID;

// Em dev local e nos testes nao ha Cognito: AUTH_DISABLED=true libera as rotas.
export const authDesabilitado = process.env.AUTH_DISABLED === "true";

const cognitoVerifier =
  COGNITO_USER_POOL_ID && COGNITO_CLIENT_ID
    ? CognitoJwtVerifier.create({
        userPoolId: COGNITO_USER_POOL_ID,
        clientId: COGNITO_CLIENT_ID,
        tokenUse: "id",
      })
    : null;

export interface UsuarioAutenticado {
  clienteId: string;
  cpfCnpj: string;
  nome?: string;
}

export interface AuthRequest extends Request {
  user?: UsuarioAutenticado;
}

function extrairToken(authHeader?: string): string | null {
  if (!authHeader) return null;

  const partes = authHeader.split(" ");
  if (partes.length !== 2) return null;

  const [esquema, token] = partes;
  if (!/^Bearer$/i.test(esquema)) return null;

  return token;
}

// Resposta 401 padronizada para TODOS os servicos.
//
// Aula 4 de "Estrutura de Microsservicos": a mensagem de erro de autenticacao
// nao deve revelar se o token expirou, se a assinatura falhou ou se o usuario
// nao existe - isso ajuda um atacante a enumerar estados.
function naoAutorizado(res: Response) {
  return res.status(401).json({
    erro: {
      codigo: "nao.autorizado",
      descricao: "Credenciais ausentes ou invalidas.",
    },
  });
}

export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (authDesabilitado) {
    req.user = { clienteId: "local", cpfCnpj: "00000000000", nome: "Local" };
    return next();
  }

  const token = extrairToken(req.headers.authorization);
  if (!token) return naoAutorizado(res);

  if (!cognitoVerifier) {
    logger.error(
      "COGNITO_USER_POOL_ID/COGNITO_CLIENT_ID ausentes: autenticacao indisponivel",
    );
    return res.status(503).json({
      erro: {
        codigo: "auth.indisponivel",
        descricao: "Servico de autenticacao indisponivel.",
      },
    });
  }

  try {
    const payload = await cognitoVerifier.verify(token);

    req.user = {
      clienteId: String(payload["custom:clienteId"] ?? payload.sub),
      cpfCnpj: String(payload["custom:cpfCnpj"] ?? ""),
      nome: payload.name ? String(payload.name) : undefined,
    };

    return next();
  } catch (erro) {
    logger.warn(
      { erro: erro instanceof Error ? erro.message : String(erro) },
      "token rejeitado",
    );
    return naoAutorizado(res);
  }
};

export default authMiddleware;
