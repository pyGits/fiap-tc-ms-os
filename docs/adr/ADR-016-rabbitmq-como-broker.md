# ADR-016 — RabbitMQ como broker de mensageria

- **Status:** Aceito
- **Data:** 2026-11-15
- **Relacionados:** ADR-015, ADR-018

## Contexto

A Saga orquestrada (ADR-015) precisa de um canal assíncrono confiável entre o
orquestrador e os participantes. Os requisitos concretos:

- **Comandos endereçados** a um participante específico (não *broadcast*);
- **Respostas** voltando para uma fila única do orquestrador;
- **Eventos** de negócio para quem quiser assinar;
- Entrega durável, retentativa controlada e desvio de mensagens irrecuperáveis;
- Possibilidade de rodar o ambiente inteiro na máquina do desenvolvedor.

As alternativas consideradas foram Amazon SQS + SNS, Apache Kafka e RabbitMQ.

## Decisão

**RabbitMQ**, com uma exchange `direct` durável (`oficina.saga`) e cinco filas:

| Fila | Routing key | Consumidor |
| --- | --- | --- |
| `saga.billing.comandos` | `billing.comandos` | Billing |
| `saga.execucao.comandos` | `execucao.comandos` | Execução |
| `saga.os.reply` | `os.reply` | OS Service (orquestrador) |
| `oficina.eventos` | `eventos` | assinantes de eventos de negócio |
| `oficina.dead-letter` | `dead-letter` | inspeção manual |

A topologia é declarada **em código**, de forma idempotente, na conexão
(`src/messaging/RabbitMQConnection.ts`): local, homologação e produção sobem
idênticos, sem passo manual de criação de filas.

Toda fila de trabalho aponta para a *dead letter* via
`deadLetterExchange`/`deadLetterRoutingKey`.

Em produção a recomendação é um broker **gerenciado** (Amazon MQ for RabbitMQ);
o manifesto `k8s/shared/rabbitmq.yaml` sobe um broker no cluster para
homologação e para a demonstração, com volume persistente — fila durável só
sobrevive ao restart do pod se o diretório de dados persistir.

## Consequências

- **Positivas:** o roteamento `direct` expressa exatamente o modelo
  comando/resposta da Saga, sem *fan-out* indesejado; *dead letter* e
  `prefetch` nativos; painel de administração que mostra as filas durante a
  demonstração; sobe em um contêiner no `docker compose`, o que mantém o
  ambiente local fiel ao de produção.
- **Negativas:** é um componente a operar (o SQS não exigiria isso); o RabbitMQ
  não retém histórico de mensagens como o Kafka — para auditoria, a fonte da
  verdade é o estado persistido da Saga, não a fila.
- Kafka foi descartado por excesso: retenção de log, *partitioning* e
  reprocessamento histórico não são requisitos deste fluxo, e o custo
  operacional não se justificaria. SQS+SNS foi descartado por amarrar o ambiente
  local à nuvem (ou a um emulador) e por não ter o roteamento por chave que o
  modelo comando/resposta usa.
- A URL do broker é lida de `RABBITMQ_URL` (Secret no Kubernetes): trocar por
  Amazon MQ é mudar uma variável de ambiente, sem tocar o código.
