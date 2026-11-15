import ErroDominio from "../ErroDominio";
import ID from "../vo/ID";

// Estado da Saga (o "saga log" do orquestrador).
//
// Por que persistir o estado? Porque a Saga nao e uma transacao ACID: ela e uma
// sequencia de transacoes locais coordenadas por mensagens. Se o orquestrador
// reiniciar no meio do fluxo, e este registro que permite saber em que passo a
// transacao parou e o que ja precisa ser compensado.
export enum EstadoSaga {
  INICIADA = "INICIADA",
  EM_ANDAMENTO = "EM_ANDAMENTO",
  // A Saga pausa aqui ate o cliente aprovar ou recusar o orcamento. Um passo
  // que depende de decisao humana nao pode bloquear os participantes.
  AGUARDANDO_APROVACAO = "AGUARDANDO_APROVACAO",
  CONCLUIDA = "CONCLUIDA",
  COMPENSANDO = "COMPENSANDO",
  COMPENSADA = "COMPENSADA",
  FALHA = "FALHA",
}

export enum StatusPasso {
  PENDENTE = "PENDENTE",
  EXECUTANDO = "EXECUTANDO",
  CONCLUIDO = "CONCLUIDO",
  FALHOU = "FALHOU",
  COMPENSANDO = "COMPENSANDO",
  COMPENSADO = "COMPENSADO",
  // Passo que nao chegou a ser executado quando a falha ocorreu antes dele.
  NAO_EXECUTADO = "NAO_EXECUTADO",
}

export type PassoSaga = {
  nome: string;
  ordem: number;
  participante: string;
  comando: string;
  // Comando de compensacao. Passos sem efeito colateral externo nao tem
  // compensacao (ex.: "aguardar aprovacao").
  compensacao: string | null;
  status: StatusPasso;
  iniciadoEm?: Date;
  concluidoEm?: Date;
  erro?: string;
  resposta?: Record<string, unknown>;
};

export default class SagaOrdemServico {
  readonly id: ID;
  readonly ordemServicoId: string;
  readonly correlationId: string;

  estado: EstadoSaga;
  passos: PassoSaga[];
  passoAtual: number;
  erro?: string;
  criadaEm: Date;
  atualizadaEm: Date;

  // Dados de negocio que acompanham a Saga entre os passos (valor do orcamento,
  // identificadores devolvidos pelos participantes, etc.).
  dados: Record<string, unknown>;

  constructor(dados: {
    id?: ID;
    ordemServicoId: string;
    correlationId: string;
    passos: PassoSaga[];
    estado?: EstadoSaga;
    passoAtual?: number;
    dadosNegocio?: Record<string, unknown>;
    criadaEm?: Date;
    atualizadaEm?: Date;
    erro?: string;
  }) {
    if (!dados.passos || dados.passos.length === 0) {
      throw new ErroDominio("saga.sem.passos", "Saga precisa de ao menos um passo.");
    }

    this.id = dados.id ?? new ID();
    this.ordemServicoId = dados.ordemServicoId;
    this.correlationId = dados.correlationId;
    this.passos = [...dados.passos].sort((a, b) => a.ordem - b.ordem);
    this.estado = dados.estado ?? EstadoSaga.INICIADA;
    this.passoAtual = dados.passoAtual ?? 0;
    this.dados = dados.dadosNegocio ?? {};
    this.criadaEm = dados.criadaEm ?? new Date();
    this.atualizadaEm = dados.atualizadaEm ?? new Date();
    this.erro = dados.erro;
  }

  private tocar() {
    this.atualizadaEm = new Date();
  }

  passoCorrente(): PassoSaga | undefined {
    return this.passos[this.passoAtual];
  }

  buscarPasso(nome: string): PassoSaga | undefined {
    return this.passos.find((passo) => passo.nome === nome);
  }

  // Marca o passo corrente como enviado ao participante.
  iniciarPassoCorrente(): PassoSaga {
    const passo = this.passoCorrente();
    if (!passo) {
      throw new ErroDominio("saga.passo.inexistente", "Nao ha passo corrente na Saga.");
    }

    passo.status = StatusPasso.EXECUTANDO;
    passo.iniciadoEm = new Date();
    this.estado = EstadoSaga.EM_ANDAMENTO;
    this.tocar();
    return passo;
  }

  // O participante respondeu com sucesso: avanca para o proximo passo.
  concluirPassoCorrente(resposta?: Record<string, unknown>): void {
    const passo = this.passoCorrente();
    if (!passo) {
      throw new ErroDominio("saga.passo.inexistente", "Nao ha passo corrente na Saga.");
    }

    passo.status = StatusPasso.CONCLUIDO;
    passo.concluidoEm = new Date();
    passo.resposta = resposta;
    this.passoAtual += 1;

    if (this.passoAtual >= this.passos.length) {
      this.estado = EstadoSaga.CONCLUIDA;
      this.passos
        .filter((item) => item.status === StatusPasso.PENDENTE)
        .forEach((item) => (item.status = StatusPasso.NAO_EXECUTADO));
    }

    this.tocar();
  }

  // Pausa a Saga aguardando a decisao do cliente sobre o orcamento.
  aguardarAprovacao(): void {
    this.estado = EstadoSaga.AGUARDANDO_APROVACAO;
    this.tocar();
  }

  retomar(): void {
    this.estado = EstadoSaga.EM_ANDAMENTO;
    this.tocar();
  }

  // Falha em um passo: a Saga entra em compensacao (rollback).
  registrarFalha(motivo: string): void {
    const passo = this.passoCorrente();
    if (passo) {
      passo.status = StatusPasso.FALHOU;
      passo.erro = motivo;
      passo.concluidoEm = new Date();
    }

    this.erro = motivo;
    this.estado = EstadoSaga.COMPENSANDO;
    this.passos
      .filter((item) => item.status === StatusPasso.PENDENTE)
      .forEach((item) => (item.status = StatusPasso.NAO_EXECUTADO));
    this.tocar();
  }

  // Passos a compensar, em ordem INVERSA a da execucao (desfaz do mais recente
  // para o mais antigo) e apenas os que tem compensacao definida.
  passosParaCompensar(): PassoSaga[] {
    return this.passos
      .filter(
        (passo) =>
          passo.status === StatusPasso.CONCLUIDO && passo.compensacao !== null,
      )
      .sort((a, b) => b.ordem - a.ordem);
  }

  marcarCompensando(nome: string): void {
    const passo = this.buscarPasso(nome);
    if (passo) {
      passo.status = StatusPasso.COMPENSANDO;
      this.tocar();
    }
  }

  marcarCompensado(nome: string): void {
    const passo = this.buscarPasso(nome);
    if (passo) {
      passo.status = StatusPasso.COMPENSADO;
      this.tocar();
    }

    // Quando nao resta nenhuma compensacao pendente, a Saga esta compensada.
    const pendentes = this.passos.filter(
      (item) =>
        item.compensacao !== null &&
        (item.status === StatusPasso.CONCLUIDO ||
          item.status === StatusPasso.COMPENSANDO),
    );

    if (pendentes.length === 0) {
      this.estado = EstadoSaga.COMPENSADA;
      this.tocar();
    }
  }

  registrarDados(novos: Record<string, unknown>): void {
    this.dados = { ...this.dados, ...novos };
    this.tocar();
  }

  estaFinalizada(): boolean {
    return (
      this.estado === EstadoSaga.CONCLUIDA ||
      this.estado === EstadoSaga.COMPENSADA ||
      this.estado === EstadoSaga.FALHA
    );
  }
}
