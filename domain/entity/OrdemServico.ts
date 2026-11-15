import ErroDominio from "../ErroDominio";
import ID from "../vo/ID";
import ItemOrdemServico from "./ItemOrdemServico";

// Ciclo de vida da Ordem de Servico.
//
// Em relacao a Fase 3 foram acrescentados dois estados exigidos pelo fluxo
// distribuido da Fase 4:
//   AGUARDANDO_PAGAMENTO - o cliente aprovou o orcamento e a Saga esta cobrando
//                          o pagamento no Billing Service (Mercado Pago);
//   CANCELADA            - a Saga falhou em alguma etapa e foi compensada
//                          (rollback), devolvendo o sistema a um estado valido.
export enum StatusOrdemServico {
  RECEBIDA = "RECEBIDA",
  EM_DIAGNOSTICO = "EM_DIAGNOSTICO",
  AGUARDANDO_APROVACAO = "AGUARDANDO_APROVACAO",
  AGUARDANDO_PAGAMENTO = "AGUARDANDO_PAGAMENTO",
  EM_EXECUCAO = "EM_EXECUCAO",
  FINALIZADA = "FINALIZADA",
  ENTREGUE = "ENTREGUE",
  RECUSADA = "RECUSADA",
  CANCELADA = "CANCELADA",
}

export const StatusOrdemServicoLabel: Record<StatusOrdemServico, string> = {
  [StatusOrdemServico.RECEBIDA]: "Recebida",
  [StatusOrdemServico.EM_DIAGNOSTICO]: "Em Diagnostico",
  [StatusOrdemServico.AGUARDANDO_APROVACAO]: "Aguardando Aprovacao",
  [StatusOrdemServico.AGUARDANDO_PAGAMENTO]: "Aguardando Pagamento",
  [StatusOrdemServico.EM_EXECUCAO]: "Em Execucao",
  [StatusOrdemServico.FINALIZADA]: "Finalizada",
  [StatusOrdemServico.ENTREGUE]: "Entregue",
  [StatusOrdemServico.RECUSADA]: "Orcamento Recusado",
  [StatusOrdemServico.CANCELADA]: "Cancelada",
};

// Transicoes validas. Manter o mapa explicito torna a maquina de estados
// testavel e evita que a Saga leve a OS a um estado invalido.
const TRANSICOES_VALIDAS: Record<StatusOrdemServico, StatusOrdemServico[]> = {
  [StatusOrdemServico.RECEBIDA]: [
    StatusOrdemServico.EM_DIAGNOSTICO,
    StatusOrdemServico.AGUARDANDO_APROVACAO,
    StatusOrdemServico.CANCELADA,
  ],
  [StatusOrdemServico.EM_DIAGNOSTICO]: [
    StatusOrdemServico.AGUARDANDO_APROVACAO,
    StatusOrdemServico.CANCELADA,
  ],
  [StatusOrdemServico.AGUARDANDO_APROVACAO]: [
    StatusOrdemServico.AGUARDANDO_PAGAMENTO,
    StatusOrdemServico.RECUSADA,
    StatusOrdemServico.CANCELADA,
  ],
  [StatusOrdemServico.AGUARDANDO_PAGAMENTO]: [
    StatusOrdemServico.EM_EXECUCAO,
    StatusOrdemServico.CANCELADA,
  ],
  [StatusOrdemServico.EM_EXECUCAO]: [
    StatusOrdemServico.FINALIZADA,
    StatusOrdemServico.CANCELADA,
  ],
  [StatusOrdemServico.FINALIZADA]: [StatusOrdemServico.ENTREGUE],
  [StatusOrdemServico.ENTREGUE]: [],
  [StatusOrdemServico.RECUSADA]: [],
  [StatusOrdemServico.CANCELADA]: [],
};

export type TransicaoStatus = {
  statusAnterior: StatusOrdemServico | null;
  statusNovo: StatusOrdemServico;
  data: Date;
  motivo?: string;
  duracaoStatusAnteriorMs?: number | null;
};

export default class OrdemServico {
  readonly id: ID;
  readonly clienteId: string;
  readonly veiculoId: string;

  itens: ItemOrdemServico[] = [];
  status: StatusOrdemServico;
  valorTotal = 0;

  dataCriacao: Date;
  dataInicioExecucao?: Date;
  dataFimExecucao?: Date;
  motivoRecusa?: string;
  motivoCancelamento?: string;

  // Identificador da Saga que conduz esta OS. Preenchido quando o orquestrador
  // inicia a transacao distribuida e usado para correlacionar logs e traces.
  sagaId?: string;

  // Referencias devolvidas pelos participantes da Saga. Guardadas aqui apenas
  // como identificadores - os dados completos vivem no banco de cada servico,
  // pois nenhum servico acessa o banco do outro.
  orcamentoId?: string;
  pagamentoId?: string;
  execucaoId?: string;

