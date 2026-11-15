import SagaOrquestrador from "../../domain/saga/SagaOrquestrador";
import logger from "../logger";
import MessageConsumer, { Manipulador } from "./MessageConsumer";
import {
  BodyExecucaoEnfileirada,
  BodyExecucaoFinalizada,
  BodyFalha,
  BodyOrcamentoGerado,
  BodyPagamentoRegistrado,
  FILAS,
  Mensagem,
  TipoResposta,
} from "./contracts";

export type FinalizarExecucaoHandler = (
  ordemServicoId: string,
  execucaoId: string,
) => Promise<void>;

// Adaptador de entrada (driving adapter) do orquestrador.
//
// Toda resposta dos participantes chega em UMA unica fila (saga.os.reply) e e
// roteada aqui para o metodo correspondente do orquestrador. E este arquivo
// que fecha o ciclo "comando -> transacao local no participante -> resposta ->
// proximo passo ou compensacao".
export default class SagaReplyConsumer {
  constructor(
    private readonly orquestrador: SagaOrquestrador,
    private readonly consumer: MessageConsumer = new MessageConsumer(),
    // Finalizacao da execucao nao faz parte da Saga (ela ja terminou quando a
    // execucao foi enfileirada): e um evento posterior do ciclo de vida da OS.
    private readonly finalizarExecucao?: FinalizarExecucaoHandler,
  ) {}

  async iniciar(): Promise<void> {
    await this.consumer.consumir(FILAS.SAGA_REPLY, this.manipuladores());
  }

  manipuladores(): Record<string, Manipulador> {
    return {
      [TipoResposta.ORCAMENTO_GERADO]: async (mensagem) => {
        const body = mensagem.body as BodyOrcamentoGerado;
        await this.orquestrador.orcamentoGerado(
          mensagem.header.sagaId,
          body.orcamentoId,
          Number(body.valorTotal),
        );
      },

      [TipoResposta.ORCAMENTO_FALHOU]: async (mensagem) => {
        await this.orquestrador.orcamentoFalhou(
          mensagem.header.sagaId,
          this.motivo(mensagem, "Falha ao gerar o orcamento."),
        );
      },

      [TipoResposta.PAGAMENTO_REGISTRADO]: async (mensagem) => {
        const body = mensagem.body as BodyPagamentoRegistrado;
        await this.orquestrador.pagamentoRegistrado(
          mensagem.header.sagaId,
          body.pagamentoId,
        );
      },

      [TipoResposta.PAGAMENTO_FALHOU]: async (mensagem) => {
        await this.orquestrador.pagamentoFalhou(
          mensagem.header.sagaId,
          this.motivo(mensagem, "Falha ao registrar o pagamento."),
        );
      },

      [TipoResposta.EXECUCAO_ENFILEIRADA]: async (mensagem) => {
        const body = mensagem.body as BodyExecucaoEnfileirada;
        await this.orquestrador.execucaoEnfileirada(
          mensagem.header.sagaId,
          body.execucaoId,
        );
      },

      [TipoResposta.EXECUCAO_FALHOU]: async (mensagem) => {
        await this.orquestrador.execucaoFalhou(
          mensagem.header.sagaId,
          this.motivo(mensagem, "Falha ao enfileirar a execucao."),
        );
      },

      // Respostas de compensacao: o orquestrador ja marcou o passo como
      // COMPENSADO ao publicar o comando. O log aqui serve de evidencia do
      // rollback completo na demonstracao e nos dashboards.
      [TipoResposta.ORCAMENTO_CANCELADO]: async (mensagem) => {
        logger.info(
          { sagaId: mensagem.header.sagaId },
          "compensacao confirmada pelo Billing: orcamento cancelado",
        );
      },

      [TipoResposta.PAGAMENTO_ESTORNADO]: async (mensagem) => {
        logger.info(
          { sagaId: mensagem.header.sagaId },
          "compensacao confirmada pelo Billing: pagamento estornado",
        );
      },

      [TipoResposta.EXECUCAO_CANCELADA]: async (mensagem) => {
        logger.info(
          { sagaId: mensagem.header.sagaId },
          "compensacao confirmada pela Execucao: servico cancelado",
        );
      },

      [TipoResposta.EXECUCAO_FINALIZADA]: async (mensagem) => {
        const body = mensagem.body as BodyExecucaoFinalizada;
        if (!this.finalizarExecucao) {
          logger.warn(
            { ordemServicoId: mensagem.header.ordemServicoId },
            "execucao finalizada recebida sem manipulador registrado",
          );
          return;
        }
        await this.finalizarExecucao(
          mensagem.header.ordemServicoId,
          body.execucaoId,
        );
      },
    };
  }

  private motivo(mensagem: Mensagem, padrao: string): string {
    const body = mensagem.body as BodyFalha;
    return body?.motivo || padrao;
  }
}
