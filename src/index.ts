import "dotenv/config";

import criarApp from "./app";
import { criarContainer } from "./container";
import database from "./database";
import logger from "./logger";
import MessageConsumer from "./messaging/MessageConsumer";
import SagaReplyConsumer from "./messaging/SagaReplyConsumer";
import { rabbitMQConnection } from "./messaging/RabbitMQConnection";

const porta = Number(process.env.PORT || 3000);

// Composition Root da execucao real: MySQL + RabbitMQ + New Relic.
const container = criarContainer({ db: database });
const app = criarApp(container);

// Consumidor das respostas dos participantes da Saga.
//
// Este processo acumula os dois papeis: API REST (entrada sincrona do cliente)
// e orquestrador assincrono. Em um cenario de producao com carga alta eles
// seriam Deployments separados escalando de forma independente - o codigo ja
// permite, porque a unica diferenca e qual adaptador de entrada e iniciado.
const replyConsumer = new SagaReplyConsumer(
  container.orquestrador,
  new MessageConsumer(),
  async (ordemServicoId, execucaoId) => {
    await container.finalizarOrdemServico.execute({ ordemServicoId, execucaoId });
  },
);

async function iniciar() {
  const servidor = app.listen(porta, () => {
    logger.info({ porta, servico: "fiap-tc-ms-os" }, "aplicacao iniciada");
  });

  try {
    await replyConsumer.iniciar();
  } catch (erro) {
    // Sem mensageria o servico nao consegue cumprir seu papel de orquestrador:
    // falhar rapido faz o Kubernetes reiniciar o pod em vez de mante-lo "ok"
    // para o readiness probe enquanto Sagas ficam paradas.
    logger.error(
      { erro: erro instanceof Error ? erro.message : String(erro) },
      "falha ao iniciar o consumidor da Saga",
    );
    process.exitCode = 1;
    servidor.close();
    return;
  }

  // Encerramento gracioso: termina de processar o que esta em voo antes de
  // fechar conexoes, evitando Sagas em estado inconsistente no rolling update.
  const encerrar = async (sinal: string) => {
    logger.info({ sinal }, "encerrando aplicacao");
    servidor.close();
    await rabbitMQConnection.close();
    await database.destroy();
    process.exit(0);
  };

  process.on("SIGTERM", () => void encerrar("SIGTERM"));
  process.on("SIGINT", () => void encerrar("SIGINT"));
}

if (require.main === module) {
  void iniciar();
}

export { app, container };
export default app;
