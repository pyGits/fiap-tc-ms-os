import { EXCHANGE, FILAS, ROUTING_KEYS } from "../../src/messaging/contracts";

// Dublê do amqplib: registra a topologia declarada no momento da conexao.
type Args = unknown[];

const canal = {
  prefetch: jest.fn(async (..._args: Args) => undefined),
  assertExchange: jest.fn(async (..._args: Args) => undefined),
  assertQueue: jest.fn(async (..._args: Args) => undefined),
  bindQueue: jest.fn(async (..._args: Args) => undefined),
  close: jest.fn(async (..._args: Args) => undefined),
};

const conexao = {
  createChannel: jest.fn(async () => canal),
  on: jest.fn((..._args: Args) => undefined),
  close: jest.fn(async (..._args: Args) => undefined),
};

const connect = jest.fn(async () => conexao);

jest.mock("amqplib", () => ({
  __esModule: true,
  default: { connect: (...args: unknown[]) => connect(...(args as [])) },
  connect: (...args: unknown[]) => connect(...(args as [])),
}));

// Importado depois do mock para que o modulo receba o dublê.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { RabbitMQConnection } = require("../../src/messaging/RabbitMQConnection");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("RabbitMQConnection", () => {
  it("declara a topologia completa em codigo, de forma idempotente", async () => {
    const instancia = new RabbitMQConnection("amqp://guest:guest@broker:5672", 5);

    await instancia.getChannel();

    expect(connect).toHaveBeenCalledWith("amqp://guest:guest@broker:5672");
    expect(canal.prefetch).toHaveBeenCalledWith(5);
    expect(canal.assertExchange).toHaveBeenCalledWith(EXCHANGE, "direct", {
      durable: true,
    });

    const filasDeclaradas = canal.assertQueue.mock.calls.map(
      (chamada) => chamada[0],
    );
    expect(filasDeclaradas).toEqual([
      FILAS.DEAD_LETTER,
      FILAS.BILLING_COMANDOS,
      FILAS.EXECUCAO_COMANDOS,
      FILAS.SAGA_REPLY,
      FILAS.EVENTOS,
    ]);

    // Toda fila de trabalho aponta para a dead letter: mensagem que esgota as
    // tentativas e desviada em vez de perdida.
    const opcoesBilling = canal.assertQueue.mock.calls.find(
      (chamada) => chamada[0] === FILAS.BILLING_COMANDOS,
    )?.[1] as unknown as Record<string, unknown>;
    expect(opcoesBilling).toEqual({
      durable: true,
      deadLetterExchange: EXCHANGE,
      deadLetterRoutingKey: ROUTING_KEYS.DEAD_LETTER,
    });
  });

  it("reaproveita o canal em chamadas seguintes", async () => {
    const instancia = new RabbitMQConnection();

    const primeiro = await instancia.getChannel();
    const segundo = await instancia.getChannel();

    expect(primeiro).toBe(segundo);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("nao abre duas conexoes quando duas chamadas concorrem", async () => {
    const instancia = new RabbitMQConnection();

    await Promise.all([instancia.getChannel(), instancia.getChannel()]);

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("fecha canal e conexao no encerramento gracioso", async () => {
    const instancia = new RabbitMQConnection();
    await instancia.getChannel();

    await instancia.close();

    expect(canal.close).toHaveBeenCalled();
    expect(conexao.close).toHaveBeenCalled();
  });

  it("nao propaga erro ao fechar uma conexao com problema", async () => {
    const instancia = new RabbitMQConnection();
    await instancia.getChannel();
    canal.close.mockRejectedValueOnce(new Error("socket ja fechado"));

    await expect(instancia.close()).resolves.toBeUndefined();
  });

  it("registra tratadores de erro e de fechamento da conexao", async () => {
    const instancia = new RabbitMQConnection();
    await instancia.getChannel();

    const eventos = conexao.on.mock.calls.map((chamada) => chamada[0]);
    expect(eventos).toEqual(["error", "close"]);

    // Ao cair a conexao, o canal e descartado para que a proxima chamada
    // reconecte em vez de usar um canal morto.
    const aoFechar = conexao.on.mock.calls.find(
      (chamada) => chamada[0] === "close",
    )?.[1] as unknown as () => void;
    aoFechar();

    await instancia.getChannel();
    expect(connect).toHaveBeenCalledTimes(2);
  });
});
