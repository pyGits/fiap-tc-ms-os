import express, { Express } from "express";
import request from "supertest";

// Verificador do Cognito simulado: o teste controla se o token e aceito.
const verificar = jest.fn();

jest.mock("aws-jwt-verify", () => ({
  CognitoJwtVerifier: {
    create: () => ({ verify: verificar }),
  },
}));

// O middleware le as variaveis de ambiente no momento do import, por isso cada
// cenario precisa recarregar o modulo com a configuracao desejada.
async function carregarMiddleware(env: Record<string, string | undefined>) {
  jest.resetModules();

  const anterior = { ...process.env };
  Object.entries(env).forEach(([chave, valor]) => {
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  });

  const modulo = await import("../../src/middleware/auth");
  process.env = anterior;
  return modulo;
}

function appProtegido(
  middleware: express.RequestHandler,
): Express {
  const app = express();
  app.get("/privado", middleware, (req, res) => {
    res.json({ user: (req as { user?: unknown }).user });
  });
  return app;
}

const COGNITO = {
  AUTH_DISABLED: "false",
  COGNITO_USER_POOL_ID: "us-east-1_teste",
  COGNITO_CLIENT_ID: "client-teste",
};

beforeEach(() => {
  verificar.mockReset();
});

describe("authMiddleware com Cognito configurado", () => {
  it("aceita token valido e popula o usuario da requisicao", async () => {
    verificar.mockResolvedValue({
      sub: "sub-1",
      "custom:clienteId": "cliente-1",
      "custom:cpfCnpj": "52998224725",
      name: "Cliente Demonstracao",
    });

    const { authMiddleware } = await carregarMiddleware(COGNITO);

    const resposta = await request(appProtegido(authMiddleware))
      .get("/privado")
      .set("Authorization", "Bearer token-valido")
      .expect(200);

    expect(resposta.body.user).toEqual({
      clienteId: "cliente-1",
      cpfCnpj: "52998224725",
      nome: "Cliente Demonstracao",
    });
  });

  it("usa o sub como clienteId quando o claim customizado nao existe", async () => {
    verificar.mockResolvedValue({ sub: "sub-2" });

    const { authMiddleware } = await carregarMiddleware(COGNITO);

    const resposta = await request(appProtegido(authMiddleware))
      .get("/privado")
      .set("Authorization", "Bearer token-valido")
      .expect(200);

    expect(resposta.body.user.clienteId).toBe("sub-2");
    expect(resposta.body.user.nome).toBeUndefined();
  });

  // A resposta 401 e deliberadamente generica: revelar se o token expirou, se a
  // assinatura falhou ou se o usuario nao existe ajudaria um atacante a
  // enumerar estados (Aula 4 de "Estrutura de Microsservicos").
  it.each([
    ["sem cabecalho", undefined],
    ["sem o esquema Bearer", "token-sem-esquema"],
    ["esquema errado", "Basic token"],
    ["formato com partes extras", "Bearer token extra"],
  ])("responde 401 generico %s", async (_caso, cabecalho) => {
    const { authMiddleware } = await carregarMiddleware(COGNITO);

    const chamada = request(appProtegido(authMiddleware)).get("/privado");
    if (cabecalho) chamada.set("Authorization", cabecalho);

    const resposta = await chamada.expect(401);

    expect(resposta.body.erro).toEqual({
      codigo: "nao.autorizado",
      descricao: "Credenciais ausentes ou invalidas.",
    });
  });

  it("responde 401 quando o Cognito rejeita o token", async () => {
    verificar.mockRejectedValue(new Error("Token expired"));

    const { authMiddleware } = await carregarMiddleware(COGNITO);

    const resposta = await request(appProtegido(authMiddleware))
      .get("/privado")
      .set("Authorization", "Bearer token-expirado")
      .expect(401);

    // A mensagem do provedor nao vaza para o cliente.
    expect(resposta.body.erro.descricao).not.toContain("expired");
  });
});

describe("authMiddleware sem configuracao do Cognito", () => {
  it("responde 503 em vez de liberar a rota", async () => {
    const { authMiddleware } = await carregarMiddleware({
      AUTH_DISABLED: "false",
      COGNITO_USER_POOL_ID: undefined,
      COGNITO_CLIENT_ID: undefined,
    });

    const resposta = await request(appProtegido(authMiddleware))
      .get("/privado")
      .set("Authorization", "Bearer qualquer")
      .expect(503);

    expect(resposta.body.erro.codigo).toBe("auth.indisponivel");
  });
});

describe("authMiddleware com AUTH_DISABLED", () => {
  it("injeta um usuario local para desenvolvimento e testes", async () => {
    const { authMiddleware, authDesabilitado } = await carregarMiddleware({
      AUTH_DISABLED: "true",
    });

    expect(authDesabilitado).toBe(true);

    const resposta = await request(appProtegido(authMiddleware))
      .get("/privado")
      .expect(200);

    expect(resposta.body.user.clienteId).toBe("local");
  });
});
