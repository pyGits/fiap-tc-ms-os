# language: pt

# BDD com Gherkin, conforme a Aula 4 de "Estrutura de Microsservicos - Parte II".
#
# O texto descreve o COMPORTAMENTO esperado em linguagem de negocio: qualquer
# pessoa da oficina consegue ler e validar os cenarios, inclusive os de falha.
Funcionalidade: Ciclo de vida da ordem de servico com Saga orquestrada
  Como oficina mecanica
  Quero abrir ordens de servico que coordenam orcamento, pagamento e execucao
  Para que o cliente nunca seja cobrado por um servico que nao sera executado

  Contexto:
    Dado um cliente cadastrado com o documento "52998224725"
    E um veiculo "ABC1D23" vinculado a esse cliente
    E o catalogo contendo o servico "srv-revisao" no valor de 450.00

  @caminho-feliz @fluxo-completo
  Cenario: Fluxo completo da ordem de servico, do recebimento a entrega
    Quando o cliente abre uma ordem de servico com 1 unidade de "srv-revisao"
    Entao a ordem de servico deve estar com o status "RECEBIDA"
    E o comando "GERAR_ORCAMENTO" deve ter sido enviado ao servico de Billing

    Quando o servico de Billing responde que o orcamento foi gerado no valor de 450.00
    Entao a ordem de servico deve estar com o status "AGUARDANDO_APROVACAO"
    E a Saga deve estar no estado "AGUARDANDO_APROVACAO"

    Quando o cliente aprova o orcamento
    Entao o comando "REGISTRAR_PAGAMENTO" deve ter sido enviado ao servico de Billing
    E a ordem de servico deve estar com o status "AGUARDANDO_PAGAMENTO"

    Quando o servico de Billing confirma o pagamento
    Entao o comando "ENFILEIRAR_EXECUCAO" deve ter sido enviado ao servico de Execucao

    Quando o servico de Execucao confirma o enfileiramento
    Entao a Saga deve estar no estado "CONCLUIDA"
    E a ordem de servico deve estar com o status "EM_EXECUCAO"

    Quando o mecanico finaliza a execucao
    E o veiculo e entregue ao cliente
    Entao a ordem de servico deve estar com o status "ENTREGUE"
    E nenhuma transacao compensatoria deve ter sido executada

  @rollback @pagamento
  Cenario: Falha no pagamento desfaz o orcamento gerado
    Quando o cliente abre uma ordem de servico com 1 unidade de "srv-revisao"
    E o servico de Billing responde que o orcamento foi gerado no valor de 450.00
    E o cliente aprova o orcamento
    E o servico de Billing informa que o pagamento falhou por "Cartao recusado pelo emissor"
    Entao a Saga deve estar no estado "COMPENSADA"
    E as transacoes compensatorias executadas devem ser, nesta ordem:
      | CANCELAR_ORCAMENTO |
    E a ordem de servico deve estar com o status "CANCELADA"
    E o comando "ESTORNAR_PAGAMENTO" nao deve ter sido enviado

  @rollback @execucao @ordem-inversa
  Cenario: Falha na execucao desfaz pagamento e orcamento em ordem inversa
    Quando o cliente abre uma ordem de servico com 1 unidade de "srv-revisao"
    E o servico de Billing responde que o orcamento foi gerado no valor de 450.00
    E o cliente aprova o orcamento
    E o servico de Billing confirma o pagamento
    E o servico de Execucao informa que o enfileiramento falhou por "Fila da oficina cheia"
    Entao a Saga deve estar no estado "COMPENSADA"
    E as transacoes compensatorias executadas devem ser, nesta ordem:
      | ESTORNAR_PAGAMENTO |
      | CANCELAR_ORCAMENTO |
    E a ordem de servico deve estar com o status "CANCELADA"
    E o passo "registrar-pagamento" da Saga deve estar "COMPENSADO"
    E o passo "gerar-orcamento" da Saga deve estar "COMPENSADO"

  @recusa
  Cenario: Cliente recusa o orcamento
    Quando o cliente abre uma ordem de servico com 1 unidade de "srv-revisao"
    E o servico de Billing responde que o orcamento foi gerado no valor de 450.00
    E o cliente recusa o orcamento informando "Vou pesquisar outros precos"
    Entao a ordem de servico deve estar com o status "RECUSADA"
    E as transacoes compensatorias executadas devem ser, nesta ordem:
      | CANCELAR_ORCAMENTO |
    E nenhuma cobranca deve ter sido solicitada ao cliente

  @validacao
  Cenario: Ordem de servico recusada antes de iniciar a Saga
    Quando o cliente tenta abrir uma ordem de servico com 999 unidades de "pec-pastilha-freio"
    Entao a abertura deve falhar com a mensagem contendo "Estoque insuficiente"
    E nenhum comando deve ter sido enviado aos participantes da Saga
