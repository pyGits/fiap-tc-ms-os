import type { Knex } from "knex";
import SagaOrdemServico, {
  EstadoSaga,
  PassoSaga,
  StatusPasso,
} from "../../saga/SagaOrdemServico";
import ID from "../../vo/ID";
import SagaRepository from "../SagaRepository";

type LinhaSaga = {
  id: string;
  ordem_servico_id: string;
  correlation_id: string;
  estado: EstadoSaga;
  passo_atual: number;
  erro: string | null;
  dados: string | Record<string, unknown> | null;
  criada_em: Date;
  atualizada_em: Date;
};

type LinhaPasso = {
  saga_id: string;
  nome: string;
  ordem: number;
  participante: string;
  comando: string;
  compensacao: string | null;
  status: StatusPasso;
  iniciado_em: Date | null;
  concluido_em: Date | null;
  erro: string | null;
  resposta: string | Record<string, unknown> | null;
};

// O MySQL 8 devolve colunas JSON ja desserializadas em alguns drivers e como
// string em outros; normalizamos nos dois casos.
function lerJson(valor: unknown): Record<string, unknown> | undefined {
  if (valor === null || valor === undefined) return undefined;
  if (typeof valor === "string") {
    try {
      return JSON.parse(valor) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  return valor as Record<string, unknown>;
}

export default class SagaRepositoryMySQL implements SagaRepository {
  constructor(private readonly db: Knex) {}

  // Um unico upsert transacional da instancia e de todos os passos: o saga log
  // nunca pode ficar meio gravado, senao a retomada apos falha fica ambigua.
  async salvar(saga: SagaOrdemServico): Promise<void> {
    await this.db.transaction(async (trx) => {
      const cabecalho = {
        id: saga.id.getValue(),
        ordem_servico_id: saga.ordemServicoId,
        correlation_id: saga.correlationId,
        estado: saga.estado,
        passo_atual: saga.passoAtual,
        erro: saga.erro ?? null,
        dados: JSON.stringify(saga.dados ?? {}),
        criada_em: saga.criadaEm,
        atualizada_em: saga.atualizadaEm,
      };

      await trx("saga_instancias")
        .insert(cabecalho)
        .onConflict("id")
        .merge([
          "estado",
          "passo_atual",
          "erro",
          "dados",
          "atualizada_em",
        ]);

      for (const passo of saga.passos) {
        const linha = {
          saga_id: saga.id.getValue(),
          nome: passo.nome,
          ordem: passo.ordem,
          participante: passo.participante,
          comando: passo.comando,
          compensacao: passo.compensacao,
          status: passo.status,
          iniciado_em: passo.iniciadoEm ?? null,
          concluido_em: passo.concluidoEm ?? null,
          erro: passo.erro ?? null,
          resposta: passo.resposta ? JSON.stringify(passo.resposta) : null,
        };

        await trx("saga_passos")
          .insert(linha)
          .onConflict(["saga_id", "nome"])
          .merge([
            "status",
            "iniciado_em",
            "concluido_em",
            "erro",
            "resposta",
          ]);
      }
    });
  }

  async obter(id: string): Promise<SagaOrdemServico | null> {
    const linha = await this.db("saga_instancias")
      .where({ id })
      .first<LinhaSaga | undefined>();
    if (!linha) return null;

    return this.hidratar(linha, await this.passosDe([linha.id]));
  }

  async obterPorOrdemServico(
    ordemServicoId: string,
  ): Promise<SagaOrdemServico | null> {
    const linha = await this.db("saga_instancias")
      .where({ ordem_servico_id: ordemServicoId })
      .orderBy("criada_em", "desc")
      .first<LinhaSaga | undefined>();
    if (!linha) return null;

    return this.hidratar(linha, await this.passosDe([linha.id]));
  }

  async listarPorEstado(estado: EstadoSaga): Promise<SagaOrdemServico[]> {
    const linhas = await this.db("saga_instancias")
      .where({ estado })
      .select<LinhaSaga[]>("*");
    if (linhas.length === 0) return [];

    const passos = await this.passosDe(linhas.map((linha) => linha.id));

    return linhas.map((linha) =>
      this.hidratar(
        linha,
        passos.filter((passo) => passo.saga_id === linha.id),
      ),
    );
  }

  private async passosDe(sagaIds: string[]): Promise<LinhaPasso[]> {
    return this.db("saga_passos")
      .whereIn("saga_id", sagaIds)
      .orderBy("ordem", "asc")
      .select<LinhaPasso[]>("*");
  }

  private hidratar(
    linha: LinhaSaga,
    linhasPassos: LinhaPasso[],
  ): SagaOrdemServico {
    const passos: PassoSaga[] = linhasPassos.map((passo) => ({
      nome: passo.nome,
      ordem: Number(passo.ordem),
      participante: passo.participante,
      comando: passo.comando,
      compensacao: passo.compensacao,
      status: passo.status,
      iniciadoEm: passo.iniciado_em ? new Date(passo.iniciado_em) : undefined,
      concluidoEm: passo.concluido_em ? new Date(passo.concluido_em) : undefined,
      erro: passo.erro ?? undefined,
      resposta: lerJson(passo.resposta),
    }));

    return new SagaOrdemServico({
      id: new ID(linha.id),
      ordemServicoId: linha.ordem_servico_id,
      correlationId: linha.correlation_id,
      passos,
      estado: linha.estado,
      passoAtual: Number(linha.passo_atual),
      dadosNegocio: lerJson(linha.dados) ?? {},
      criadaEm: new Date(linha.criada_em),
      atualizadaEm: new Date(linha.atualizada_em),
      erro: linha.erro ?? undefined,
    });
  }

  // --- Idempotencia dos consumidores ---
  //
  // O RabbitMQ entrega "ao menos uma vez": a mesma resposta pode chegar duas
  // vezes. Registrar o mensagemId no mesmo banco do saga log garante que um
  // reprocessamento nao avance a Saga de novo (Aula 5, "Estrutura de
  // Microsservicos": event handlers idempotentes).
  async jaProcessada(mensagemId: string): Promise<boolean> {
    const linha = await this.db("mensagens_processadas")
      .where({ mensagem_id: mensagemId })
      .first();
    return Boolean(linha);
  }

  async marcarProcessada(
    mensagemId: string,
    tipo: string,
    sagaId?: string,
  ): Promise<void> {
    await this.db("mensagens_processadas")
      .insert({
        mensagem_id: mensagemId,
        tipo,
        saga_id: sagaId ?? null,
        processada_em: new Date(),
      })
      .onConflict("mensagem_id")
      .ignore();
  }
}
