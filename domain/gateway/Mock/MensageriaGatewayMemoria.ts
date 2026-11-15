import MensageriaGateway, { ContextoMensagem } from "../MensageriaGateway";
import {
  BodyCancelarExecucao,
  BodyCancelarOrcamento,
  BodyEnfileirarExecucao,
  BodyEstornarPagamento,
  BodyGerarOrcamento,
  BodyRegistrarPagamento,
  TipoEvento,
} from "../../../src/messaging/contracts";

export type MensagemEnviada = {
  tipo: string;
  ctx: ContextoMensagem;
  body: Record<string, unknown>;
};

// Duble em memoria da mensageria.
//
// Registra tudo o que o orquestrador publicaria no RabbitMQ, permitindo que os
// testes afirmem a ORDEM dos comandos - inclusive a ordem inversa das
// compensacoes, que e o coracao do rollback da Saga.
export default class MensageriaGatewayMemoria implements MensageriaGateway {
  readonly enviadas: MensagemEnviada[] = [];
  readonly eventos: MensagemEnviada[] = [];

  // Permite simular indisponibilidade do broker nos testes de resiliencia.
  falharNoProximoEnvio = false;

  private registrar(tipo: string, ctx: ContextoMensagem, body: unknown) {
    if (this.falharNoProximoEnvio) {
      this.falharNoProximoEnvio = false;
      throw new Error(`Falha simulada ao publicar ${tipo}.`);
    }
    this.enviadas.push({
      tipo,
      ctx: { ...ctx },
      body: { ...(body as Record<string, unknown>) },
    });
  }

  async enviarGerarOrcamento(ctx: ContextoMensagem, body: BodyGerarOrcamento) {
    this.registrar("GERAR_ORCAMENTO", ctx, body);
  }

  async enviarCancelarOrcamento(
    ctx: ContextoMensagem,
    body: BodyCancelarOrcamento,
  ) {
    this.registrar("CANCELAR_ORCAMENTO", ctx, body);
  }

  async enviarRegistrarPagamento(
    ctx: ContextoMensagem,
    body: BodyRegistrarPagamento,
  ) {
    this.registrar("REGISTRAR_PAGAMENTO", ctx, body);
  }

  async enviarEstornarPagamento(
    ctx: ContextoMensagem,
    body: BodyEstornarPagamento,
  ) {
    this.registrar("ESTORNAR_PAGAMENTO", ctx, body);
  }

  async enviarEnfileirarExecucao(
    ctx: ContextoMensagem,
    body: BodyEnfileirarExecucao,
  ) {
    this.registrar("ENFILEIRAR_EXECUCAO", ctx, body);
  }

  async enviarCancelarExecucao(
    ctx: ContextoMensagem,
    body: BodyCancelarExecucao,
  ) {
    this.registrar("CANCELAR_EXECUCAO", ctx, body);
  }

  async publicarEvento(
    ctx: ContextoMensagem,
    tipo: TipoEvento,
    body: Record<string, unknown>,
  ) {
    this.eventos.push({ tipo, ctx: { ...ctx }, body: { ...body } });
  }

  // --- Auxiliares de teste ---

  tipos(): string[] {
    return this.enviadas.map((mensagem) => mensagem.tipo);
  }

  tiposEventos(): string[] {
    return this.eventos.map((evento) => evento.tipo);
  }

  ultima(): MensagemEnviada | undefined {
    return this.enviadas[this.enviadas.length - 1];
  }

  buscar(tipo: string): MensagemEnviada | undefined {
    return this.enviadas.find((mensagem) => mensagem.tipo === tipo);
  }

  limpar() {
    this.enviadas.length = 0;
    this.eventos.length = 0;
    this.falharNoProximoEnvio = false;
  }
}
