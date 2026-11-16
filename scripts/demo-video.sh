#!/usr/bin/env bash
#
# Roteiro executável da demonstração da Fase 4.
#
# Percorre, em ordem, o que o enunciado pede que o vídeo mostre:
#   1. fluxo completo de uma OS atravessando os três microsserviços;
#   2. Saga Pattern no caminho feliz e no rollback (duas falhas diferentes);
#   3. rastreamento do fluxo distribuído pelo correlation id.
#
# Cada passo para e espera Enter, para dar tempo de narrar. Com PAUSAR=0 roda
# direto, sem parar (útil para ensaiar antes de gravar).
#
# Pré-requisitos: os três serviços no ar (docker compose em cada repositório,
# na ordem os -> billing -> execucao) e `python` no PATH para formatar o JSON.
#
# Uso:
#   bash scripts/demo-video.sh            # pausando a cada passo
#   PAUSAR=0 bash scripts/demo-video.sh   # ensaio corrido

set -uo pipefail

OS_URL="${OS_URL:-http://localhost:3000}"
BILLING_URL="${BILLING_URL:-http://localhost:3001}"
EXECUCAO_URL="${EXECUCAO_URL:-http://localhost:3002}"
PAUSAR="${PAUSAR:-1}"

# Cliente e veículo criados pelas migrations (CPF fictício, placa fictícia).
CLIENTE="11111111-1111-4111-8111-111111111111"
VEICULO="22222222-2222-4222-8222-222222222222"

AZUL=$'\033[1;34m'; VERDE=$'\033[1;32m'; VERMELHO=$'\033[1;31m'
AMARELO=$'\033[1;33m'; CINZA=$'\033[0;90m'; FIM=$'\033[0m'

titulo() {
  echo
  echo "${AZUL}============================================================${FIM}"
  echo "${AZUL} $*${FIM}"
  echo "${AZUL}============================================================${FIM}"
}

passo() { echo; echo "${AMARELO}--> $*${FIM}"; }
nota()  { echo "${CINZA}    $*${FIM}"; }

pausa() {
  [ "$PAUSAR" = "0" ] && return 0
  echo
  read -r -p "${CINZA}    [Enter para continuar]${FIM} " _ || true
}

# Mostra método, rota e resposta formatada. O correlation id vai em TODAS as
# chamadas: é ele que costura os logs dos três serviços e o trace no New Relic.
req() {
  local metodo="$1" url="$2" corpo="${3:-}"
  echo "${CINZA}    $metodo $url${FIM}"
  local resposta
  if [ -n "$corpo" ]; then
    resposta=$(curl -sS -X "$metodo" "$url" \
      -H "Content-Type: application/json" \
      -H "X-Correlation-Id: $CORRELACAO" \
      --data "$corpo")
  else
    resposta=$(curl -sS -X "$metodo" "$url" -H "X-Correlation-Id: $CORRELACAO")
  fi
  echo "$resposta" | python -c "
import json,sys
texto = sys.stdin.read()
try:
    print(json.dumps(json.loads(texto), indent=2, ensure_ascii=False))
except Exception:
    print(texto)
" | sed 's/^/    /'
  ULTIMA_RESPOSTA="$resposta"
}

# Lê um campo simples do último JSON recebido.
campo() {
  echo "$ULTIMA_RESPOSTA" | python -c "
import json,sys
try:
    d = json.loads(sys.stdin.read())
except Exception:
    print(''); raise SystemExit
for chave in '$1'.split('.'):
    if isinstance(d, dict):
        d = d.get(chave, '')
    else:
        d = ''
print(d if d is not None else '')
"
}

