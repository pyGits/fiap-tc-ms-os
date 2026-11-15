import type { Knex } from "knex";
import OrdemServico, { StatusOrdemServico } from "../../entity/OrdemServico";
import ItemOrdemServico, { TipoItem } from "../../entity/ItemOrdemServico";
import ID from "../../vo/ID";
import OrdemServicoRepository, {
  FiltroOrdemServico,
  TempoMedioPorStatus,
} from "../OrdemServicoRepository";

type LinhaOS = {
  id: string;
  cliente_id: string;
  veiculo_id: string;
  status: StatusOrdemServico;
  valor_total: string | number;
  data_criacao: Date;
  data_inicio_execucao: Date | null;
  data_fim_execucao: Date | null;
  motivo_recusa: string | null;
  motivo_cancelamento: string | null;
  saga_id: string | null;
  orcamento_id: string | null;
  pagamento_id: string | null;
  execucao_id: string | null;
};

type LinhaItem = {
  id: string;
  ordem_servico_id: string;
  referencia_id: string;
  descricao: string;
  tipo: TipoItem;
  quantidade: number;
  valor_unitario: string | number;
};

export default class OrdemServicoRepositoryMySQL
  implements OrdemServicoRepository
{
  constructor(private readonly db: Knex) {}

  async salvar(ordemServico: OrdemServico): Promise<void> {
    // Uma unica transacao local: cabecalho, itens e historico de status.
    // E o "tudo ou nada" de CADA passo da Saga - a atomicidade existe dentro
    // do servico; entre servicos a consistencia e eventual.
    await this.db.transaction(async (trx) => {
      await trx("ordens_servico").insert(this.paraLinha(ordemServico));
      await this.gravarItens(trx, ordemServico);
      await this.gravarHistorico(trx, ordemServico);
    });
  }

  async atualizar(ordemServico: OrdemServico): Promise<void> {
    await this.db.transaction(async (trx) => {
      await trx("ordens_servico")
        .where({ id: ordemServico.id.getValue() })
        .update({
          status: ordemServico.status,
          valor_total: ordemServico.valorTotal,
          data_inicio_execucao: ordemServico.dataInicioExecucao ?? null,
          data_fim_execucao: ordemServico.dataFimExecucao ?? null,
          motivo_recusa: ordemServico.motivoRecusa ?? null,
          motivo_cancelamento: ordemServico.motivoCancelamento ?? null,
          saga_id: ordemServico.sagaId ?? null,
          orcamento_id: ordemServico.orcamentoId ?? null,
          pagamento_id: ordemServico.pagamentoId ?? null,
          execucao_id: ordemServico.execucaoId ?? null,
          updated_at: new Date(),
        });

      await this.gravarItens(trx, ordemServico);
      await this.gravarHistorico(trx, ordemServico);
    });
  }

  private paraLinha(ordemServico: OrdemServico) {
    return {
      id: ordemServico.id.getValue(),
      cliente_id: ordemServico.clienteId,
      veiculo_id: ordemServico.veiculoId,
      status: ordemServico.status,
      valor_total: ordemServico.valorTotal,
      data_criacao: ordemServico.dataCriacao,
      data_inicio_execucao: ordemServico.dataInicioExecucao ?? null,
      data_fim_execucao: ordemServico.dataFimExecucao ?? null,
      motivo_recusa: ordemServico.motivoRecusa ?? null,
      motivo_cancelamento: ordemServico.motivoCancelamento ?? null,
      saga_id: ordemServico.sagaId ?? null,
      orcamento_id: ordemServico.orcamentoId ?? null,
      pagamento_id: ordemServico.pagamentoId ?? null,
      execucao_id: ordemServico.execucaoId ?? null,
    };
  }

  private async gravarItens(trx: Knex.Transaction, ordemServico: OrdemServico) {
    if (ordemServico.itens.length === 0) return;

    await trx("ordem_servico_itens")
      .where({ ordem_servico_id: ordemServico.id.getValue() })
      .del();

    await trx("ordem_servico_itens").insert(
      ordemServico.itens.map((item) => ({
        id: item.id.getValue(),
        ordem_servico_id: ordemServico.id.getValue(),
        referencia_id: item.referenciaId,
        descricao: item.descricao,
        tipo: item.tipo,
        quantidade: item.quantidade,
        valor_unitario: item.valorUnitario,
      })),
    );
  }

  // Grava as transicoes pendentes e calcula quanto tempo a OS passou no status
  // anterior - metrica de negocio consumida pelo dashboard de tempo medio.
  private async gravarHistorico(
    trx: Knex.Transaction,
    ordemServico: OrdemServico,
  ) {
    const pendentes = ordemServico.consumirTransicoesPendentes();
    if (pendentes.length === 0) return;

    const ultima = await trx("ordem_servico_historico_status")
      .where({ ordem_servico_id: ordemServico.id.getValue() })
      .orderBy("id", "desc")
      .first<{ data: Date } | undefined>();

    let anterior = ultima?.data ? new Date(ultima.data) : null;

    const linhas = pendentes.map((transicao) => {
      const duracao =
        transicao.statusAnterior && anterior
          ? transicao.data.getTime() - anterior.getTime()
          : null;
      anterior = transicao.data;

      return {
        ordem_servico_id: ordemServico.id.getValue(),
        status_anterior: transicao.statusAnterior,
        status_novo: transicao.statusNovo,
        motivo: transicao.motivo ?? null,
        data: transicao.data,
        duracao_status_anterior_ms: duracao,
      };
    });

    await trx("ordem_servico_historico_status").insert(linhas);
    ordemServico.transicoesRegistradas = pendentes;
  }

  async obter(id: string): Promise<OrdemServico | null> {
    const linha = await this.db("ordens_servico")
      .where({ id })
      .first<LinhaOS | undefined>();
    if (!linha) return null;

    const itens = await this.db("ordem_servico_itens")
      .where({ ordem_servico_id: id })
      .select<LinhaItem[]>("*");

    return this.hidratar(linha, itens);
  }

  async listar(filtro: FiltroOrdemServico = {}): Promise<OrdemServico[]> {
    const consulta = this.db("ordens_servico").select<LinhaOS[]>("*");
    if (filtro.status) consulta.where({ status: filtro.status });
    if (filtro.clienteId) consulta.where({ cliente_id: filtro.clienteId });

    const linhas = await consulta.orderBy("data_criacao", "desc");
    if (linhas.length === 0) return [];

    const itens = await this.db("ordem_servico_itens")
      .whereIn(
        "ordem_servico_id",
        linhas.map((linha) => linha.id),
      )
      .select<LinhaItem[]>("*");

    return linhas.map((linha) =>
      this.hidratar(
        linha,
        itens.filter((item) => item.ordem_servico_id === linha.id),
      ),
    );
  }

  private hidratar(linha: LinhaOS, itens: LinhaItem[]): OrdemServico {
    const ordemServico = new OrdemServico(
      new ID(linha.id),
      linha.cliente_id,
      linha.veiculo_id,
    );

    ordemServico.definirItens(
      itens.map(
        (item) =>
          new ItemOrdemServico({
            id: new ID(item.id),
            referenciaId: item.referencia_id,
            descricao: item.descricao,
            tipo: item.tipo,
            quantidade: Number(item.quantidade),
            valorUnitario: Number(item.valor_unitario),
          }),
      ),
    );

    // hidratarStatus limpa as transicoes geradas pelo construtor: reidratar
    // uma entidade nao e uma mudanca de estado de negocio.
    ordemServico.hidratarStatus(linha.status);
    ordemServico.valorTotal = Number(linha.valor_total);
    ordemServico.dataCriacao = new Date(linha.data_criacao);
    ordemServico.dataInicioExecucao = linha.data_inicio_execucao
      ? new Date(linha.data_inicio_execucao)
      : undefined;
    ordemServico.dataFimExecucao = linha.data_fim_execucao
      ? new Date(linha.data_fim_execucao)
      : undefined;
    ordemServico.motivoRecusa = linha.motivo_recusa ?? undefined;
    ordemServico.motivoCancelamento = linha.motivo_cancelamento ?? undefined;
    ordemServico.sagaId = linha.saga_id ?? undefined;
    ordemServico.orcamentoId = linha.orcamento_id ?? undefined;
    ordemServico.pagamentoId = linha.pagamento_id ?? undefined;
    ordemServico.execucaoId = linha.execucao_id ?? undefined;

    return ordemServico;
  }

  async tempoMedioPorStatus(): Promise<TempoMedioPorStatus[]> {
    const linhas = await this.db("ordem_servico_historico_status")
      .whereNotNull("status_anterior")
      .whereNotNull("duracao_status_anterior_ms")
      .groupBy("status_anterior")
      .select<Array<{ status: string; ordens: number; media: string | number }>>(
        this.db.ref("status_anterior").as("status"),
        this.db.raw("COUNT(DISTINCT ordem_servico_id) as ordens"),
        this.db.raw("AVG(duracao_status_anterior_ms) as media"),
      );

    return linhas.map((linha) => ({
      status: linha.status,
      ordens: Number(linha.ordens),
      tempoMedioMs: Math.round(Number(linha.media)),
    }));
  }
}
