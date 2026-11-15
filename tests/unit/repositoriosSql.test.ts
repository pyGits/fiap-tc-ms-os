import knex, { Knex } from "knex";
import path from "path";

import Cliente from "../../domain/entity/Cliente";
import Veiculo from "../../domain/entity/Veiculo";
import OrdemServico, {
  StatusOrdemServico,
} from "../../domain/entity/OrdemServico";
import ItemOrdemServico, { TipoItem } from "../../domain/entity/ItemOrdemServico";
import SagaOrdemServico, {
  EstadoSaga,
  StatusPasso,
} from "../../domain/saga/SagaOrdemServico";
import { criarPassosSagaOrdemServico, PASSOS } from "../../domain/saga/DefinicaoSaga";
import OrdemServicoRepositoryMySQL from "../../domain/repository/MySQL/OrdemServicoRepositoryMySQL";
import SagaRepositoryMySQL from "../../domain/repository/MySQL/SagaRepositoryMySQL";
import ClienteRepositoryMySQL from "../../domain/repository/MySQL/ClienteRepositoryMySQL";
import VeiculoRepositoryMySQL from "../../domain/repository/MySQL/VeiculoRepositoryMySQL";
import CatalogoRepositoryMySQL from "../../domain/repository/MySQL/CatalogoRepositoryMySQL";

// Testes de integracao dos adaptadores de persistencia.
//
// Rodam contra SQLite em memoria usando as MIGRATIONS REAIS do servico: o
// mesmo Knex, o mesmo SQL gerado, os mesmos indices e chaves estrangeiras.
// Assim validamos de fato o mapeamento entidade <-> tabela e o calculo de
// tempo medio - sem exigir um MySQL no pipeline a cada commit.
let db: Knex;

beforeAll(async () => {
  db = knex({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(__dirname, "..", "..", "src", "database", "migrations"),
      loadExtensions: [".ts"],
    },
    pool: {
      // Chaves estrangeiras no SQLite precisam ser habilitadas por conexao.
      afterCreate: (conexao: { pragma: (comando: string) => void }, done: () => void) => {
        conexao.pragma("foreign_keys = ON");
        done();
      },
    },
  });

  await db.migrate.latest();
});

afterAll(async () => {
  await db.destroy();
});

async function limpar() {
  await db("mensagens_processadas").del();
  await db("saga_passos").del();
  await db("saga_instancias").del();
  await db("ordem_servico_historico_status").del();
  await db("ordem_servico_itens").del();
  await db("ordens_servico").del();
  await db("veiculos").del();
  await db("clientes").del();
}

beforeEach(limpar);

function novoCliente() {
  return new Cliente({
    documento: "52998224725",
    nome: "Cliente Demonstracao",
    email: "cliente.demo@oficina.local",
    telefone: "11999990000",
  });
}

function novoVeiculo(clienteId: string) {
  return new Veiculo({
    placa: "ABC1D23",
    clienteId,
    marca: "Volkswagen",
    modelo: "Gol",
    ano: 2019,
  });
}

function novaOrdem(clienteId: string, veiculoId: string) {
  const ordem = new OrdemServico(undefined, clienteId, veiculoId);
  ordem.definirItens([
    new ItemOrdemServico({
      referenciaId: "srv-revisao",
      descricao: "Revisao completa",
      tipo: TipoItem.SERVICO,
      quantidade: 1,
      valorUnitario: 450,
    }),
    new ItemOrdemServico({
      referenciaId: "pec-filtro-oleo",
      descricao: "Filtro de oleo",
      tipo: TipoItem.PECA,
      quantidade: 2,
      valorUnitario: 65.5,
    }),
  ]);
  return ordem;
}

describe("migrations", () => {
  it("cria todas as tabelas do servico, inclusive o saga log", async () => {
    for (const tabela of [
      "clientes",
      "veiculos",
      "catalogo_itens",
      "ordens_servico",
      "ordem_servico_itens",
      "ordem_servico_historico_status",
      "saga_instancias",
      "saga_passos",
      "mensagens_processadas",
    ]) {
      expect(await db.schema.hasTable(tabela)).toBe(true);
    }
  });

  it("popula o catalogo pelo seed", async () => {
    const itens = await db("catalogo_itens").select("*");
    expect(itens.length).toBeGreaterThanOrEqual(9);
  });
});