# A Saga é assíncrona: espera o status desejado em vez de dormir um tempo fixo.
esperar_status() {
  local os_id="$1" esperado="$2" tentativas="${3:-40}"
  echo "${CINZA}    aguardando a OS chegar em $esperado ...${FIM}"
  for _ in $(seq 1 "$tentativas"); do
    local atual
    atual=$(curl -sS "$OS_URL/ordens-servico/$os_id" \
      -H "X-Correlation-Id: $CORRELACAO" | python -c "
import json,sys
try:
    print(json.loads(sys.stdin.read()).get('status',''))
except Exception:
    print('')
")
    if [ "$atual" = "$esperado" ]; then
      echo "${VERDE}    status = $atual${FIM}"
      return 0
    fi
    sleep 1
  done
  echo "${VERMELHO}    a OS não chegou em $esperado (último: ${atual:-?})${FIM}"
  return 1
}

abrir_os() {
  local extra="$1"
  CORRELACAO="demo-$(date +%s)-$RANDOM"
  nota "correlation id desta Saga: $CORRELACAO"
  req POST "$OS_URL/ordens-servico" "{
    \"clienteId\": \"$CLIENTE\",
    \"veiculoId\": \"$VEICULO\",
    \"itens\": [
      { \"id\": \"srv-revisao\", \"quantidade\": 1 },
      { \"id\": \"pec-filtro-oleo\", \"quantidade\": 1 },
      { \"id\": \"ins-oleo-5w30\", \"quantidade\": 4 }
    ]$extra
  }"
  OS_ID=$(campo "ordemServicoId")
  [ -z "$OS_ID" ] && OS_ID=$(campo "id")
}

# ---------------------------------------------------------------------------

CORRELACAO="demo-inicial"

titulo "0. Os três microsserviços no ar, cada um com seu banco"
passo "OS Service (MySQL, orquestrador da Saga)"
req GET "$OS_URL/health"
passo "Billing Service (MongoDB próprio)"
req GET "$BILLING_URL/health"
passo "Execução Service (MongoDB próprio)"
req GET "$EXECUCAO_URL/health"
nota "Painel do RabbitMQ: http://localhost:15672 (guest/guest)"
nota "Swagger de cada um: /api-docs nas portas 3000, 3001 e 3002"
pausa

# ===========================================================================
titulo "1. CAMINHO FELIZ — a OS atravessa os três serviços"
# ===========================================================================

passo "1.1 Abertura da OS — passo 1 da Saga (transação local) e comando GERAR_ORCAMENTO"
abrir_os ""
nota "HTTP 202: a OS existe, mas a Saga ainda está em andamento nos outros serviços"
pausa

passo "1.2 O Billing gerou o orçamento (passo 2) e a OS espera a decisão do cliente"
esperar_status "$OS_ID" "AGUARDANDO_APROVACAO"
req GET "$OS_URL/ordens-servico/$OS_ID"
pausa

passo "1.3 O orçamento está no banco do BILLING, não no do OS"
req GET "$BILLING_URL/orcamentos/ordem-servico/$OS_ID"
nota "O Billing guarda a própria cópia dos dados que recebeu pela mensagem."
nota "Ele não tem credencial para o MySQL do OS Service — e vice-versa."
pausa

passo "1.4 O cliente aprova — passo 3, e isso dispara REGISTRAR_PAGAMENTO (passo 4)"
req POST "$OS_URL/ordens-servico/$OS_ID/aprovacao" '{"aprovado": true}'
pausa

passo "1.5 Pagamento registrado e execução enfileirada (passo 5)"
esperar_status "$OS_ID" "EM_EXECUCAO"
req GET "$BILLING_URL/pagamentos/ordem-servico/$OS_ID"
pausa

passo "1.6 A oficina recebeu o serviço: posição na fila e tempo estimado"
req GET "$EXECUCAO_URL/execucoes/ordem-servico/$OS_ID"
EXEC_ID=$(campo "id")
req GET "$EXECUCAO_URL/execucoes/fila"
pausa

passo "1.7 A oficina executa e finaliza — o evento volta e fecha a OS"
req POST "$EXECUCAO_URL/execucoes/$EXEC_ID/inicio"
req POST "$EXECUCAO_URL/execucoes/$EXEC_ID/finalizacao"
esperar_status "$OS_ID" "FINALIZADA"
req GET "$OS_URL/ordens-servico/$OS_ID"
nota "Saga concluída: cinco passos, três serviços, três bancos."
pausa

# ===========================================================================
titulo "2. ROLLBACK — falha no PAGAMENTO (passo 4)"
# ===========================================================================

passo "2.1 Nova OS, agora com falha forçada no provedor de pagamento"
abrir_os ',
    "simularFalhaPagamento": true'
OS_FALHA_PAG="$OS_ID"
esperar_status "$OS_FALHA_PAG" "AGUARDANDO_APROVACAO"
pausa

passo "2.2 O cliente aprova — e o pagamento é recusado"
req POST "$OS_URL/ordens-servico/$OS_FALHA_PAG/aprovacao" '{"aprovado": true}'
esperar_status "$OS_FALHA_PAG" "CANCELADA"
pausa

passo "2.3 A Saga compensou: o orçamento foi CANCELADO e nada foi cobrado"
req GET "$OS_URL/ordens-servico/$OS_FALHA_PAG"
req GET "$BILLING_URL/orcamentos/ordem-servico/$OS_FALHA_PAG"
nota "Compensou só o passo 2: o passo 5 nunca aconteceu, não há o que desfazer."
pausa

# ===========================================================================
titulo "3. ROLLBACK — falha na EXECUÇÃO (passo 5), o caso mais instrutivo"
# ===========================================================================

passo "3.1 Nova OS, agora com falha forçada na oficina"
abrir_os ',
    "simularFalhaExecucao": true'
OS_FALHA_EXEC="$OS_ID"
esperar_status "$OS_FALHA_EXEC" "AGUARDANDO_APROVACAO"
pausa

passo "3.2 Cliente aprova, o pagamento PASSA, e aí a oficina recusa"
req POST "$OS_URL/ordens-servico/$OS_FALHA_EXEC/aprovacao" '{"aprovado": true}'
esperar_status "$OS_FALHA_EXEC" "CANCELADA"
pausa

passo "3.3 Compensação em ORDEM INVERSA: primeiro estorna, depois cancela"
req GET "$BILLING_URL/pagamentos/ordem-servico/$OS_FALHA_EXEC"
nota "pagamento ESTORNADO — o dinheiro voltou"
req GET "$BILLING_URL/orcamentos/ordem-servico/$OS_FALHA_EXEC"
nota "orçamento CANCELADO depois do estorno: é o documento que o justifica"
req GET "$OS_URL/ordens-servico/$OS_FALHA_EXEC"
nota "OS CANCELADA e Saga COMPENSADA: passo 5 FALHOU, passos 4, 2 e 1 COMPENSADOS"
pausa

# ===========================================================================
titulo "4. RASTREAMENTO DO FLUXO DISTRIBUÍDO"
# ===========================================================================

echo
echo "    O correlation id da última Saga:"
echo "${VERDE}      $CORRELACAO${FIM}"
echo
echo "    Ele aparece nos logs dos TRÊS serviços. Para mostrar no vídeo:"
echo
echo "${CINZA}      docker compose -f ../fiap-tc-ms-os/docker-compose.yml logs ms-os | grep $CORRELACAO${FIM}"
echo "${CINZA}      docker compose -f ../fiap-tc-ms-billing/docker-compose.yml logs | grep $CORRELACAO${FIM}"
echo "${CINZA}      docker compose -f ../fiap-tc-ms-execucao/docker-compose.yml logs | grep $CORRELACAO${FIM}"
echo
echo "    E no New Relic (com NEW_RELIC_LICENSE_KEY preenchida nos três .env):"
echo "${CINZA}      Distributed tracing > o trace cruzando ms-os, ms-billing e ms-execucao${FIM}"
echo "${CINZA}      Logs > filtro por correlationId${FIM}"
echo
echo "${VERDE}Fim da demonstração.${FIM}"
echo
