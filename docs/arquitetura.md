# Arquitetura da Fase 4 — sistema distribuído da oficina

Este documento reúne os diagramas da solução entregue na Fase 4. As decisões
que levaram a ela estão nos ADRs [014](adr/ADR-014-divisao-em-tres-microsservicos.md)
a [018](adr/ADR-018-idempotencia-e-dead-letter.md).

---

## 1. Visão geral — os três microsserviços

```mermaid
flowchart TB
    cliente["Cliente / Front-end"]
    gw["API Gateway + Cognito<br/>(VPC Link -> NLB interno)"]

    subgraph cluster["Cluster EKS - namespace fiap-hml / fiap-prd"]
        os["fiap-tc-ms-os<br/>API REST + ORQUESTRADOR da Saga"]
        billing["fiap-tc-ms-billing<br/>orcamento e pagamento"]
        exec["fiap-tc-ms-execucao<br/>fila e execucao"]
        broker{{"RabbitMQ<br/>exchange oficina.saga"}}
    end

    mysql[("MySQL<br/>fiap_tc_os")]
    mongoB[("MongoDB<br/>fiap_tc_billing")]
    mongoE[("MongoDB<br/>fiap_tc_execucao")]
    mp["Mercado Pago"]
    nr["New Relic<br/>APM + logs + eventos"]

    cliente --> gw
    gw --> os
    gw --> billing
    gw --> exec

    os <-->|comandos e respostas| broker
    billing <-->|comandos e respostas| broker
    exec <-->|comandos e respostas| broker

    os --> mysql
    billing --> mongoB
    exec --> mongoE
    billing --> mp

    os --> nr
    billing --> nr
    exec --> nr
```

**O que o diagrama mostra de propósito:** cada serviço tem **uma única** seta
para **um único** banco. Não existe seta de um serviço para o banco de outro —
e isso não é apenas convenção: o Secret de cada serviço no Kubernetes contém
somente as credenciais do banco dele.

A comunicação entre serviços passa exclusivamente pelo broker. Não há chamada
HTTP de serviço para serviço.

---

## 2. Saga — caminho feliz

```mermaid
sequenceDiagram
    actor C as Cliente
    participant OS as OS Service<br/>(orquestrador)
    participant B as Billing
    participant E as Execucao

    C->>OS: POST /ordens-servico
    OS->>OS: 1. cria a OS (transacao local)
    OS-->>C: 202 Accepted (sagaId)
    OS->>B: 2. GERAR_ORCAMENTO
    B->>B: calcula e persiste o orcamento
    B-->>OS: ORCAMENTO_GERADO (valorTotal)
    OS->>OS: OS = AGUARDANDO_APROVACAO

    C->>OS: POST /ordens-servico/{id}/aprovacao
    OS->>OS: 3. decisao do cliente registrada
    OS->>B: 4. REGISTRAR_PAGAMENTO
    B->>B: cobra via Mercado Pago (idempotente)
    B-->>OS: PAGAMENTO_REGISTRADO
    OS->>E: 5. ENFILEIRAR_EXECUCAO
    E->>E: valida capacidade e entra na fila
    E-->>OS: EXECUCAO_ENFILEIRADA (posicaoFila)
    OS->>OS: OS = EM_EXECUCAO / SAGA_CONCLUIDA

    Note over E: horas ou dias depois — fora da Saga
    E->>E: mecanico inicia e finaliza o reparo
    E-->>OS: EXECUCAO_FINALIZADA (evento, coreografia)
    OS->>OS: OS = FINALIZADA
```

---

## 3. Saga — rollback por falha na execução (passo 5)

O caso mais instrutivo: a falha acontece no **último** passo, com pagamento já
confirmado.

```mermaid
sequenceDiagram
    participant OS as OS Service<br/>(orquestrador)
    participant B as Billing
    participant E as Execucao

    OS->>E: 5. ENFILEIRAR_EXECUCAO
    E-->>OS: EXECUCAO_FALHOU (fila cheia)
    OS->>OS: Saga = COMPENSANDO

    Note over OS: compensa na ORDEM INVERSA dos passos concluidos
    OS->>B: 4'. ESTORNAR_PAGAMENTO
    B->>B: estorna no provedor (refund-<id>)
    B-->>OS: PAGAMENTO_ESTORNADO
    OS->>B: 2'. CANCELAR_ORCAMENTO
    B->>B: orcamento = CANCELADO (historico preservado)
    B-->>OS: ORCAMENTO_CANCELADO
    OS->>OS: 1'. OS = CANCELADA / Saga = COMPENSADA
```

