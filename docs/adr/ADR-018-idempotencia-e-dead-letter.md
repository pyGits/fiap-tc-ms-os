# ADR-018 — Idempotência durável e dead letter nos consumidores

- **Status:** Aceito
- **Data:** 2026-11-15
- **Relacionados:** ADR-015, ADR-016

## Contexto

O RabbitMQ garante entrega **ao menos uma vez**: uma mensagem confirmada com
atraso, um pod reiniciado no meio do processamento ou uma retentativa após falha
transitória podem fazer o mesmo comando chegar duas vezes. Nos passos desta Saga
isso tem consequência concreta:

- `REGISTRAR_PAGAMENTO` duplicado **cobraria o cliente duas vezes**;
- `ESTORNAR_PAGAMENTO` duplicado **devolveria dinheiro em dobro**;
- `ENFILEIRAR_EXECUCAO` duplicado **ocuparia duas vagas da oficina**.

Com duas ou mais réplicas do pod, uma verificação em memória não resolve: as
duas réplicas podem receber a mesma reentrega simultaneamente.

## Decisão

**Desduplicação durável, com índice único no banco de cada participante.**

- Toda mensagem carrega um envelope com `mensagemId` (além de `sagaId`,
  `correlationId`, `ordemServicoId`, `tipo`, `origem`, `dataEnvio`, `tentativa`).
- Antes de executar, o consumidor verifica a coleção/tabela
  `mensagens_processadas`; depois de executar, registra o `mensagemId`.
- O índice em `mensagemId` é **único**: se duas réplicas processarem a mesma
  reentrega ao mesmo tempo, apenas uma consegue inserir — a outra recebe o erro
  de chave duplicada (código 11000 no MongoDB) e para. O adaptador trata esse
  erro como **sucesso**, porque é exatamente o resultado desejado.
- O registro tem **TTL de 7 dias**: controle de duplicidade não precisa ser
  eterno.
- Além disso, cada caso de uso é idempotente por `sagaId`: reenviar
  `GERAR_ORCAMENTO` para uma Saga que já tem orçamento responde
  `ORCAMENTO_GERADO` com o orçamento existente, sem criar um segundo.
- Na integração externa, a idempotência é propagada: o header
  `X-Idempotency-Key` do Mercado Pago leva o id do pagamento (`refund-<id>` no
  estorno).

**Retentativa e dead letter.** Falha transitória é reenfileirada com
`tentativa` incrementada, até `SAGA_MAX_TENTATIVAS` (padrão 3). Esgotadas as
tentativas, a mensagem é publicada na fila `oficina.dead-letter`. Payload
inválido é rejeitado **sem reenfileirar** (`nack` com `requeue: false`) — repetir
uma mensagem malformada só travaria a fila. Comando sem manipulador registrado é
**confirmado**, não rejeitado: travar a fila por uma mensagem que não é deste
serviço seria pior que ignorá-la.

## Consequências

- **Positivas:** a garantia de "ao menos uma vez" do broker é convertida em
  efeito "exatamente uma vez" no negócio; a proteção vale entre réplicas, não
  apenas dentro de um processo; nenhuma mensagem se perde silenciosamente — ou é
  processada, ou está na *dead letter* para inspeção.
- **Negativas:** uma consulta e uma escrita a mais por mensagem; a coleção de
  controle cresce com o volume (mitigado pelo TTL); mensagens na *dead letter*
  exigem processo operacional de inspeção — sem alguém olhando, ficam lá.
- A verificação do erro de duplicidade é feita pelo **código** (11000) e não por
  `instanceof`: o driver do MongoDB embrulha o erro de formas diferentes
  conforme a operação (bulk, *retryable write*), e o código é estável em todas
  elas.