  transicoesPendentes: TransicaoStatus[] = [];
  transicoesRegistradas: TransicaoStatus[] = [];

  constructor(id: ID | undefined, clienteId: string, veiculoId: string) {
    if (!clienteId) {
      throw new ErroDominio("os.cliente.obrigatorio", "Cliente e obrigatorio.");
    }
    if (!veiculoId) {
      throw new ErroDominio("os.veiculo.obrigatorio", "Veiculo e obrigatorio.");
    }

    this.id = id ?? new ID();
    this.clienteId = clienteId;
    this.veiculoId = veiculoId;
    this.status = StatusOrdemServico.RECEBIDA;
    this.dataCriacao = new Date();
    this.registrarTransicao(null, StatusOrdemServico.RECEBIDA);
  }

  private registrarTransicao(
    statusAnterior: StatusOrdemServico | null,
    statusNovo: StatusOrdemServico,
    motivo?: string,
  ) {
    this.transicoesPendentes.push({
      statusAnterior,
      statusNovo,
      data: new Date(),
      motivo,
    });
  }

  private mudarStatus(novoStatus: StatusOrdemServico, motivo?: string) {
    const permitidos = TRANSICOES_VALIDAS[this.status];
    if (!permitidos.includes(novoStatus)) {
      throw new ErroDominio(
        "os.transicao.invalida",
        `Transicao invalida: ${this.status} -> ${novoStatus}.`,
        409,
      );
    }

    const anterior = this.status;
    this.status = novoStatus;
    this.registrarTransicao(anterior, novoStatus, motivo);
  }

  // Usado pelo repositorio ao reidratar a entidade: o status ja persistido nao
  // gera nova transicao.
  hidratarStatus(status: StatusOrdemServico) {
    this.status = status;
    this.transicoesPendentes = [];
  }

  consumirTransicoesPendentes(): TransicaoStatus[] {
    const pendentes = this.transicoesPendentes;
    this.transicoesPendentes = [];
    return pendentes;
  }

  limparTransicoesRegistradas() {
    this.transicoesRegistradas = [];
  }

  adicionarItem(item: ItemOrdemServico) {
    this.itens.push(item);
    this.calcularTotal();
  }

  definirItens(itens: ItemOrdemServico[]) {
    this.itens = itens;
    this.calcularTotal();
  }

  calcularTotal(): number {
    this.valorTotal = Number(
      this.itens.reduce((acumulado, item) => acumulado + item.getTotal(), 0).toFixed(2),
    );
    return this.valorTotal;
  }

  iniciarDiagnostico() {
    this.mudarStatus(StatusOrdemServico.EM_DIAGNOSTICO);
  }

  // Passo 2 da Saga concluido: o Billing devolveu o orcamento gerado.
  registrarOrcamentoGerado(orcamentoId: string, valorTotal: number) {
    this.orcamentoId = orcamentoId;
    this.valorTotal = valorTotal;
    this.mudarStatus(StatusOrdemServico.AGUARDANDO_APROVACAO);
  }

  // Passo 3: decisao do cliente. Aprovar leva a OS para a cobranca.
  aprovarOrcamento() {
    this.mudarStatus(StatusOrdemServico.AGUARDANDO_PAGAMENTO);
  }

  recusarOrcamento(motivo?: string) {
    this.mudarStatus(StatusOrdemServico.RECUSADA, motivo);
    this.motivoRecusa = motivo;
  }

  // Passo 5 concluido: execucao enfileirada pelo servico de Execucao.
  registrarExecucaoIniciada(execucaoId: string) {
    this.execucaoId = execucaoId;
    this.mudarStatus(StatusOrdemServico.EM_EXECUCAO);
    this.dataInicioExecucao = new Date();
  }

  registrarPagamento(pagamentoId: string) {
    this.pagamentoId = pagamentoId;
  }

  finalizar() {
    this.mudarStatus(StatusOrdemServico.FINALIZADA);
    this.dataFimExecucao = new Date();
  }

  entregar() {
    this.mudarStatus(StatusOrdemServico.ENTREGUE);
  }

  // Resultado do rollback da Saga: as compensacoes dos participantes ja foram
  // executadas e a OS volta a um estado final valido (ACD, nao ACID).
  cancelar(motivo: string) {
    this.mudarStatus(StatusOrdemServico.CANCELADA, motivo);
    this.motivoCancelamento = motivo;
  }

  podeTransitarPara(status: StatusOrdemServico): boolean {
    return TRANSICOES_VALIDAS[this.status].includes(status);
  }

  estaEmEstadoFinal(): boolean {
    return TRANSICOES_VALIDAS[this.status].length === 0;
  }
}
