import MensageriaGateway, {
  ContextoMensagem,
} from "../../domain/gateway/MensageriaGateway";
import MessagePublisher from "./MessagePublisher";
import {
  BodyCancelarExecucao,
  BodyCancelarOrcamento,
  BodyEnfileirarExecucao,
  BodyEstornarPagamento,
  BodyGerarOrcamento,
  BodyRegistrarPagamento,
  ROUTING_KEYS,
  TipoComando,
  TipoEvento,
} from "./contracts";

// Adaptador de saida (driven adapter): traduz as chamadas do orquestrador em
// mensagens AMQP. Toda a dependencia do amqplib vive deste lado da borda; o
// dominio continua enxergando apenas a interface MensageriaGateway.
export default class RabbitMQMensageriaGateway implements MensageriaGateway {
  constructor(private readonly publisher: MessagePublisher = new MessagePublisher()) {}

  private async comando<TBody>(
    routingKey: string,
    tipo: TipoComando,
    ctx: ContextoMensagem,
    body: TBody,
  ): Promise<void> {
    await this.publisher.publicar<TBody>({
      routingKey,
      tipo,
      sagaId: ctx.sagaId,
      ordemServicoId: ctx.ordemServicoId,
      body,
    });
  }

  // --- Comandos para o Billing Service ---

  async enviarGerarOrcamento(ctx: ContextoMensagem, body: BodyGerarOrcamento) {
    await this.comando(
      ROUTING_KEYS.BILLING_COMANDOS,
      TipoComando.GERAR_ORCAMENTO,
      ctx,
      body,
    );
  }

  async enviarCancelarOrcamento(
    ctx: ContextoMensagem,
    body: BodyCancelarOrcamento,
  ) {
    await this.comando(
      ROUTING_KEYS.BILLING_COMANDOS,
      TipoComando.CANCELAR_ORCAMENTO,
      ctx,
      body,
    );
  }

  async enviarRegistrarPagamento(
    ctx: ContextoMensagem,
    body: BodyRegistrarPagamento,
  ) {
    await this.comando(
      ROUTING_KEYS.BILLING_COMANDOS,
      TipoComando.REGISTRAR_PAGAMENTO,
      ctx,
      body,
    );
  }

  async enviarEstornarPagamento(
    ctx: ContextoMensagem,
    body: BodyEstornarPagamento,
  ) {
    await this.comando(
      ROUTING_KEYS.BILLING_COMANDOS,
      TipoComando.ESTORNAR_PAGAMENTO,
      ctx,
      body,
    );
  }

  // --- Comandos para o servico de Execucao ---

  async enviarEnfileirarExecucao(
    ctx: ContextoMensagem,
    body: BodyEnfileirarExecucao,
  ) {
    await this.comando(
      ROUTING_KEYS.EXECUCAO_COMANDOS,
      TipoComando.ENFILEIRAR_EXECUCAO,
      ctx,
      body,
    );
  }

  async enviarCancelarExecucao(
    ctx: ContextoMensagem,
    body: BodyCancelarExecucao,
  ) {
    await this.comando(
      ROUTING_KEYS.EXECUCAO_COMANDOS,
      TipoComando.CANCELAR_EXECUCAO,
      ctx,
      body,
    );
  }

  // --- Eventos de dominio (publish/subscribe) ---
  //
  // Diferente dos comandos, o evento nao espera resposta e nao tem destinatario
  // conhecido: quem quiser reagir se inscreve na fila de eventos.
  async publicarEvento(
    ctx: ContextoMensagem,
    tipo: TipoEvento,
    body: Record<string, unknown>,
  ) {
    await this.publisher.publicar({
      routingKey: ROUTING_KEYS.EVENTOS,
      tipo,
      sagaId: ctx.sagaId,
      ordemServicoId: ctx.ordemServicoId,
      body,
    });
  }
}
