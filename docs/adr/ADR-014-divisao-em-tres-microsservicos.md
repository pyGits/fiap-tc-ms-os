# ADR-014 — Divisão do monolito em três microsserviços por capacidade de negócio

- **Status:** Aceito
- **Data:** 2026-11-15
- **Relacionados:** ADR-015, ADR-017, RFC-001 (Fase 3)

## Contexto

A Fase 3 entregou um monolito modular (`fiap-tc-app`) em Clean Architecture, com
Ordem de Serviço, orçamento, pagamento e acompanhamento da execução no mesmo
processo e no mesmo banco MySQL. A Fase 4 exige a refatoração em **pelo menos
três microsserviços independentes**, cada um com repositório, infraestrutura e
banco próprios, sendo ao menos um SQL e um NoSQL.

A pergunta não era "quantos", e sim **onde cortar**. Um corte por camada
técnica (API, regras, persistência) produziria serviços que não funcionam
sozinhos. Um corte por entidade (um serviço por tabela) produziria serviços
anêmicos trocando mensagens a cada operação.

## Decisão

Cortar por **capacidade de negócio**, seguindo os limites dos contextos que já
existiam no monolito:

| Serviço | Capacidade | Por que é um limite legítimo |
| --- | --- | --- |
| `fiap-tc-ms-os` | Ordem de serviço, clientes, veículos, catálogo | É o agregado raiz do fluxo e o único que precisa conhecer a ordem dos passos |
| `fiap-tc-ms-billing` | Orçamento e pagamento | Muda pela pressão de regras fiscais e do provedor de pagamento, não pela oficina |
| `fiap-tc-ms-execucao` | Fila e execução dos serviços | Muda pela operação da oficina (checklists, apontamentos); tem ciclo de vida de horas ou dias |

O OS Service acumula também o papel de **orquestrador da Saga** (ADR-015).

Cada serviço tem repositório Git próprio, pipeline próprio, banco próprio e
Secret próprio no Kubernetes. A comunicação é REST (síncrona, do cliente para
cada serviço) e RabbitMQ (assíncrona, entre serviços).

## Consequências

- **Positivas:** cada serviço evolui e escala no seu ritmo — a fila da oficina
  tem perfil de carga completamente diferente do cadastro de clientes; o domínio
  de cada repositório é pequeno o bastante para ser lido inteiro; a falha de um
  participante não derruba o fluxo, apenas aciona a compensação.
- **Negativas:** o que era uma transação ACID virou Saga com consistência
  eventual (ADR-015); o contrato de mensageria passou a ser código duplicado nos
  três repositórios (`src/messaging/contracts.ts`) — duplicação deliberada, para
  não criar uma biblioteca compartilhada que acoplaria o deploy dos três;
  depurar um fluxo agora exige *distributed tracing*, não `console.log`.
- O cliente e o veículo ficaram no OS Service em vez de um quarto serviço de
  cadastro: eles não têm regra de negócio própria significativa e são lidos
  quase sempre no contexto de uma ordem de serviço. Um serviço a mais custaria
  uma chamada de rede por abertura de OS sem nenhum ganho de autonomia.
