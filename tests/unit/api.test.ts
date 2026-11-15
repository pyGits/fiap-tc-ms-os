import request from "supertest";
import { Express } from "express";

import criarApp from "../../src/app";
import { criarContainer, Container } from "../../src/container";
import MensageriaGatewayMemoria from "../../domain/gateway/Mock/MensageriaGatewayMemoria";

// AUTH_DISABLED e definido em tests/setupEnv.ts (setupFiles), que roda antes
// dos imports da aplicacao: a autenticacao e responsabilidade da Function
// Serverless + Cognito, exercitada no repositorio fiap-tc-lambda-auth.

const DOCUMENTO = "52998224725";

type Ambiente = { app: Express; container: Container };

function montar(): Ambiente {
  const container = criarContainer();
  return { app: criarApp(container), container };
}

async function cadastrarClienteEVeiculo(app: Express) {
  const cliente = await request(app)
    .post("/clientes")
    .send({ documento: DOCUMENTO, nome: "Cliente Demonstracao" })
    .expect(201);

  const veiculo = await request(app)
    .post("/veiculos")
    .send({
      placa: "ABC1D23",
      clienteId: cliente.body.id,
      marca: "Volkswagen",
      modelo: "Gol",
      ano: 2019,
    })
    .expect(201);

  return { clienteId: cliente.body.id, veiculoId: veiculo.body.id };
}

describe("API - infraestrutura", () => {
  it("GET /health responde ok", async () => {
    const { app } = montar();

    const resposta = await request(app).get("/health").expect(200);
    expect(resposta.body).toEqual({ status: "ok", servico: "fiap-tc-ms-os" });
  });

  it("GET / identifica o papel do servico", async () => {
    const { app } = montar();

    const resposta = await request(app).get("/").expect(200);
    expect(resposta.body.papel).toContain("orquestrador");
  });

  it("expoe o contrato OpenAPI", async () => {
    const { app } = montar();

    const resposta = await request(app).get("/api-docs.json").expect(200);
    expect(resposta.body.info.title).toContain("OS Service");
    expect(Object.keys(resposta.body.paths)).toContain("/ordens-servico");
  });

  it("rota inexistente devolve erro padronizado", async () => {
    const { app } = montar();

    const resposta = await request(app).get("/nao-existe").expect(404);
    expect(resposta.body.erro.codigo).toBe("rota.nao.encontrada");
  });

  it("propaga o x-correlation-id recebido", async () => {
    const { app } = montar();

    const resposta = await request(app)
      .get("/health")
      .set("x-correlation-id", "corr-externo")
      .expect(200);

    expect(resposta.headers["x-correlation-id"]).toBe("corr-externo");
  });
});

