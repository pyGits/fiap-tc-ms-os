import express from "express";
import request from "supertest";

import OrdemServico from "../../domain/entity/OrdemServico";
import NewRelicTelemetriaGateway from "../../src/telemetry/NewRelicTelemetriaGateway";
import { authMiddleware } from "../../src/middleware/auth";
import { correlationIdMiddleware } from "../../src/middleware/correlationId";
import { criarErrorHandler } from "../../src/middleware/errorHandler";
import ErroDominio from "../../domain/ErroDominio";
import {
  getContexto,
  getCorrelationId,
  getSagaId,
  runComContexto,
} from "../../src/context";

type EventoCapturado = { nome: string; atributos: Record<string, unknown> };

function agenteFake() {
  const eventos: EventoCapturado[] = [];
  return {
    eventos,
    agente: {
      recordCustomEvent: (nome: string, atributos: Record<string, unknown>) => {
        eventos.push({ nome, atributos });
      },
    },
  };
}

describe("contexto de requisicao (AsyncLocalStorage)", () => {
  it("expoe correlationId e sagaId dentro do escopo", () => {
    runComContexto(
      { correlationId: "corr-1", sagaId: "saga-1", ordemServicoId: "os-1" },
      () => {
        expect(getCorrelationId()).toBe("corr-1");
        expect(getSagaId()).toBe("saga-1");
        expect(getContexto()?.ordemServicoId).toBe("os-1");
      },
    );
  });

  it("devolve nulo fora de qualquer escopo", () => {
    expect(getContexto()).toBeUndefined();
    expect(getCorrelationId()).toBeNull();
    expect(getSagaId()).toBeNull();
  });
});

describe("NewRelicTelemetriaGateway", () => {
  it("publica um evento por transicao de status e limpa a lista", () => {
    const { agente, eventos } = agenteFake();
    const telemetria = new NewRelicTelemetriaGateway(agente);

    const ordem = new OrdemServico(undefined, "cliente-1", "veiculo-1");
    ordem.iniciarDiagnostico();
    ordem.transicoesRegistradas = ordem.consumirTransicoesPendentes();

    telemetria.registrarTransicoesStatus(ordem);

    expect(eventos).toHaveLength(2);
    expect(eventos[0].nome).toBe("OrdemServicoStatus");
    expect(eventos[1].atributos.transicao).toBe("RECEBIDA->EM_DIAGNOSTICO");
    // Limpar evita publicar a mesma transicao duas vezes.
    expect(ordem.transicoesRegistradas).toHaveLength(0);
  });

  it("publica os eventos proprios da Saga", () => {
    const { agente, eventos } = agenteFake();
    const telemetria = new NewRelicTelemetriaGateway(agente);
    const base = { sagaId: "saga-1", ordemServicoId: "os-1" };

    telemetria.registrarPassoSaga({
      ...base,
      passo: "gerar-orcamento",
      resultado: "CONCLUIDO",
    });
    telemetria.registrarCompensacao({
      ...base,
      passo: "registrar-pagamento",
      motivo: "falha",
    });
    telemetria.registrarSagaConcluida({ ...base, duracaoMs: 1200 });
    telemetria.registrarSagaCompensada({ ...base, motivo: "falha" });
    telemetria.registrarFalhaIntegracao({
      integracao: "rabbitmq",
      operacao: "publish",
      erro: "timeout",
    });

    expect(eventos.map((evento) => evento.nome)).toEqual([
      "SagaPasso",
      "SagaCompensacao",
      "SagaConcluida",
      "SagaCompensada",
      "IntegracaoFalha",
    ]);
  });

  it("inclui correlationId e sagaId do contexto no payload", () => {
    const { agente, eventos } = agenteFake();
    const telemetria = new NewRelicTelemetriaGateway(agente);

    runComContexto({ correlationId: "corr-9", sagaId: "saga-9" }, () => {
      telemetria.registrarSagaConcluida({
        sagaId: "saga-9",
        ordemServicoId: "os-9",
        duracaoMs: 10,
      });
    });

    expect(eventos[0].atributos.correlationId).toBe("corr-9");
    expect(eventos[0].atributos.sagaIdContexto).toBe("saga-9");
    expect(eventos[0].atributos.servico).toBeTruthy();
  });

  it("funciona sem o agente (ambiente local e testes)", () => {
    const telemetria = new NewRelicTelemetriaGateway(null);

    expect(() =>
      telemetria.registrarSagaConcluida({
        sagaId: "s",
        ordemServicoId: "o",
        duracaoMs: 1,
      }),
    ).not.toThrow();
  });
});

describe("middleware de correlacao", () => {
  function appComContexto() {
    const app = express();
    app.use(correlationIdMiddleware);
    app.get("/eco", (_req, res) => {
      res.json({
        correlationId: getCorrelationId(),
        sagaId: getSagaId(),
      });
    });
    return app;
  }

  it("gera correlationId quando o cabecalho nao vem", async () => {
    const resposta = await request(appComContexto()).get("/eco").expect(200);

    expect(resposta.body.correlationId).toBeTruthy();
    expect(resposta.headers["x-correlation-id"]).toBe(
      resposta.body.correlationId,
    );
  });

  it("propaga o x-saga-id recebido", async () => {
    const resposta = await request(appComContexto())
      .get("/eco")
      .set("x-saga-id", "saga-externa")
      .expect(200);

    expect(resposta.body.sagaId).toBe("saga-externa");
  });
});

describe("authMiddleware", () => {
  function appProtegido() {
    const app = express();
    app.get("/privado", authMiddleware, (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  // AUTH_DISABLED=true vem de tests/setupEnv.ts: em producao quem valida o
  // token e o Cognito, atraves do JWT authorizer do API Gateway e deste
  // middleware (defesa em profundidade).
  it("libera a rota quando a autenticacao esta desativada nos testes", async () => {
    await request(appProtegido()).get("/privado").expect(200);
  });
});

describe("errorHandler", () => {
  function appComErro(erro: unknown, telemetria?: Parameters<typeof criarErrorHandler>[0]) {
    const app = express();
    app.use(correlationIdMiddleware);
    app.get("/falha", (_req, _res, next) => next(erro));
    app.use(criarErrorHandler(telemetria));
    return app;
  }

  it("traduz ErroDominio para o status e o codigo declarados", async () => {
    const resposta = await request(
      appComErro(new ErroDominio("os.transicao.invalida", "Transicao invalida.", 409)),
    )
      .get("/falha")
      .expect(409);

    expect(resposta.body.erro).toEqual({
      codigo: "os.transicao.invalida",
      descricao: "Transicao invalida.",
    });
    expect(resposta.body.correlationId).toBeTruthy();
  });

  it("esconde detalhes internos em erro 500 e registra telemetria", async () => {
    const falhas: string[] = [];
    const telemetria = {
      registrarFalhaIntegracao: (dados: { operacao: string }) => {
        falhas.push(dados.operacao);
      },
    };

    const resposta = await request(
      appComErro(new Error("stack trace secreta"), telemetria),
    )
      .get("/falha")
      .expect(500);

    expect(resposta.body.erro.codigo).toBe("erro.interno");
    expect(resposta.body.erro.descricao).toBe("Erro interno do servico.");
    expect(falhas).toEqual(["GET /falha"]);
  });

  it("aceita erro que nao e instancia de Error", async () => {
    const resposta = await request(appComErro("falha em texto"))
      .get("/falha")
      .expect(500);

    expect(resposta.body.erro.codigo).toBe("erro.interno");
  });
});
