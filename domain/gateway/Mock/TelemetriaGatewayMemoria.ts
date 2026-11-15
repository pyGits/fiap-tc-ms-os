import OrdemServico from "../../entity/OrdemServico";
import TelemetriaGateway, { ResultadoPassoSaga } from "../TelemetriaGateway";

// Duble de telemetria: acumula os eventos que seriam enviados ao New Relic.
export default class TelemetriaGatewayMemoria implements TelemetriaGateway {
  readonly transicoes: string[] = [];
  readonly passos: Array<{ passo: string; resultado: ResultadoPassoSaga }> = [];
  readonly compensacoes: string[] = [];
  readonly sagasConcluidas: string[] = [];
  readonly sagasCompensadas: string[] = [];
  readonly falhasIntegracao: string[] = [];

  registrarTransicoesStatus(ordemServico: OrdemServico): void {
    ordemServico.transicoesRegistradas.forEach((transicao) =>
      this.transicoes.push(transicao.statusNovo),
    );
  }

  registrarPassoSaga(dados: {
    sagaId: string;
    ordemServicoId: string;
    passo: string;
    resultado: ResultadoPassoSaga;
    erro?: string;
  }): void {
    this.passos.push({ passo: dados.passo, resultado: dados.resultado });
  }

  registrarCompensacao(dados: { passo: string }): void {
    this.compensacoes.push(dados.passo);
  }

  registrarSagaConcluida(dados: { sagaId: string }): void {
    this.sagasConcluidas.push(dados.sagaId);
  }

  registrarSagaCompensada(dados: { sagaId: string }): void {
    this.sagasCompensadas.push(dados.sagaId);
  }

  registrarFalhaIntegracao(dados: { integracao: string }): void {
    this.falhasIntegracao.push(dados.integracao);
  }

  limpar() {
    this.transicoes.length = 0;
    this.passos.length = 0;
    this.compensacoes.length = 0;
    this.sagasConcluidas.length = 0;
    this.sagasCompensadas.length = 0;
    this.falhasIntegracao.length = 0;
  }
}