describe("ClienteRepositoryMySQL", () => {
  it("grava, consulta por id e por documento, atualiza e exclui", async () => {
    const repositorio = new ClienteRepositoryMySQL(db);
    const cliente = novoCliente();

    await repositorio.salvar(cliente);

    const porId = await repositorio.obter(cliente.id.getValue());
    expect(porId?.nome).toBe("Cliente Demonstracao");
    expect(porId?.email?.getValue()).toBe("cliente.demo@oficina.local");

    // A consulta aceita documento formatado: a normalizacao e do adaptador.
    const porDocumento = await repositorio.obterPorDocumento("529.982.247-25");
    expect(porDocumento?.id.getValue()).toBe(cliente.id.getValue());

    cliente.atualizar({ nome: "Cliente Atualizado" });
    cliente.inativar();
    await repositorio.atualizar(cliente);

    const atualizado = await repositorio.obter(cliente.id.getValue());
    expect(atualizado?.nome).toBe("Cliente Atualizado");
    expect(atualizado?.estaAtivo()).toBe(false);

    expect(await repositorio.listar()).toHaveLength(1);

    await repositorio.excluir(cliente.id.getValue());
    expect(await repositorio.obter(cliente.id.getValue())).toBeNull();
  });

  it("devolve nulo para cliente inexistente", async () => {
    const repositorio = new ClienteRepositoryMySQL(db);

    expect(await repositorio.obter("nao-existe")).toBeNull();
    expect(await repositorio.obterPorDocumento("00000000000")).toBeNull();
  });
});

describe("VeiculoRepositoryMySQL", () => {
  it("grava e consulta por placa e por cliente", async () => {
    const clientes = new ClienteRepositoryMySQL(db);
    const veiculos = new VeiculoRepositoryMySQL(db);

    const cliente = novoCliente();
    await clientes.salvar(cliente);

    const veiculo = novoVeiculo(cliente.id.getValue());
    await veiculos.salvar(veiculo);

    expect((await veiculos.obterPorPlaca("abc-1d23"))?.modelo).toBe("Gol");
    expect(await veiculos.listarPorCliente(cliente.id.getValue())).toHaveLength(1);
    expect(await veiculos.listar()).toHaveLength(1);

    await veiculos.excluir(veiculo.id.getValue());
    expect(await veiculos.obter(veiculo.id.getValue())).toBeNull();
  });
});

describe("CatalogoRepositoryMySQL", () => {
  it("consulta, filtra por tipo, faz upsert e exclui", async () => {
    const repositorio = new CatalogoRepositoryMySQL(db);

    const servico = await repositorio.obter("srv-revisao");
    expect(servico?.valorUnitario).toBe(450);
    // Servico nao tem estoque.
    expect(servico?.estoque).toBeNull();

    const pecas = await repositorio.listar("PECA");
    expect(pecas.every((item) => item.tipo === "PECA")).toBe(true);

    await repositorio.salvar({
      id: "srv-revisao",
      descricao: "Revisao completa premium",
      tipo: "SERVICO",
      valorUnitario: 520,
      estoque: null,
    });

    const atualizado = await repositorio.obter("srv-revisao");
    expect(atualizado?.descricao).toBe("Revisao completa premium");
    expect(atualizado?.valorUnitario).toBe(520);

    await repositorio.excluir("srv-revisao");
    expect(await repositorio.obter("srv-revisao")).toBeNull();
  });
});

