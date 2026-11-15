import { PassoSaga, StatusPasso } from "./SagaOrdemServico";

// Nomes dos passos da Saga de abertura/execucao de uma Ordem de Servico.
export const PASSOS = {
  CRIAR_OS: "criar-ordem-servico",
  GERAR_ORCAMENTO: "gerar-orcamento",
  AGUARDAR_APROVACAO: "aguardar-aprovacao",
  REGISTRAR_PAGAMENTO: "registrar-pagamento",
  ENFILEIRAR_EXECUCAO: "enfileirar-execucao",
} as const;

export const PARTICIPANTES = {
  OS: "fiap-tc-ms-os",
  BILLING: "fiap-tc-ms-billing",
  EXECUCAO: "fiap-tc-ms-execucao",
} as const;

// Definicao declarativa da Saga.
//
// Tudo o que o orquestrador precisa saber - a ordem dos passos, quem executa
// cada um e qual a transacao compensatoria correspondente - esta neste unico
// arquivo. E a vantagem central da orquestracao citada na Aula 2 do SAGA
// Pattern: "existe um unico lugar no codigo que define a Saga".
//
//   # | Passo                 | Participante | Comando              | Compensacao
//   --|-----------------------|--------------|----------------------|---------------------
//   1 | criar-ordem-servico   | OS Service   | transacao local      | cancelar a OS
//   2 | gerar-orcamento       | Billing      | GERAR_ORCAMENTO      | CANCELAR_ORCAMENTO
//   3 | aguardar-aprovacao    | Cliente      | decisao humana       | (sem efeito externo)
//   4 | registrar-pagamento   | Billing      | REGISTRAR_PAGAMENTO  | ESTORNAR_PAGAMENTO
//   5 | enfileirar-execucao   | Execucao     | ENFILEIRAR_EXECUCAO  | CANCELAR_EXECUCAO
//
// A ordem dos passos nao e acidental: cobrar ANTES de enfileirar a execucao
// aplica a contramedida "Pessimistic View" da Aula 3 do SAGA Pattern - os
// passos sao reordenados para que o efeito colateral mais dificil de desfazer
// (a oficina comecar a desmontar o carro) so aconteca depois de confirmado o
// que e facil de estornar (o pagamento).
export function criarPassosSagaOrdemServico(): PassoSaga[] {
  return [
    {
      nome: PASSOS.CRIAR_OS,
      ordem: 1,
      participante: PARTICIPANTES.OS,
      comando: "CRIAR_ORDEM_SERVICO",
      compensacao: "CANCELAR_ORDEM_SERVICO",
      status: StatusPasso.PENDENTE,
    },
    {
      nome: PASSOS.GERAR_ORCAMENTO,
      ordem: 2,
      participante: PARTICIPANTES.BILLING,
      comando: "GERAR_ORCAMENTO",
      compensacao: "CANCELAR_ORCAMENTO",
      status: StatusPasso.PENDENTE,
    },
    {
      nome: PASSOS.AGUARDAR_APROVACAO,
      ordem: 3,
      participante: PARTICIPANTES.OS,
      comando: "AGUARDAR_APROVACAO",
      // Aguardar uma decisao nao produz efeito colateral em outro servico,
      // portanto nao ha o que compensar.
      compensacao: null,
      status: StatusPasso.PENDENTE,
    },
    {
      nome: PASSOS.REGISTRAR_PAGAMENTO,
      ordem: 4,
      participante: PARTICIPANTES.BILLING,
      comando: "REGISTRAR_PAGAMENTO",
      compensacao: "ESTORNAR_PAGAMENTO",
      status: StatusPasso.PENDENTE,
    },
    {
      nome: PASSOS.ENFILEIRAR_EXECUCAO,
      ordem: 5,
      participante: PARTICIPANTES.EXECUCAO,
      comando: "ENFILEIRAR_EXECUCAO",
      compensacao: "CANCELAR_EXECUCAO",
      status: StatusPasso.PENDENTE,
    },
  ];
}
