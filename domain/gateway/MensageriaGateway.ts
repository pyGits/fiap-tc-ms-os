import {
  BodyCancelarExecucao,
  BodyCancelarOrcamento,
  BodyEnfileirarExecucao,
  BodyEstornarPagamento,
  BodyGerarOrcamento,
  BodyRegistrarPagamento,
  TipoEvento,
} from "../../src/messaging/contracts";

export type ContextoMensagem = {
  sagaId: string;
  ordemServicoId: string;
};

// Porta de saida para a mensageria (arquitetura hexagonal).
//
// O orquestrador depende desta interface, nunca do amqplib. E o que permite
// testar toda a Saga - inclusive o rollback - com um duble em memoria, sem
// subir RabbitMQ, conforme a Aula 3 de "Estrutura de Microsservicos - Parte II".
export default interface MensageriaGateway {
  // --- Comandos para o Billing Service ---
  enviarGerarOrcamento(ctx: ContextoMensagem, body: BodyGerarOrcamento): Promise<void>;
  enviarCancelarOrcamento(
    ctx: ContextoMensagem,
    body: BodyCancelarOrcamento,
  ): Promise<void>;
  enviarRegistrarPagamento(
    ctx: ContextoMensagem,
    body: BodyRegistrarPagamento,
  ): Promise<void>;
  enviarEstornarPagamento(
    ctx: ContextoMensagem,
    body: BodyEstornarPagamento,
  ): Promise<void>;

  // --- Comandos para o servico de Execucao ---
  enviarEnfileirarExecucao(
    ctx: ContextoMensagem,
    body: BodyEnfileirarExecucao,
  ): Promise<void>;
  enviarCancelarExecucao(
    ctx: ContextoMensagem,
    body: BodyCancelarExecucao,
  ): Promise<void>;

  // --- Eventos de dominio (pub/sub, para quem quiser ouvir) ---
  publicarEvento(
    ctx: ContextoMensagem,
    tipo: TipoEvento,
    body: Record<string, unknown>,
  ): Promise<void>;
}