Estorna-se o pagamento **antes** de cancelar o orçamento porque o orçamento
cancelado é o documento que justifica o estorno.

---

## 4. Máquina de estados da Ordem de Serviço

```mermaid
stateDiagram-v2
    [*] --> RECEBIDA: POST /ordens-servico
    RECEBIDA --> EM_DIAGNOSTICO
    EM_DIAGNOSTICO --> AGUARDANDO_APROVACAO: ORCAMENTO_GERADO
    AGUARDANDO_APROVACAO --> AGUARDANDO_PAGAMENTO: cliente aprova
    AGUARDANDO_APROVACAO --> RECUSADA: cliente recusa
    AGUARDANDO_PAGAMENTO --> EM_EXECUCAO: EXECUCAO_ENFILEIRADA
    EM_EXECUCAO --> FINALIZADA: EXECUCAO_FINALIZADA
    FINALIZADA --> ENTREGUE: cliente retira o veiculo
    AGUARDANDO_PAGAMENTO --> CANCELADA: Saga compensada
    EM_EXECUCAO --> CANCELADA: Saga compensada
    RECUSADA --> [*]
    CANCELADA --> [*]
    ENTREGUE --> [*]
```

Os estados `AGUARDANDO_APROVACAO` e `AGUARDANDO_PAGAMENTO` funcionam como
*Semantic Lock*: sinalizam que o resultado ainda não é definitivo enquanto a
Saga está em andamento.

---

## 5. Topologia de mensageria

```mermaid
flowchart LR
    os["OS Service"]
    b["Billing"]
    e["Execucao"]
    x{{"exchange oficina.saga<br/>(direct, durable)"}}

    qb["saga.billing.comandos"]
    qe["saga.execucao.comandos"]
    qr["saga.os.reply"]
    qv["oficina.eventos"]
    qd["oficina.dead-letter"]

    os -->|billing.comandos| x
    os -->|execucao.comandos| x
    x --> qb --> b
    x --> qe --> e

    b -->|os.reply| x
    e -->|os.reply| x
    x --> qr --> os

    os -->|eventos| x
    e -->|eventos| x
    x --> qv

    qb -.->|tentativas esgotadas| qd
    qe -.->|tentativas esgotadas| qd
    qr -.->|tentativas esgotadas| qd
```

A topologia é declarada em código, de forma idempotente, na conexão — os três
ambientes sobem idênticos, sem criação manual de filas.

---

## 6. Camadas de um serviço (Clean Architecture)

O mesmo desenho nos três repositórios. A dependência aponta sempre para dentro.

```mermaid
flowchart TB
    subgraph infra["src/ — infraestrutura e adaptadores"]
        http["routes/<br/>entrada sincrona (HTTP)"]
        mq["messaging/<br/>entrada assincrona (RabbitMQ)"]
        db["repository/MySQL ou Mongo<br/>saida (persistencia)"]
        ext["gateway/MercadoPago, telemetry/<br/>saida (integracoes)"]
    end

    subgraph core["domain/ — nucleo de negocio"]
        uc["usecase/<br/>casos de uso"]
        saga["saga/<br/>orquestrador e definicao"]
        ent["entity/ + vo/<br/>entidades e value objects"]
        ports["repository/ + gateway/<br/>PORTAS (interfaces)"]
    end

    http --> uc
    mq --> uc
    uc --> saga
    uc --> ent
    saga --> ent
    uc --> ports
    saga --> ports
    db -.implementa.-> ports
    ext -.implementa.-> ports
```

O núcleo não importa Express, Knex, MongoDB, amqplib nem o SDK do New Relic. É
o que permite que todos os casos de uso e a Saga sejam testados com dublês em
memória, sem contêiner e sem rede.

---

## 7. Pipeline de CI/CD (por repositório)

```mermaid
flowchart LR
    pr["Pull Request"] --> ci["CI: typecheck, build,<br/>cobertura >= 80%, BDD,<br/>kustomize, imagem Docker"]
    ci --> sonar["SonarQube<br/>Quality Gate"]
    sonar --> merge{"merge na branch<br/>protegida"}
    merge -->|develop| hml["ECR + EKS<br/>namespace fiap-hml"]
    merge -->|main| prd["ECR + EKS<br/>namespace fiap-prd"]
```

Cada um dos três repositórios tem esse pipeline de forma **independente**: um
serviço reprovado no gate não impede o deploy dos outros dois.