describe("OrdemServicoRepositoryMySQL", () => {
  async function cenario() {
    const clientes = new ClienteRepositoryMySQL(db);
    const veiculos = new VeiculoRepositoryMySQL(db);
    const ordens = new OrdemServicoRepositoryMySQL(db);

    const cliente = novoCliente();
    await clientes.salvar(cliente);
    const veiculo = novoVeiculo(cliente.id.getValue());
    await veiculos.salvar(veiculo);

    return { cliente, veiculo, ordens };
  }

  it("grava cabecalho, itens e historico em uma unica transacao", async () => {
    const { cliente, veiculo, ordens } = await cenario();
    const ordem = novaOrdem(cliente.id.getValue(), veiculo.id.getValue());

    await ordens.salvar(ordem);

    const recuperada = await ordens.obter(ordem.id.getValue());
    expect(recuperada?.itens).toHaveLength(2);
    expect(recuperada?.valorTotal).toBe(581);
    expect(recuperada?.status).toBe(StatusOrdemServico.RECEBIDA);
    // Reidratar nao gera transicao nova.
    expect(recuperada?.transicoesPendentes).toHaveLength(0);

    const historico = await db("ordem_servico_historico_status").select("*");
    expect(historico).toHaveLength(1);
    expect(historico[0].status_novo).toBe("RECEBIDA");
    expect(historico[0].status_anterior).toBeNull();
  });

  it("atualiza status, referencias externas e acumula o historico", async () => {
    const { cliente, veiculo, ordens } = await cenario();
    const ordem = novaOrdem(cliente.id.getValue(), veiculo.id.getValue());
    await ordens.salvar(ordem);

    ordem.sagaId = "11111111-1111-4111-8111-111111111111";
    ordem.iniciarDiagnostico();
    ordem.registrarOrcamentoGerado("orc-1", 581);
    await ordens.atualizar(ordem);

    const recuperada = await ordens.obter(ordem.id.getValue());
    expect(recuperada?.status).toBe(StatusOrdemServico.AGUARDANDO_APROVACAO);
    expect(recuperada?.orcamentoId).toBe("orc-1");
    expect(recuperada?.sagaId).toBe("11111111-1111-4111-8111-111111111111");

    const historico = await db("ordem_servico_historico_status")
      .orderBy("id", "asc")
      .select("*");
    expect(historico).toHaveLength(3);
    // A duracao do status anterior e calculada a partir da transicao anterior.
    expect(historico[1].status_anterior).toBe("RECEBIDA");
    expect(Number(historico[1].duracao_status_anterior_ms)).toBeGreaterThanOrEqual(0);
  });

  it("lista com filtro por status e por cliente", async () => {
    const { cliente, veiculo, ordens } = await cenario();

    const primeira = novaOrdem(cliente.id.getValue(), veiculo.id.getValue());
    await ordens.salvar(primeira);

    const segunda = novaOrdem(cliente.id.getValue(), veiculo.id.getValue());
    segunda.iniciarDiagnostico();
    await ordens.salvar(segunda);

    expect(
      await ordens.listar({ status: StatusOrdemServico.RECEBIDA }),
    ).toHaveLength(1);
    expect(
      await ordens.listar({ status: StatusOrdemServico.EM_DIAGNOSTICO }),
    ).toHaveLength(1);
    expect(await ordens.listar({ clienteId: cliente.id.getValue() })).toHaveLength(
      2,
    );
    expect(await ordens.listar()).toHaveLength(2);
  });

  it("devolve lista vazia quando nao ha ordens", async () => {
    const ordens = new OrdemServicoRepositoryMySQL(db);
    expect(await ordens.listar()).toEqual([]);
  });

  it("calcula o tempo medio por status a partir do historico", async () => {
    const { cliente, veiculo, ordens } = await cenario();
    const ordem = novaOrdem(cliente.id.getValue(), veiculo.id.getValue());
    await ordens.salvar(ordem);

    ordem.iniciarDiagnostico();
    await ordens.atualizar(ordem);

    // Forca uma duracao conhecida no historico ja gravado.
    await db("ordem_servico_historico_status")
      .where({ status_anterior: "RECEBIDA" })
      .update({ duracao_status_anterior_ms: 120000 });

    const medias = await ordens.tempoMedioPorStatus();
    const recebida = medias.find((item) => item.status === "RECEBIDA");

    expect(recebida).toEqual({
      status: "RECEBIDA",
      ordens: 1,
      tempoMedioMs: 120000,
    });
  });

  it("devolve nulo para OS inexistente", async () => {
    const ordens = new OrdemServicoRepositoryMySQL(db);
    expect(await ordens.obter("11111111-1111-4111-8111-111111111111")).toBeNull();
  });
});

