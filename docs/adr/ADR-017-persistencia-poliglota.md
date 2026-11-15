# ADR-017 — Persistência poliglota: MySQL no OS Service, MongoDB nos participantes

- **Status:** Aceito
- **Data:** 2026-11-15
- **Relacionados:** ADR-014, ADR-008 (Fase 3)

## Contexto

A fase exige que os microsserviços usem **ao menos um banco SQL e ao menos um
NoSQL**, com banco próprio por serviço e proibição explícita de um serviço
acessar o banco de outro. A escolha precisava ser justificada por modelagem, não
por cumprimento de requisito.

## Decisão

| Serviço | Banco | Razão |
| --- | --- | --- |
| `fiap-tc-ms-os` | **MySQL** | A Ordem de Serviço tem relacionamentos fortes (cliente, veículo, itens, histórico de status) e consultas agregadas por status, como o tempo médio por etapa herdado da Fase 3. Integridade referencial e `JOIN` são o ganho aqui. |
| `fiap-tc-ms-billing` | **MongoDB** | Orçamento e pagamento são agregados fechados: o orçamento chega com os itens embutidos e é sempre lido por inteiro. Em modelo relacional seriam duas tabelas e um `JOIN` por leitura; como documento, é um registro — escrita e leitura atômicas em um só lugar. |
| `fiap-tc-ms-execucao` | **MongoDB** | Mesma razão de agregado fechado, mais um fator próprio: é o esquema que muda com mais frequência (checklists, fotos do reparo, apontamentos do mecânico). Documento absorve a evolução sem uma migration por campo. |

Evolução do schema:

- No OS Service, **migrations Knex** versionadas, aplicadas por um
  `initContainer` antes de o pod subir.
- Nos participantes, **índices criados em código** no bootstrap
  (`src/mongo.ts`) — o equivalente funcional das migrations para garantir que os
  três ambientes subam idênticos.

O isolamento entre bancos é garantido por **credencial**: o Secret de cada
serviço no Kubernetes contém apenas as credenciais do banco dele. Não existe,
em nenhum ambiente, credencial que permita a um serviço abrir o banco de outro.

## Consequências

- **Positivas:** cada modelo de dados segue a forma de acesso real, não a
  normalização por hábito; o requisito de persistência poliglota é atendido com
  justificativa técnica; a garantia de isolamento é operacional (credencial), e
  não uma convenção que o próximo desenvolvedor pode violar sem perceber.
- **Negativas:** duas tecnologias de persistência para operar, monitorar e
  versionar; nenhuma consulta pode cruzar os bancos — relatórios que precisem
  de dados dos três serviços exigem composição na aplicação (ou, em um cenário
  real, um CQRS com projeção dedicada).
- Os testes dos adaptadores MySQL rodam as **migrations reais** sobre SQLite em
  memória, e os dos adaptadores Mongo usam um dublê da `Collection`: o
  mapeamento é exercitado de verdade sem subir contêiner no pipeline.
