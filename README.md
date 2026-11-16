# fiap-tc-ms-os — Ordem de Serviço e orquestrador da Saga

> **Tech Challenge — Pós-Tech SOAT (FIAP) — Fase 4**
> **Eric Kanno Rodrigues de Araujo** — RM 371731 — Grupo 45 — Discord: `peeyote`
> Vídeo da entrega: <https://youtu.be/Nlk2cV31lzk>

Microsserviço de **Ordem de Serviço** da oficina mecânica. Acumula dois papéis:

1. **API REST** de entrada do cliente (abrir OS, aprovar orçamento, consultar);
2. **Orquestrador da Saga** que coordena os outros dois microsserviços por mensageria.

Faz parte do Tech Challenge da **Fase 4** da Pós-Tech SOAT (FIAP), que refatora o
monolito da Fase 3 em três serviços independentes:

| Serviço | Repositório | Papel na Saga | Banco | Porta local |
| --- | --- | --- | --- | --- |
| Ordem de Serviço | [fiap-tc-ms-os](https://github.com/pyGits/fiap-tc-ms-os) | **Orquestrador** | MySQL (SQL) | 3000 |
| Orçamento e Pagamento | [fiap-tc-ms-billing](https://github.com/pyGits/fiap-tc-ms-billing) | Participante | MongoDB (NoSQL) | 3001 |
| Execução e Produção | [fiap-tc-ms-execucao](https://github.com/pyGits/fiap-tc-ms-execucao) | Participante | MongoDB (NoSQL) | 3002 |

---

## Sumário

- [A Saga](#a-saga)
  - [Por que orquestração e não coreografia](#por-que-orquestração-e-não-coreografia)
  - [Os cinco passos e suas compensações](#os-cinco-passos-e-suas-compensações)
  - [O que a Saga garante — e o que não garante](#o-que-a-saga-garante--e-o-que-não-garante)
- [Arquitetura](#arquitetura)
- [Contrato de mensageria](#contrato-de-mensageria)
- [Como rodar localmente](#como-rodar-localmente)
- [Como demonstrar o rollback](#como-demonstrar-o-rollback)
- [Testes e cobertura](#testes-e-cobertura)
- [CI/CD e Kubernetes](#cicd-e-kubernetes)
- [Observabilidade](#observabilidade)
- [Documentação da API](#documentação-da-api)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Documentação de decisões (ADRs)](#documentação-de-decisões-adrs)

---

## A Saga

Abrir uma ordem de serviço deixou de ser uma transação de banco. Agora ela
atravessa três serviços, cada um com o seu próprio banco, e **não existe
commit distribuído**: cada passo confirma localmente e, se um passo falha, os
anteriores precisam ser desfeitos por **transações compensatórias**.

### Por que orquestração e não coreografia

A escolha foi **Saga orquestrada**, com o orquestrador dentro do OS Service.
As razões, na ordem em que pesaram:

1. **O fluxo tem decisão e espera humana.** O passo 3 é a aprovação do
   orçamento pelo cliente, que pode levar minutos ou dias e pode terminar em
   recusa. Em coreografia, cada serviço reagiria a eventos sem que ninguém
   soubesse em que ponto do fluxo a OS está; alguém teria de recompor esse
   estado a partir do histórico de eventos. Com orquestração, o estado da Saga
   é um registro explícito (`saga_instancias` / `saga_passos`), e "esta OS está
   parada no passo 3 desde terça" é uma consulta, não uma investigação.

2. **A ordem dos passos é uma regra de negócio, não um detalhe.** Cobrar antes
   de enfileirar a execução é deliberado (ver abaixo). Essa ordem está
   declarada em um único arquivo — [`domain/saga/DefinicaoSaga.ts`](domain/saga/DefinicaoSaga.ts) —
   e não espalhada por assinaturas de evento em três repositórios.

3. **O rollback precisa ser auditável.** Quando a Saga compensa, a sequência
   inversa executada fica registrada passo a passo. Numa oficina isso não é
   luxo: é a diferença entre "o cliente foi estornado" e "achamos que foi".

O custo assumido: o orquestrador é um ponto de conhecimento central e um ponto
de falha a mais. Mitigações adotadas: o estado da Saga é persistido a cada
transição (um pod que morre no meio do fluxo não perde o progresso), os
comandos são idempotentes, e as filas são duráveis com *dead letter*.

### Os cinco passos e suas compensações

| # | Passo | Participante | Comando | Compensação |
| --- | --- | --- | --- | --- |
| 1 | `criar-ordem-servico` | OS Service | transação local | cancela a OS |
| 2 | `gerar-orcamento` | Billing | `GERAR_ORCAMENTO` | `CANCELAR_ORCAMENTO` |
| 3 | `aguardar-aprovacao` | Cliente (OS Service) | decisão humana | — (sem efeito externo) |
| 4 | `registrar-pagamento` | Billing | `REGISTRAR_PAGAMENTO` | `ESTORNAR_PAGAMENTO` |
| 5 | `enfileirar-execucao` | Execução | `ENFILEIRAR_EXECUCAO` | `CANCELAR_EXECUCAO` |

```
Cliente                OS Service (orquestrador)         Billing            Execução
   |  POST /ordens-servico   |                               |                   |
   |------------------------>| 1. cria a OS (local)          |                   |
   |      202 Accepted       |                               |                   |
   |<------------------------| 2. GERAR_ORCAMENTO ---------->| gera o orçamento  |
   |                         |<------- ORCAMENTO_GERADO -----|                   |
   |                         | OS: AGUARDANDO_APROVACAO      |                   |
   |  POST /{id}/aprovacao   |                               |                   |
   |------------------------>| 3. decisão do cliente         |                   |
   |                         | 4. REGISTRAR_PAGAMENTO ------>| cobra (Mercado Pago)
   |                         |<----- PAGAMENTO_REGISTRADO ---|                   |
   |                         | 5. ENFILEIRAR_EXECUCAO ------------------------->  | entra na fila
   |                         |<------------------- EXECUCAO_ENFILEIRADA --------- |
   |                         | OS: EM_EXECUCAO / SAGA_CONCLUIDA                   |
   |                         |                               |                   |
   |                         |  ... horas ou dias depois ...                      |
   |                         |<--------------- EXECUCAO_FINALIZADA (evento) ----- |
   |                         | OS: FINALIZADA                                    |
```

**Rollback — falha no passo 5 (o caso mais instrutivo):**

```
   | 5. ENFILEIRAR_EXECUCAO ------------------------------------------>| fila cheia
   |<------------------------------------------- EXECUCAO_FALHOU ------|
   | compensa em ORDEM INVERSA:                                        |
   |   5' (nada a desfazer: a execução nunca foi criada)               |
   |   4' ESTORNAR_PAGAMENTO -------->| estorna no provedor            |
   |   2' CANCELAR_ORCAMENTO -------->| cancela o orçamento            |
   |   1' cancela a OS                                                 |
   | OS: CANCELADA / SAGA_COMPENSADA                                   |
```

A compensação é executada **na ordem inversa** à dos passos: estorna-se o
pagamento antes de cancelar o orçamento, porque o orçamento cancelado é o
documento que justifica o estorno.

**A ordem dos passos aplica a contramedida *Pessimistic View*:** cobrar (passo 4)
antes de enfileirar a execução (passo 5) coloca o efeito colateral **mais
difícil de desfazer** — a oficina começar a desmontar o carro — depois do que é
**fácil de estornar** — o pagamento. O inverso seria confortável para o cliente
e desastroso para a oficina.

### O que a Saga garante — e o que não garante

**Garante:**

- **Consistência eventual com compensação auditável.** Nenhum passo fica
  pendurado: toda falha leva a Saga a `CONCLUIDA` ou a `COMPENSADA`.
- **Idempotência em todos os comandos.** Cada mensagem carrega um `mensagemId`,
  e cada participante registra o que já processou em um índice **único** no
  banco (`mensagens_processadas`). Uma reentrega do RabbitMQ não cobra duas
  vezes nem ocupa duas vagas na oficina.
- **Compensações permissivas.** Cancelar algo que não existe, ou que já está
  cancelado, é *no-op* bem-sucedido. Uma compensação que falhasse deixaria a
  Saga presa em `COMPENSANDO` — pior que o problema original.

**Não garante:**

- **Isolamento.** Entre o passo 2 e o passo 4, existe um orçamento gerado para
  uma OS que talvez seja cancelada. Isso é inerente ao padrão (as Sagas são
  ACD, sem o I) e está tratado pelas contramedidas: *Semantic Lock* (os status
  intermediários `AGUARDANDO_APROVACAO` / `AGUARDANDO_PAGAMENTO` sinalizam
  "ainda não é definitivo") e *Pessimistic View* na ordenação dos passos.
- **Reverter um reparo concluído.** Se o mecânico já terminou o serviço, a
  compensação `CANCELAR_EXECUCAO` responde `compensado: false`: a Saga sai de
  `COMPENSANDO`, mas o caso vira **pendência manual** com alerta próprio na
  telemetria. Um carro consertado não volta ao estado anterior por mensagem.

---

## Arquitetura

**Clean Architecture** com a mesma disciplina da Fase 3: a regra de negócio não
conhece framework, banco nem broker.

```
domain/                        # Núcleo — sem dependência de infraestrutura
  entity/                      # OrdemServico, ItemOrdemServico, Cliente, Veiculo
  vo/                          # CPFCNPJ, Email, Placa, ID
  saga/                        # SagaOrdemServico, DefinicaoSaga, SagaOrquestrador
  repository/                  # Portas (interfaces) + adaptadores MySQL e Memória
  gateway/                     # Portas de mensageria e telemetria + dublês
  usecase/                     # Casos de uso (as operações do negócio)
src/                           # Infraestrutura e adaptadores de entrada
  routes/                      # Adaptador de entrada síncrono (HTTP)
  messaging/                   # Adaptador de entrada assíncrono (RabbitMQ)
  database/migrations/         # Evolução do schema do banco PRÓPRIO
  middleware/, telemetry/      # Auth (Cognito), correlationId, erros, New Relic
```

A dependência aponta sempre para dentro: `src/` conhece `domain/`, nunca o
contrário. O `SagaOrquestrador` recebe as portas de mensageria e repositório —
trocar RabbitMQ por SQS não toca uma linha de regra de negócio.

### Nenhum serviço acessa o banco de outro

O requisito é cumprido por **isolamento de credencial**, não por convenção: o
Secret de cada serviço no Kubernetes contém apenas as credenciais do banco
dele. Não existe, em nenhum ambiente, credencial que permita ao Billing abrir o
MySQL do OS Service. A comunicação entre serviços é exclusivamente:

- **síncrona (REST)** — do cliente para cada serviço;
- **assíncrona (RabbitMQ)** — entre os serviços, por comandos e eventos.

---

## Contrato de mensageria

Exchange `oficina.saga` (tipo `direct`, durável). O contrato é idêntico nos três
repositórios: [`src/messaging/contracts.ts`](src/messaging/contracts.ts).

| Fila | Routing key | Consumidor |
| --- | --- | --- |
| `saga.billing.comandos` | `billing.comandos` | Billing |
| `saga.execucao.comandos` | `execucao.comandos` | Execução |
| `saga.os.reply` | `os.reply` | OS Service (orquestrador) |
| `oficina.eventos` | `eventos` | assinantes de eventos de negócio |
| `oficina.dead-letter` | `dead-letter` | inspeção manual |

Toda mensagem tem um envelope com `mensagemId`, `sagaId`, `correlationId`,
`ordemServicoId`, `tipo`, `origem`, `dataEnvio` e `tentativa`. O `correlationId`
atravessa HTTP e fila, o que torna o rastreamento distribuído possível de ponta
a ponta.

Falhas transitórias são reentregues com `tentativa` incrementada até
`SAGA_MAX_TENTATIVAS`; esgotadas as tentativas, a mensagem vai para a
*dead letter* em vez de se perder ou travar a fila.

---

## Como rodar localmente

Pré-requisitos: Docker e Docker Compose. **Este serviço sobe primeiro**: o
compose dele cria a rede `oficina-net` e o RabbitMQ usados pelos outros dois.

```bash
# 1) OS Service + MySQL + RabbitMQ (cria a rede compartilhada)
cd fiap-tc-ms-os && docker compose up -d --build

# 2) Billing + MongoDB próprio
cd ../fiap-tc-ms-billing && docker compose up -d --build

# 3) Execução + MongoDB próprio
cd ../fiap-tc-ms-execucao && docker compose up -d --build
```

| Endereço | O quê |
| --- | --- |
| http://localhost:3000/api-docs | Swagger do OS Service |
| http://localhost:3001/api-docs | Swagger do Billing |
| http://localhost:3002/api-docs | Swagger da Execução |
| http://localhost:15672 | Painel do RabbitMQ (`guest` / `guest`) |

No ambiente local, `AUTH_DISABLED=true` e `MERCADO_PAGO_MOCK=true`: sobe sem
Cognito e **sem contatar o provedor de pagamento real**.

### Sem Docker

```bash
npm ci
cp .env.example .env     # ajuste DB_* e RABBITMQ_URL
npm run migrate
npm run dev
```

As migrations criam o schema e inserem o catálogo de serviços/peças e um
cliente de demonstração (CPF fictício `529.982.247-25`, placa `ABC1D23`).

---

## Como demonstrar o rollback

O corpo de `POST /ordens-servico` aceita dois gatilhos de falha **controlada**,
que existem para tornar o rollback demonstrável sem depender de erro real:

```jsonc
{
  "clienteId": "...",
  "veiculoId": "...",
  "itens": [{ "id": "srv-revisao", "quantidade": 1 }],
  "simularFalhaPagamento": true,   // o provedor recusa a cobrança (passo 4)
  "simularFalhaExecucao": true     // a oficina recusa o serviço (passo 5)
}
```

| Cenário | O que a Saga faz | Resultado |
| --- | --- | --- |
| `simularFalhaPagamento` | compensa o passo 2 | orçamento `CANCELADO`, OS `CANCELADA`, nada foi cobrado |
| `simularFalhaExecucao` | compensa os passos 4 e 2, **nessa ordem** | pagamento `ESTORNADO`, orçamento `CANCELADO`, OS `CANCELADA` |
| fila da oficina cheia | igual ao anterior, sem gatilho artificial | idem (recusa legítima de negócio) |
| cliente recusa o orçamento | encerra pelo caminho de negócio | orçamento `CANCELADO`, OS `RECUSADA`, nunca cobrou |

A coleção Postman em [`postman/`](postman/) tem uma pasta por cenário, pronta
para o Runner.

---

## Testes e cobertura

```bash
npm test               # unitários
npm run test:coverage  # unitários + cobertura (falha abaixo de 80%)
npm run test:bdd       # cenários Gherkin (Cucumber)
npm run test:all       # tudo
```

**Resultado desta entrega:**

| Serviço | Testes | Statements | Branches | Functions | Lines | BDD |
| --- | --- | --- | --- | --- | --- | --- |
| **OS Service** | 173 em 10 suítes | **93,60%** | **85,05%** | **95,01%** | **94,15%** | 5 cenários / 60 passos |
| Billing | 115 em 7 suítes | 95,22% | 82,78% | 91,66% | 95,57% | 8 cenários / 46 passos |
| Execução | 80 em 5 suítes | 95,37% | 85,36% | 92,41% | 95,85% | 9 cenários / 54 passos |

O patamar de 80% em **todas as quatro métricas** está em `coverageThreshold`
(`jest.config.js`): o Jest encerra com erro se a cobertura cair, e o pipeline
falha com ele. Não é um número no README — é um portão.

O que os testes cobrem, além da contagem:

- **Máquina de estados da OS** e invariantes das entidades e dos *value objects*
  (CPF/CNPJ com dígito verificador, placa nos dois padrões, e-mail).
- **Orquestrador da Saga**: avanço passo a passo, compensação em ordem inversa,
  compensação de passo que nunca executou, idempotência das respostas.
- **Adaptadores MySQL rodando as migrations reais** sobre SQLite em memória
  (`better-sqlite3`, com `foreign_keys = ON`): o mapeamento e as restrições de
  integridade são exercitados de verdade, sem subir contêiner no pipeline.
- **Consumidores**: reentrega, incremento de tentativa, desvio para
  *dead letter*, descarte de duplicata, payload inválido.
- **Autenticação**: token válido, 401 genérico (sem revelar o motivo da
  rejeição) e 503 quando o Cognito não está configurado — nunca liberar a rota.

### BDD

`tests/bdd/features/ordem_servico_saga.feature`, em Gherkin português:

```gherkin
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
```

Os cinco cenários cobrem o fluxo completo, as duas falhas com rollback, a
recusa do cliente e a validação que barra a OS antes de a Saga começar.

---

## CI/CD e Kubernetes

Pipeline **independente** deste repositório (`.github/workflows/`):

**`ci.yml`** — roda em todo Pull Request e é o *status check* obrigatório da
branch protegida `main`:

1. `npm run typecheck` e `npm run build`;
2. `npm run test:coverage` — **gate de 80%**;
3. `npm run test:bdd`;
4. resumo da cobertura publicado no *summary* do job e guardado como artefato;
5. `kubectl kustomize` dos overlays `hml` e `prd` (manifesto quebrado não passa);
6. build da imagem Docker;
7. job `qualidade`: análise **SonarQube** + espera do **Quality Gate**.

**`deploy.yml`** — deploy automatizado em Kubernetes, GitFlow com um ambiente
por branch:

| Merge em | Ambiente | Namespace |
| --- | --- | --- |
| `develop` | homologação | `fiap-hml` |
| `main` | produção | `fiap-prd` |

O cluster é criado pelo próprio pipeline com **kind** (Kubernetes in Docker) no
runner e destruído no fim do job — a decisão e o que ela *não* prova estão em
[ADR-019](docs/adr/ADR-019-deploy-em-cluster-efemero-no-ci.md). A sequência:

1. build + `test:coverage` + `test:bdd` — **nada é implantado sem o gate**;
2. imagem Docker construída e carregada no cluster (`kind load docker-image`);
3. dependências efêmeras do serviço ([`k8s/ci/`](k8s/ci/)): MySQL e RabbitMQ;
4. `Secret` do serviço, **só** com as credenciais do banco dele;
5. overlay do Kustomize renderizado e aplicado;
6. `kubectl rollout status` — só retorna depois do initContainer de migrations
   e do *readiness probe*;
7. *smoke test* em `/health` dentro do cluster, via `port-forward`.

O estado dos objetos e os logs das migrations ficam publicados no resumo do
job, que é a evidência do deploy.

**`deploy-eks.yml`** — o caminho para **Amazon EKS** da Fase 3 (imagem no ECR,
Secret a partir do **AWS Systems Manager Parameter Store**), preservado e com
disparo **apenas manual**. A Fase 4 não exige nuvem, e não há cluster
gerenciado no ar; quando houver, este volta a ser o caminho padrão.

Manifestos em [`k8s/`](k8s/):

```
k8s/base/            configmap, deployment (com initContainer de migrations), service, hpa
k8s/overlays/hml/    namespace fiap-hml, 1 réplica, LOG_LEVEL=debug
k8s/overlays/prd/    namespace fiap-prd, 2 réplicas, HPA 2–10
k8s/shared/          RabbitMQ de homologação (aplicado uma vez, fora do pipeline)
k8s/ci/              MySQL e RabbitMQ efêmeros, usados SÓ pelo cluster do pipeline
```

```bash
npm run k8s:render:hml   # inspeciona o manifesto renderizado
npm run k8s:render:prd
```

A proteção da `main` (merge somente via Pull Request, com o check `ci` verde) é
configurada no *ruleset* do repositório no GitHub — é o que impede que código
sem teste chegue à produção.

---

## Observabilidade

Reaproveita o que a Fase 3 montou, agora distribuído:

- **New Relic APM** com *distributed tracing* ligado nos três serviços: um
  `correlationId` percorre a requisição HTTP, os comandos na fila e as respostas
  — o trace mostra a Saga inteira, não três gráficos separados.
- **Eventos de negócio** (`recordCustomEvent`), não só métricas técnicas:
  `SagaIniciada`, `SagaPassoConcluido`, `SagaCompensada`, `OrdemServicoStatus`,
  `PagamentoRegistrado`, `ExecucaoEnfileirada`, `ExecucaoFinalizada`.
- **Logs estruturados** (pino) com `correlationId` e `sagaId` em cada linha,
  encaminhados ao New Relic pelo próprio agente.
- Sem `NEW_RELIC_LICENSE_KEY` o agente não é carregado e a telemetria cai para
  log — o serviço roda igual em ambiente local.

O alerta que mais importa: `ExecucaoCancelada` com `compensado: false` — a
compensação impossível, que exige intervenção humana.

---

## Documentação da API

- **Swagger UI**: `/api-docs`
- **OpenAPI (JSON)**: `/api-docs.json`
- **Postman**: [`postman/fiap-tc-ms-os.postman_collection.json`](postman/)

---

## Estrutura de pastas

```
domain/           núcleo de negócio (entidades, VOs, Saga, portas, casos de uso)
src/              adaptadores e infraestrutura (HTTP, RabbitMQ, MySQL, telemetria)
tests/unit/       testes unitários e de adaptadores
tests/bdd/        features Gherkin e steps
k8s/              manifestos Kustomize (base + overlays + shared)
docs/             ADRs e diagramas
postman/          coleção de requisições
.github/          pipelines de CI e CD
```

---

## Documentação de decisões (ADRs)

Os diagramas da solução — visão geral, sequência da Saga no caminho feliz e no
rollback, máquina de estados da OS, topologia de mensageria, camadas e pipeline
— estão em [`docs/arquitetura.md`](docs/arquitetura.md).

As decisões de arquitetura desta fase estão em [`docs/adr/`](docs/adr/):

| ADR | Decisão |
| --- | --- |
| [ADR-014](docs/adr/ADR-014-divisao-em-tres-microsservicos.md) | Divisão do monolito em três microsserviços |
| [ADR-015](docs/adr/ADR-015-saga-orquestrada.md) | Saga **orquestrada** em vez de coreografada |
| [ADR-016](docs/adr/ADR-016-rabbitmq-como-broker.md) | RabbitMQ como broker de mensageria |
| [ADR-017](docs/adr/ADR-017-persistencia-poliglota.md) | Persistência poliglota: MySQL no OS, MongoDB nos participantes |
| [ADR-018](docs/adr/ADR-018-idempotencia-e-dead-letter.md) | Idempotência durável e *dead letter* |
| [ADR-019](docs/adr/ADR-019-deploy-em-cluster-efemero-no-ci.md) | Deploy automatizado em cluster Kubernetes efêmero no CI |

Os ADRs 001 a 013 e os RFCs da Fase 3 seguem válidos no repositório
[fiap-tc-app](https://github.com/pyGits/fiap-tc-app).
