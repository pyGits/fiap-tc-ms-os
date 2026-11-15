// Contrato de mensageria compartilhado pelos tres microsservicos.
//
// Seguindo a Aula 2 de "Estrutura de Microsservicos" (Comunicacao entre processos),
// toda mensagem tem um HEADER com metadados e um BODY. O body pode carregar um
// COMANDO (instrucao que o destinatario deve executar) ou um EVENTO (fato ocorrido).
//
// Na Saga ORQUESTRADA o OS Service envia COMANDOS para os participantes e eles
// respondem na fila de reply. Nenhum participante conhece os demais.

export const EXCHANGE = "oficina.saga";

// Filas de comando (orquestrador -> participante).
export const FILAS = {
  // Billing
  BILLING_COMANDOS: "saga.billing.comandos",
  // Execucao
  EXECUCAO_COMANDOS: "saga.execucao.comandos",
  // Respostas dos participantes de volta ao orquestrador.
  SAGA_REPLY: "saga.os.reply",
  // Fila de eventos de dominio (coreografia complementar: notificacoes).
  EVENTOS: "oficina.eventos",
  // Dead letter: mensagens que esgotaram as tentativas.
  DEAD_LETTER: "oficina.dead-letter",
} as const;

export const ROUTING_KEYS = {
  BILLING_COMANDOS: "billing.comandos",
  EXECUCAO_COMANDOS: "execucao.comandos",
  SAGA_REPLY: "os.reply",
  EVENTOS: "eventos",
  DEAD_LETTER: "dead-letter",
} as const;

// ---------------------------------------------------------------------------
// Comandos enviados pelo orquestrador
// ---------------------------------------------------------------------------
export enum TipoComando {
  // Billing
  GERAR_ORCAMENTO = "GERAR_ORCAMENTO",
  CANCELAR_ORCAMENTO = "CANCELAR_ORCAMENTO", // compensacao de GERAR_ORCAMENTO
  REGISTRAR_PAGAMENTO = "REGISTRAR_PAGAMENTO",
  ESTORNAR_PAGAMENTO = "ESTORNAR_PAGAMENTO", // compensacao de REGISTRAR_PAGAMENTO
  // Execucao
  ENFILEIRAR_EXECUCAO = "ENFILEIRAR_EXECUCAO",
  CANCELAR_EXECUCAO = "CANCELAR_EXECUCAO", // compensacao de ENFILEIRAR_EXECUCAO
}

// ---------------------------------------------------------------------------
// Respostas dos participantes (sempre na fila SAGA_REPLY)
// ---------------------------------------------------------------------------
export enum TipoResposta {
  ORCAMENTO_GERADO = "ORCAMENTO_GERADO",
  ORCAMENTO_FALHOU = "ORCAMENTO_FALHOU",
  ORCAMENTO_CANCELADO = "ORCAMENTO_CANCELADO",
  PAGAMENTO_REGISTRADO = "PAGAMENTO_REGISTRADO",
  PAGAMENTO_FALHOU = "PAGAMENTO_FALHOU",
  PAGAMENTO_ESTORNADO = "PAGAMENTO_ESTORNADO",
  EXECUCAO_ENFILEIRADA = "EXECUCAO_ENFILEIRADA",
  EXECUCAO_FALHOU = "EXECUCAO_FALHOU",
  EXECUCAO_CANCELADA = "EXECUCAO_CANCELADA",
  EXECUCAO_FINALIZADA = "EXECUCAO_FINALIZADA",
}

// Eventos de dominio publicados para quem quiser ouvir (pub/sub).
export enum TipoEvento {
  OS_CRIADA = "OS_CRIADA",
  OS_STATUS_ALTERADO = "OS_STATUS_ALTERADO",
  SAGA_CONCLUIDA = "SAGA_CONCLUIDA",
  SAGA_COMPENSADA = "SAGA_COMPENSADA",
}

export type ItemOrcamento = {
  id: string;
  descricao: string;
  quantidade: number;
  valorUnitario: number;
  tipo: "SERVICO" | "PECA" | "INSUMO";
};

// Header da mensagem: metadados que descrevem o dado contido no body.
export type MensagemHeader = {
  mensagemId: string;
  sagaId: string;
  correlationId: string;
  ordemServicoId: string;
  tipo: TipoComando | TipoResposta | TipoEvento;
  origem: string;
  dataEnvio: string;
  // Numero de entregas ja tentadas; usado no retry/dead letter.
  tentativa: number;
};

export type Mensagem<TBody = Record<string, unknown>> = {
  header: MensagemHeader;
  body: TBody;
};

// ---------------------------------------------------------------------------
// Payloads por comando
// ---------------------------------------------------------------------------
export type BodyGerarOrcamento = {
  clienteId: string;
  clienteEmail?: string;
  veiculoId: string;
  itens: ItemOrcamento[];
};

export type BodyCancelarOrcamento = { orcamentoId?: string; motivo: string };

export type BodyRegistrarPagamento = {
  orcamentoId: string;
  valor: number;
  clienteId: string;
  // Forca uma falha controlada no pagamento para demonstrar o rollback da Saga
  // durante o video. Nunca e enviado pelo fluxo normal.
  simularFalha?: boolean;
};

export type BodyEstornarPagamento = { pagamentoId?: string; motivo: string };

export type BodyEnfileirarExecucao = {
  clienteId: string;
  veiculoId: string;
  itens: ItemOrcamento[];
  // Idem: permite demonstrar a compensacao a partir da etapa de execucao.
  simularFalha?: boolean;
};

export type BodyCancelarExecucao = { motivo: string };

// ---------------------------------------------------------------------------
// Payloads de resposta
// ---------------------------------------------------------------------------
export type BodyOrcamentoGerado = { orcamentoId: string; valorTotal: number };
export type BodyPagamentoRegistrado = {
  pagamentoId: string;
  valor: number;
  status: string;
  // Identificador do pagamento no Mercado Pago (quando integrado).
  idExterno?: string;
};
export type BodyExecucaoEnfileirada = { execucaoId: string; posicaoFila: number };
export type BodyExecucaoFinalizada = { execucaoId: string; finalizadaEm: string };
export type BodyFalha = { motivo: string; codigo?: string };
