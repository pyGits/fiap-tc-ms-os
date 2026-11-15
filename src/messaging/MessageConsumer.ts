import { ConsumeMessage } from "amqplib";
import { runComContexto } from "../context";
import logger from "../logger";
import { RabbitMQConnection, rabbitMQConnection } from "./RabbitMQConnection";
import { EXCHANGE, Mensagem, ROUTING_KEYS } from "./contracts";

export type Manipulador = (mensagem: Mensagem) => Promise<void>;

// Numero maximo de reentregas antes de mandar a mensagem para a dead letter.
const MAX_TENTATIVAS = Number(process.env.RABBITMQ_MAX_TENTATIVAS || 3);

// Consumidor de mensagens.
//
// Responsabilidades, conforme a Aula 5 de "Estrutura de Microsservicos"
// (Idempotent Event Handlers):
//   - restaura correlationId/sagaId no AsyncLocalStorage antes de processar;
//   - descarta mensagens ja processadas (idempotencia por mensagemId);
//   - reenfileira em caso de falha e desvia para a dead letter apos N tentativas.
export default class MessageConsumer {
  // Em producao este controle viveria em Redis/banco; em memoria ja garante a
  // idempotencia dentro da instancia e mantem o exemplo didatico.
  private readonly processadas = new Set<string>();

  constructor(
    private readonly conexao: RabbitMQConnection = rabbitMQConnection,
    private readonly maxTentativas = MAX_TENTATIVAS,
  ) {}

  jaProcessada(mensagemId: string): boolean {
    return this.processadas.has(mensagemId);
  }

  async consumir(
    fila: string,
    manipuladores: Record<string, Manipulador>,
  ): Promise<void> {
    const channel = await this.conexao.getChannel();

    await channel.consume(fila, async (raw: ConsumeMessage | null) => {
      if (!raw) return;

      let mensagem: Mensagem;
      try {
        mensagem = JSON.parse(raw.content.toString()) as Mensagem;
      } catch (erro) {
        logger.error(
          { erro: erro instanceof Error ? erro.message : String(erro), fila },
          "mensagem invalida descartada",
        );
        channel.nack(raw, false, false);
        return;
      }

      const { header } = mensagem;

      await runComContexto(
        {
          correlationId: header.correlationId,
          sagaId: header.sagaId,
          ordemServicoId: header.ordemServicoId,
        },
        async () => {
          // Idempotencia: a mesma mensagem pode ser reentregue pelo broker.
          if (this.processadas.has(header.mensagemId)) {
            logger.warn(
              { mensagemId: header.mensagemId, tipo: header.tipo },
              "mensagem duplicada ignorada",
            );
            channel.ack(raw);
            return;
          }

          const manipulador = manipuladores[String(header.tipo)];
          if (!manipulador) {
            logger.warn(
              { tipo: header.tipo, fila },
              "nenhum manipulador registrado para o tipo da mensagem",
            );
            channel.ack(raw);
            return;
          }

          const inicio = Date.now();
          try {
            await manipulador(mensagem);
            this.processadas.add(header.mensagemId);
            channel.ack(raw);

            logger.info(
              { tipo: header.tipo, fila, duracaoMs: Date.now() - inicio },
              "mensagem processada",
            );
          } catch (erro) {
            const motivo = erro instanceof Error ? erro.message : String(erro);
            const tentativa = header.tentativa ?? 1;

            if (tentativa >= this.maxTentativas) {
              logger.error(
                { tipo: header.tipo, fila, tentativa, erro: motivo },
                "mensagem enviada para a dead letter",
              );
              channel.publish(
                EXCHANGE,
                ROUTING_KEYS.DEAD_LETTER,
                Buffer.from(
                  JSON.stringify({ ...mensagem, falha: { motivo, tentativa } }),
                ),
                { persistent: true },
              );
              channel.ack(raw);
              return;
            }

            logger.warn(
              { tipo: header.tipo, fila, tentativa, erro: motivo },
              "falha ao processar mensagem, reenfileirando",
            );
            channel.publish(
              EXCHANGE,
              raw.fields.routingKey,
              Buffer.from(
                JSON.stringify({
                  ...mensagem,
                  header: { ...header, tentativa: tentativa + 1 },
                }),
              ),
              { persistent: true },
            );
            channel.ack(raw);
          }
        },
      );
    });

    logger.info(
      { fila, tipos: Object.keys(manipuladores) },
      "consumidor registrado",
    );
  }
}
