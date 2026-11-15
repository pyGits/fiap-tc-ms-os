# ADR-015 — Saga orquestrada, com o orquestrador no OS Service

- **Status:** Aceito
- **Data:** 2026-11-15
- **Relacionados:** ADR-014, ADR-016, ADR-018

## Contexto

Com o monolito dividido (ADR-014), abrir uma ordem de serviço deixou de ser uma
transação de banco: o fluxo atravessa três serviços com bancos distintos e não
existe commit distribuído. O padrão exigido pela fase é **Saga**, e havia duas
formas de implementá-lo:

- **Coreografia:** cada serviço publica eventos e reage aos eventos dos outros;
  ninguém detém o fluxo.
- **Orquestração:** um componente central envia comandos, recebe respostas e
  decide o passo seguinte (ou a compensação).

O fluxo tem uma característica decisiva: o passo 3 é a **aprovação do orçamento
pelo cliente**, uma espera humana que pode durar dias e pode terminar em recusa.

## Decisão

**Saga orquestrada**, com o orquestrador (`domain/saga/SagaOrquestrador.ts`)
dentro do OS Service — o serviço dono do agregado raiz do fluxo.

- A definição da Saga (ordem dos passos, participante e compensação de cada um)
  está declarada em **um único arquivo**: `domain/saga/DefinicaoSaga.ts`.
- O estado de cada instância é **persistido** nas tabelas `saga_instancias` e
  `saga_passos` a cada transição.
- A compensação executa na **ordem inversa** dos passos concluídos.
- Os passos foram ordenados para cobrar (passo 4) **antes** de enfileirar a
  execução (passo 5): contramedida *Pessimistic View*, que coloca o efeito
  colateral difícil de desfazer (a oficina desmontar o carro) depois do que é
  fácil de estornar (o pagamento).
- Os status intermediários da OS (`AGUARDANDO_APROVACAO`,
  `AGUARDANDO_PAGAMENTO`) funcionam como *Semantic Lock*: sinalizam que o estado
  ainda não é definitivo.
- Toda compensação é **permissiva e idempotente**: cancelar o que não existe, ou
  o que já está cancelado, é sucesso.

## Consequências

- **Positivas:** "em que passo esta OS está parada" é uma consulta, não uma
  reconstrução a partir de eventos; a sequência de compensações fica auditável
  passo a passo; a espera humana do passo 3 é um estado explícito; mudar a ordem
  dos passos é editar um arquivo, não renegociar assinaturas de evento em três
  repositórios.
- **Negativas:** o orquestrador é um ponto de conhecimento central (sabe o
  fluxo inteiro) e um ponto de falha a mais; o OS Service acumula dois papéis no
  mesmo processo — API REST e orquestrador assíncrono.
- Mitigações: o estado é persistido a cada transição (um pod que morre no meio
  do fluxo não perde o progresso); os comandos são idempotentes (ADR-018); as
  filas são duráveis com *dead letter*. A separação dos dois papéis em
  Deployments distintos já é possível sem mudar o domínio — a única diferença
  seria qual adaptador de entrada é iniciado em `src/index.ts`.
- O trecho final do fluxo (`EXECUCAO_FINALIZADA`) é **coreografado** de
  propósito: anunciar um fato consumado, horas depois do fim da Saga, não
  precisa de orquestrador.
