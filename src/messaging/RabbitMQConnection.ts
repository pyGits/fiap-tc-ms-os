import amqplib, { Channel, ChannelModel } from "amqplib";
import logger from "../logger";
import { EXCHANGE, FILAS, ROUTING_KEYS } from "./contracts";

// Conexao unica com o RabbitMQ, compartilhada por publishers e consumers.
//
// O RabbitMQ e o broker usado nas aulas praticas do SAGA Pattern (Aulas 4 e 5).
// Aqui a topologia e declarada em codigo (e nao pelo painel administrativo) para
// que os ambientes local, hml e prd subam identicos e de forma idempotente.
export class RabbitMQConnection {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private conectando: Promise<Channel> | null = null;

  constructor(
    private readonly url = process.env.RABBITMQ_URL ||
      "amqp://guest:guest@localhost:5672",
    private readonly prefetch = Number(process.env.RABBITMQ_PREFETCH || 10),
  ) {}

  async getChannel(): Promise<Channel> {
    if (this.channel) return this.channel;
    if (this.conectando) return this.conectando;

    this.conectando = this.conectar();
    try {
      return await this.conectando;
    } finally {
      this.conectando = null;
    }
  }

  private async conectar(): Promise<Channel> {
    logger.info({ url: this.mascararUrl() }, "conectando ao RabbitMQ");

    const connection = await amqplib.connect(this.url);
    const channel = await connection.createChannel();

    await channel.prefetch(this.prefetch);
    await this.declararTopologia(channel);

    connection.on("error", (erro: Error) => {
      logger.error({ erro: erro.message }, "conexao com RabbitMQ em erro");
      this.connection = null;
      this.channel = null;
    });

    connection.on("close", () => {
      logger.warn("conexao com RabbitMQ encerrada");
      this.connection = null;
      this.channel = null;
    });

    this.connection = connection;
    this.channel = channel;

    logger.info("conectado ao RabbitMQ");
    return channel;
  }

  // Exchange do tipo direct + filas duraveis. As mensagens que esgotam as
  // tentativas sao desviadas para a fila de dead letter em vez de serem perdidas.
  private async declararTopologia(channel: Channel): Promise<void> {
    await channel.assertExchange(EXCHANGE, "direct", { durable: true });

    await channel.assertQueue(FILAS.DEAD_LETTER, { durable: true });
    await channel.bindQueue(FILAS.DEAD_LETTER, EXCHANGE, ROUTING_KEYS.DEAD_LETTER);

    const opcoes = {
      durable: true,
      deadLetterExchange: EXCHANGE,
      deadLetterRoutingKey: ROUTING_KEYS.DEAD_LETTER,
    };

    const filas: Array<[string, string]> = [
      [FILAS.BILLING_COMANDOS, ROUTING_KEYS.BILLING_COMANDOS],
      [FILAS.EXECUCAO_COMANDOS, ROUTING_KEYS.EXECUCAO_COMANDOS],
      [FILAS.SAGA_REPLY, ROUTING_KEYS.SAGA_REPLY],
      [FILAS.EVENTOS, ROUTING_KEYS.EVENTOS],
    ];

    for (const [fila, routingKey] of filas) {
      await channel.assertQueue(fila, opcoes);
      await channel.bindQueue(fila, EXCHANGE, routingKey);
    }
  }

  async close(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch (erro) {
      logger.warn(
        { erro: erro instanceof Error ? erro.message : String(erro) },
        "falha ao fechar conexao com RabbitMQ",
      );
    } finally {
      this.channel = null;
      this.connection = null;
    }
  }

  private mascararUrl(): string {
    return this.url.replace(/\/\/[^@]*@/, "//***:***@");
  }
}

export const rabbitMQConnection = new RabbitMQConnection();
export default rabbitMQConnection;