describe("API - ordens de servico", () => {
  it("POST /ordens-servico responde 202 e inicia a Saga", async () => {
    const { app, container } = montar();
    const ids = await cadastrarClienteEVeiculo(app);

    const resposta = await request(app)
      .post("/ordens-servico")
      .send({
        clienteId: ids.clienteId,
        veiculoId: ids.veiculoId,
        itens: [{ id: "srv-revisao", quantidade: 1 }],
      })
      // 202 e nao 201: a transacao de negocio continua em outros servicos.
      .expect(202);

    expect(resposta.body.sagaId).toBeTruthy();
    expect(resposta.body.valorEstimado).toBe(450);

    const mensageria = container.mensageria as MensageriaGatewayMemoria;
    expect(mensageria.tipos()).toEqual(["GERAR_ORCAMENTO"]);
  });

  it("GET /ordens-servico/{id} devolve o saga log", async () => {
    const { app } = montar();
    const ids = await cadastrarClienteEVeiculo(app);

    const criada = await request(app)
      .post("/ordens-servico")
      .send({
        clienteId: ids.clienteId,
        veiculoId: ids.veiculoId,
        itens: [{ id: "srv-troca-oleo", quantidade: 1 }],
      })
      .expect(202);

    const resposta = await request(app)
      .get(`/ordens-servico/${criada.body.ordemServicoId}`)
      .expect(200);

    expect(resposta.body.saga.passos).toHaveLength(5);
    expect(resposta.body.saga.passos[0].status).toBe("CONCLUIDO");
  });

  it("fluxo completo pela API: abertura, aprovacao e conclusao", async () => {
    const { app, container } = montar();
    const ids = await cadastrarClienteEVeiculo(app);

    const criada = await request(app)
      .post("/ordens-servico")
      .send({
        clienteId: ids.clienteId,
        veiculoId: ids.veiculoId,
        itens: [{ id: "srv-revisao", quantidade: 1 }],
      })
      .expect(202);

    const { ordemServicoId, sagaId } = criada.body;

    // Respostas dos participantes (que no ambiente real chegam pela fila).
    await container.orquestrador.orcamentoGerado(sagaId, "orc-1", 450);

    const aprovacao = await request(app)
      .post(`/ordens-servico/${ordemServicoId}/aprovacao`)
      .send({ aprovado: true })
      .expect(200);
    expect(aprovacao.body.status).toBe("AGUARDANDO_PAGAMENTO");

    await container.orquestrador.pagamentoRegistrado(sagaId, "pag-1");
    await container.orquestrador.execucaoEnfileirada(sagaId, "exec-1");

    await request(app)
      .post(`/ordens-servico/${ordemServicoId}/finalizacao`)
      .send({ execucaoId: "exec-1" })
      .expect(200);

    const entrega = await request(app)
      .post(`/ordens-servico/${ordemServicoId}/entrega`)
      .expect(200);

    expect(entrega.body.status).toBe("ENTREGUE");
  });

  it("recusa do orcamento devolve 200 e compensa o Billing", async () => {
    const { app, container } = montar();
    const ids = await cadastrarClienteEVeiculo(app);

    const criada = await request(app)
      .post("/ordens-servico")
      .send({
        clienteId: ids.clienteId,
        veiculoId: ids.veiculoId,
        itens: [{ id: "srv-revisao", quantidade: 1 }],
      })
      .expect(202);

    await container.orquestrador.orcamentoGerado(
      criada.body.sagaId,
      "orc-1",
      450,
    );

    const resposta = await request(app)
      .post(`/ordens-servico/${criada.body.ordemServicoId}/aprovacao`)
      .send({ aprovado: false, motivoRecusa: "Vou pensar" })
      .expect(200);

    expect(resposta.body.status).toBe("RECUSADA");

    const mensageria = container.mensageria as MensageriaGatewayMemoria;
    expect(mensageria.tipos()).toContain("CANCELAR_ORCAMENTO");
  });

  it("404 para OS inexistente", async () => {
    const { app } = montar();

    const resposta = await request(app)
      .get("/ordens-servico/11111111-1111-4111-8111-111111111111")
      .expect(404);

    expect(resposta.body.erro.codigo).toBe("os.nao.encontrada");
  });

  it("409 quando o cliente aprova sem haver orcamento", async () => {
    const { app } = montar();
    const ids = await cadastrarClienteEVeiculo(app);

    const criada = await request(app)
      .post("/ordens-servico")
      .send({
        clienteId: ids.clienteId,
        veiculoId: ids.veiculoId,
        itens: [{ id: "srv-revisao", quantidade: 1 }],
      })
      .expect(202);

    await request(app)
      .post(`/ordens-servico/${criada.body.ordemServicoId}/aprovacao`)
      .send({ aprovado: true })
      .expect(409);
  });

  it("400 quando o payload nao traz o campo aprovado", async () => {
    const { app } = montar();

    await request(app)
      .post("/ordens-servico/qualquer/aprovacao")
      .send({})
      .expect(400);
  });

  it("GET /ordens-servico filtra por status e por cliente", async () => {
    const { app } = montar();
    const ids = await cadastrarClienteEVeiculo(app);

    await request(app)
      .post("/ordens-servico")
      .send({
        clienteId: ids.clienteId,
        veiculoId: ids.veiculoId,
        itens: [{ id: "srv-revisao", quantidade: 1 }],
      })
      .expect(202);

    const porStatus = await request(app)
      .get("/ordens-servico?status=RECEBIDA")
      .expect(200);
    expect(porStatus.body).toHaveLength(1);

    const porCliente = await request(app)
      .get(`/ordens-servico?clienteId=${ids.clienteId}`)
      .expect(200);
    expect(porCliente.body).toHaveLength(1);
  });

  it("GET /ordens-servico/tempo-medio devolve o indicador", async () => {
    const { app } = montar();

    const resposta = await request(app)
      .get("/ordens-servico/tempo-medio")
      .expect(200);

    expect(resposta.body).toHaveProperty("tempoMedioPorStatus");
  });
});

describe("API - cadastros", () => {
  it("CRUD de cliente", async () => {
    const { app } = montar();

    const criado = await request(app)
      .post("/clientes")
      .send({ documento: DOCUMENTO, nome: "Maria Silva" })
      .expect(201);

    await request(app).get(`/clientes/${criado.body.id}`).expect(200);

    const atualizado = await request(app)
      .put(`/clientes/${criado.body.id}`)
      .send({ telefone: "11988887777" })
      .expect(200);
    expect(atualizado.body.telefone).toBe("11988887777");

    const inativado = await request(app)
      .delete(`/clientes/${criado.body.id}`)
      .expect(200);
    expect(inativado.body.status).toBe("INATIVO");

    const lista = await request(app).get("/clientes").expect(200);
    expect(lista.body).toHaveLength(1);
  });

  it("400 para documento invalido", async () => {
    const { app } = montar();

    const resposta = await request(app)
      .post("/clientes")
      .send({ documento: "123", nome: "Maria Silva" })
      .expect(400);

    expect(resposta.body.erro.codigo).toBeTruthy();
  });

  it("CRUD de veiculo", async () => {
    const { app } = montar();
    const ids = await cadastrarClienteEVeiculo(app);

    await request(app).get(`/veiculos/${ids.veiculoId}`).expect(200);

    const lista = await request(app)
      .get(`/veiculos?clienteId=${ids.clienteId}`)
      .expect(200);
    expect(lista.body).toHaveLength(1);

    await request(app).delete(`/veiculos/${ids.veiculoId}`).expect(204);
    await request(app).get(`/veiculos/${ids.veiculoId}`).expect(404);
  });

  it("CRUD do catalogo", async () => {
    const { app } = montar();

    const criado = await request(app)
      .post("/catalogo")
      .send({
        descricao: "Troca de correia dentada",
        tipo: "SERVICO",
        valorUnitario: 780,
      })
      .expect(201);

    await request(app).get(`/catalogo/${criado.body.id}`).expect(200);

    const atualizado = await request(app)
      .put(`/catalogo/${criado.body.id}`)
      .send({ valorUnitario: 820 })
      .expect(200);
    expect(atualizado.body.valorUnitario).toBe(820);

    const pecas = await request(app).get("/catalogo?tipo=PECA").expect(200);
    expect(pecas.body.every((item: { tipo: string }) => item.tipo === "PECA")).toBe(
      true,
    );

    await request(app).delete(`/catalogo/${criado.body.id}`).expect(204);
  });
});