describe("SagaRepositoryMySQL", () => {
  async function ordemPersistida() {
    const clientes = new ClienteRepositoryMySQL(db);
    const veiculos = new VeiculoRepositoryMySQL(db);
    const ordens = new OrdemServicoRepositoryMySQL(db);

    const cliente = novoCliente();
    await clientes.salvar(cliente);
    const veiculo = novoVeiculo(cliente.id.getValue());
    await veiculos.salvar(veiculo);
    const ordem = novaOrdem(cliente.id.getValue(), veiculo.id.getValue());
    await ordens.salvar(ordem);

    return ordem;
  }

  function novaSaga(ordemServicoId: string) {
    return new SagaOrdemServico({
      ordemServicoId,
      correlationId: "corr-1",
      passos: criarPassosSagaOrdemServico(),
      dadosNegocio: { clienteId: "c1", itens: [] },
    });
  }

  it("grava a instancia com todos os passos e reidrata o saga log", async () => {
    const ordem = await ordemPersistida();
    const repositorio = new SagaRepositoryMySQL(db);

    const saga = novaSaga(ordem.id.getValue());
    saga.iniciarPassoCorrente();
    saga.concluirPassoCorrente({ ordemServicoId: ordem.id.getValue() });
    await repositorio.salvar(saga);

    const recuperada = await repositorio.obter(saga.id.getValue());

    expect(recuperada?.passos).toHaveLength(5);
    expect(recuperada?.buscarPasso(PASSOS.CRIAR_OS)?.status).toBe(
      StatusPasso.CONCLUIDO,
    );
    expect(recuperada?.buscarPasso(PASSOS.CRIAR_OS)?.resposta).toEqual({
      ordemServicoId: ordem.id.getValue(),
    });
    expect(recuperada?.dados.clienteId).toBe("c1");
    expect(recuperada?.passoAtual).toBe(1);
  });

  it("faz upsert: salvar a mesma Saga duas vezes atualiza em vez de duplicar", async () => {
    const ordem = await ordemPersistida();
    const repositorio = new SagaRepositoryMySQL(db);

    const saga = novaSaga(ordem.id.getValue());
    await repositorio.salvar(saga);

    saga.registrarFalha("falha no pagamento");
    saga.registrarDados({ pagamentoId: "pag-1" });
    await repositorio.salvar(saga);

    const instancias = await db("saga_instancias").select("*");
    const passos = await db("saga_passos").select("*");

    expect(instancias).toHaveLength(1);
    expect(passos).toHaveLength(5);

    const recuperada = await repositorio.obter(saga.id.getValue());
    expect(recuperada?.estado).toBe(EstadoSaga.COMPENSANDO);
    expect(recuperada?.erro).toBe("falha no pagamento");
    expect(recuperada?.dados.pagamentoId).toBe("pag-1");
  });

  it("consulta por ordem de servico e por estado", async () => {
    const ordem = await ordemPersistida();
    const repositorio = new SagaRepositoryMySQL(db);

    const saga = novaSaga(ordem.id.getValue());
    await repositorio.salvar(saga);

    expect(
      (await repositorio.obterPorOrdemServico(ordem.id.getValue()))?.id.getValue(),
    ).toBe(saga.id.getValue());
    expect(await repositorio.listarPorEstado(EstadoSaga.INICIADA)).toHaveLength(1);
    expect(await repositorio.listarPorEstado(EstadoSaga.CONCLUIDA)).toHaveLength(0);
  });

  it("devolve nulo quando a Saga nao existe", async () => {
    const repositorio = new SagaRepositoryMySQL(db);

    expect(await repositorio.obter("11111111-1111-4111-8111-111111111111")).toBeNull();
    expect(await repositorio.obterPorOrdemServico("nao-existe")).toBeNull();
  });

  // Idempotencia duravel: a tabela mensagens_processadas impede que uma
  // reentrega do RabbitMQ avance a Saga duas vezes.
  it("registra e consulta mensagens processadas de forma idempotente", async () => {
    const repositorio = new SagaRepositoryMySQL(db);

    expect(await repositorio.jaProcessada("msg-1")).toBe(false);

    await repositorio.marcarProcessada("msg-1", "ORCAMENTO_GERADO", undefined);
    expect(await repositorio.jaProcessada("msg-1")).toBe(true);

    // Reinsercao da mesma mensagem nao lanca erro.
    await expect(
      repositorio.marcarProcessada("msg-1", "ORCAMENTO_GERADO", undefined),
    ).resolves.toBeUndefined();
  });
});
