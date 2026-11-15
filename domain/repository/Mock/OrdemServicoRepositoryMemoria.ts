import OrdemServico, { StatusOrdemServico } from "../../entity/OrdemServico";
import OrdemServicoRepository, {
  FiltroOrdemServico,
  TempoMedioPorStatus,
} from "../OrdemServicoRepository";

// Adaptador em memoria usado nos testes unitarios e nos cenarios BDD.
// Troca-lo pelo adaptador MySQL nao exige mudanca alguma no dominio - e o
// beneficio concreto da arquitetura hexagonal.
export default class OrdemServicoRepositoryMemoria
  implements OrdemServicoRepository
{
  private readonly registros = new Map<string, OrdemServico>();
  private readonly historico: Array<{
    ordemServicoId: string;
    status: string;
    duracaoMs: number;
  }> = [];

  private readonly ultimaTransicao = new Map<string, Date>();

  async salvar(ordemServico: OrdemServico): Promise<void> {
    this.registrarTransicoes(ordemServico);
    this.registros.set(ordemServico.id.getValue(), ordemServico);
  }

  async atualizar(ordemServico: OrdemServico): Promise<void> {
    this.registrarTransicoes(ordemServico);
    this.registros.set(ordemServico.id.getValue(), ordemServico);
  }

  private registrarTransicoes(ordemServico: OrdemServico) {
    const pendentes = ordemServico.consumirTransicoesPendentes();
    const id = ordemServico.id.getValue();

    // A data da ultima transicao ja gravada fica guardada por OS - e o
    // equivalente, em memoria, da consulta que o adaptador MySQL faz na
    // tabela de historico para calcular a duracao do status anterior.
    let anterior: Date | null = this.ultimaTransicao.get(id) ?? null;
    for (const transicao of pendentes) {
      const duracao = anterior
        ? transicao.data.getTime() - anterior.getTime()
        : null;

      if (transicao.statusAnterior && duracao !== null) {
        this.historico.push({
          ordemServicoId: ordemServico.id.getValue(),
          status: transicao.statusAnterior,
          duracaoMs: duracao,
        });
      }

      anterior = transicao.data;
    }

    if (anterior) this.ultimaTransicao.set(id, anterior);
    ordemServico.transicoesRegistradas = pendentes;
  }

  async obter(id: string): Promise<OrdemServico | null> {
    return this.registros.get(id) ?? null;
  }

  async listar(filtro: FiltroOrdemServico = {}): Promise<OrdemServico[]> {
    return [...this.registros.values()].filter((ordemServico) => {
      if (filtro.status && ordemServico.status !== filtro.status) return false;
      if (filtro.clienteId && ordemServico.clienteId !== filtro.clienteId) {
        return false;
      }
      return true;
    });
  }

  async tempoMedioPorStatus(): Promise<TempoMedioPorStatus[]> {
    const agrupado = new Map<string, { total: number; ordens: Set<string> }>();

    for (const item of this.historico) {
      const atual = agrupado.get(item.status) ?? {
        total: 0,
        ordens: new Set<string>(),
      };
      atual.total += item.duracaoMs;
      atual.ordens.add(item.ordemServicoId);
      agrupado.set(item.status, atual);
    }

    return [...agrupado.entries()].map(([status, dados]) => ({
      status,
      ordens: dados.ordens.size,
      tempoMedioMs: Math.round(dados.total / dados.ordens.size),
    }));
  }

  // Utilitario de teste: pre-carrega uma OS em um status especifico.
  semear(ordemServico: OrdemServico, status?: StatusOrdemServico) {
    if (status) ordemServico.hidratarStatus(status);
    this.registros.set(ordemServico.id.getValue(), ordemServico);
  }

  limpar() {
    this.registros.clear();
    this.historico.length = 0;
    this.ultimaTransicao.clear();
  }
}
