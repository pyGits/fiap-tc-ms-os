import { AsyncLocalStorage } from "async_hooks";

// Contexto por requisicao/mensagem usando AsyncLocalStorage.
//
// Herdado da Fase 3 (correlationId) e ampliado na Fase 4 com o sagaId: num fluxo
// distribuido a correlacao precisa atravessar HTTP *e* mensageria, para que o
// rastreamento no New Relic ligue a mesma transacao de negocio em tres servicos.
export type ContextoRequisicao = {
  correlationId: string;
  sagaId?: string;
  ordemServicoId?: string;
};

const storage = new AsyncLocalStorage<ContextoRequisicao>();

export function runComContexto<T>(contexto: ContextoRequisicao, fn: () => T): T {
  return storage.run(contexto, fn);
}

export function getContexto(): ContextoRequisicao | undefined {
  return storage.getStore();
}

// Retorna o correlationId atual (ou null fora de uma requisicao/mensagem,
// por exemplo em migrations e jobs).
export function getCorrelationId(): string | null {
  return storage.getStore()?.correlationId ?? null;
}

export function getSagaId(): string | null {
  return storage.getStore()?.sagaId ?? null;
}
