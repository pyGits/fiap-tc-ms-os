import { randomUUID } from "crypto";
import { getContexto } from "../context";
import logger from "../logger";
import { RabbitMQConnection, rabbitMQConnection } from "./RabbitMQConnection";
import {
  EXCHANGE,
  Mensagem,
  MensagemHeader,
  TipoComando,
  TipoEvento,
  TipoResposta,
} from "./contracts";

export type DadosPublicacao<TBody> = {
  routingKey: string;
  tipo: TipoComando | TipoResposta | TipoEvento;
  sagaId: string;
  ordemServicoId: string;
  body: TBody;
  tentativa?: number;
};

// Publicador de mensagens: monta o header padronizado (com correlationId e
// sagaId do contexto) e envia de forma persistente para a exchange.
export default class MessagePublisher {
  constructor(
    private readonly conexao: RabbitMQConnection = rabbitMQConnection,
    private readonly origem = process.env.SERVICE_NAME || "fiap-ms",
  ) {}

  async publicar<TBody>(dados: DadosPublicacao<TBody>): Promise<MensagemHeader> {
    const header: MensagemHeader = {
      mensagemId: randomUUID(),
      sagaId: dados.sagaId,
      correlationId: getContexto()?.correlationId ?? randomUUID(),
      ordemServicoId: dados.ordemServicoId,
      tipo: dados.tipo,
      origem: this.origem,
      dataEnvio: new Date().toISOString(),
      tentativa: dados.tentativa ?? 1,
    };

    const mensagem: Mensagem<TBody> = { header, body: dados.body };
    const channel = await this.conexao.getChannel();

    channel.publish(
      EXCHANGE,
      dados.routingKey,
      Buffer.from(JSON.stringify(mensagem)),
      {
        persistent: true,
        messageId: header.mensagemId,
        correlationId: header.correlationId,
        contentType: "application/json",
        type: String(header.tipo),
        timestamp: Date.now(),
      },
    );

    logger.info(
      {
        tipo: header.tipo,
        routingKey: dados.routingKey,
        mensagemId: header.mensagemId,
        tentativa: header.tentativa,
      },
      "mensagem publicada",
    );

    return header;
  }
}
