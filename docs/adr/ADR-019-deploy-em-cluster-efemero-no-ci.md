# ADR-019 — Deploy automatizado em cluster Kubernetes efêmero no CI

- **Status:** Aceito
- **Data:** 2026-11-16
- **Relacionados:** ADR-010 (proteção de branch), ADR-014

## Contexto

A Fase 4 exige, textualmente, "**deploy automatizado em ambiente
Kubernetes**" e, no vídeo de demonstração, "deploy automatizado de pelo menos
um microsserviço com validação de testes". O enunciado **não** menciona nuvem,
provedor ou serviço gerenciado em nenhum momento.

A Fase 3 deste mesmo sistema rodava em Amazon EKS, com imagens no ECR, segredos
no AWS Systems Manager Parameter Store e autenticação no Cognito. O caminho
estava escrito e funcionava. Ao retomar o projeto para a Fase 4, porém, o
estado da conta era:

| Recurso | Estado |
| --- | --- |
| Credenciais IAM | válidas |
| Clusters EKS | **nenhum** — o cluster da Fase 3 foi destruído |
| Repositórios ECR | apenas o da Fase 3 (`fiap-tc-app`) |
| Parâmetros do Parameter Store | apenas os da Fase 3 |

Ou seja: continuar na nuvem não significaria reativar um ambiente, mas
**provisionar um novo** — cluster, nós, NAT Gateway, três repositórios de
imagem, os parâmetros dos três serviços e os manifestos de banco de dados dos
participantes, que não existiam. Com três microsserviços em vez de um, isso
passou a ser o maior item de trabalho restante da fase, com custo recorrente de
ordem de US$ 5 a 7 por dia enquanto estivesse no ar.

## Decisão

**O deploy automatizado de cada microsserviço acontece em um cluster
Kubernetes criado pelo próprio pipeline com [kind](https://kind.sigs.k8s.io)
(Kubernetes in Docker), dentro do runner do GitHub Actions, e destruído no fim
da execução.**

O workflow `deploy.yml` de cada repositório, disparado por *push* em `develop`
(homologação) e `main` (produção):

1. compila, roda a suíte completa com cobertura e os cenários BDD — **nada é
   implantado sem o gate de qualidade**;
2. constrói a imagem Docker e a carrega no cluster (`kind load docker-image`);
3. sobe as dependências efêmeras do serviço (`k8s/ci/dependencias.yaml`);
4. cria o `Secret` do serviço — **somente** com as credenciais do banco dele;
5. renderiza o overlay do Kustomize do ambiente e aplica os manifestos;
6. aguarda `kubectl rollout status`, que só retorna quando o pod passa o
   *readiness probe* — e, no OS Service, depois que o initContainer de
   migrations conclui;
7. valida o serviço no cluster com um *smoke test* em `/health`.

O caminho para o Amazon EKS **permanece versionado** em
`.github/workflows/deploy-eks.yml`, com disparo apenas manual
(`workflow_dispatch`). Ele documenta a integração com ECR, Parameter Store e
EKS e volta a ser o caminho padrão quando houver cluster gerenciado.

## Consequências

**A favor:**

- **Reprodutível por quem corrige.** O avaliador pode reexecutar o workflow e
  ver o mesmo resultado. Um cluster gerenciado estaria desligado na correção, e
  o log antigo não é verificável.
- Exercita os mesmos artefatos do ambiente real: os `Deployment`, `Service`,
  `HPA`, `ConfigMap` e overlays do Kustomize aplicados aqui são os de
  `k8s/`, sem cópia paralela.
- Custo zero e **nenhum segredo de nuvem** nos repositórios — reduz a
  superfície de exposição de credenciais em repositório público.
- Falha honesta: o pipeline fica vermelho se a aplicação não subir, se a
  migration quebrar ou se `/health` não responder.

**Contra, e assumido:**

- **Não prova operação em nuvem.** Não há `LoadBalancer` provisionado de fato
  (o `Service` fica `Pending` no kind), não há IAM, VPC, nem nós reais. O
  `HPA` é aplicado mas não escala, porque o cluster do CI não tem
  *metrics-server*.
- O cluster não persiste: não é possível inspecioná-lo depois da execução. O
  pipeline compensa publicando no resumo do job o estado dos objetos e os logs
  das migrations.
- Dependências efêmeras (`k8s/ci/dependencias.yaml`) com `emptyDir` em vez de
  banco gerenciado. São declaradamente de pipeline, marcadas com o rótulo
  `fiap.io/efemero: "true"`, e não participam dos overlays de ambiente.

**Observabilidade não foi afetada por esta decisão.** O agente do New Relic
envia telemetria de onde o serviço rodar — inclusive do ambiente local via
Docker Compose —, portanto o *tracing* distribuído entre os três
microsserviços continua demonstrável sem cluster em nuvem. No cluster do CI a
licença fica deliberadamente vazia, para a conta de observabilidade não receber
telemetria de execução de pipeline.
