import OrdemServico, { StatusOrdemServico } from "../entity/OrdemServico";

export type FiltroOrdemServico = {
  status?: StatusOrdemServico;
  clienteId?: string;
};

export type TempoMedioPorStatus = {
  status: string;
  ordens: number;
  tempoMedioMs: number;
};

// Porta de persistencia da OS. O dominio nao conhece Knex nem MySQL.
export default interface OrdemServicoRepository {
  salvar(ordemServico: OrdemServico): Promise<void>;
  atualizar(ordemServico: OrdemServico): Promise<void>;
  obter(id: string): Promise<OrdemServico | null>;
  listar(filtro?: FiltroOrdemServico): Promise<OrdemServico[]>;
  tempoMedioPorStatus(): Promise<TempoMedioPorStatus[]>;
}
