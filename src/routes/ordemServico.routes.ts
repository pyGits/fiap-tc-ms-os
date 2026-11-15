import { Router } from "express";
import { Container } from "../container";
import { authMiddleware } from "../middleware/auth";
import { getCorrelationId } from "../context";

/**
 * @openapi
 * tags:
 *   - name: Ordens de Servico
 *     description: Abertura, acompanhamento e conclusao de ordens de servico (orquestrador da Saga)
 */
export default function criarOrdemServicoRoutes(container: Container): Router {
  const router = Router();

  /**
   * @openapi
   * /ordens-servico:
   *   post:
   *     summary: Abre uma ordem de servico e inicia a Saga
   *     description: |
   *       Executa o passo 1 da Saga (transacao local) e publica o comando
   *       GERAR_ORCAMENTO para o Billing Service. A resposta e imediata
   *       (HTTP 202): o restante do fluxo e assincrono e pode ser acompanhado
   *       em GET /ordens-servico/{id}.
   *     tags: [Ordens de Servico]
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [clienteId, veiculoId, itens]
   *             properties:
   *               clienteId: { type: string, format: uuid }
   *               veiculoId: { type: string, format: uuid }
   *               itens:
   *                 type: array
   *                 items:
   *                   type: object
   *                   required: [id, quantidade]
   *                   properties:
   *                     id: { type: string, example: srv-revisao }
   *                     quantidade: { type: integer, example: 1 }
   *               simularFalhaPagamento:
   *                 type: boolean
   *                 description: Forca falha no pagamento para demonstrar o rollback
   *               simularFalhaExecucao:
   *                 type: boolean
   *                 description: Forca falha na execucao para demonstrar o rollback
   *     responses:
   *       202: { description: Saga iniciada }
   *       404: { description: Cliente, veiculo ou item de catalogo inexistente }
   *       409: { description: Cliente inativo, veiculo de outro cliente ou estoque insuficiente }
   */
  router.post("/", authMiddleware, async (req, res, next) => {
    try {
      const resultado = await container.abrirOrdemServico.execute({
        clienteId: req.body?.clienteId,
        veiculoId: req.body?.veiculoId,
        itens: req.body?.itens,
        correlationId: getCorrelationId() ?? "",
        simularFalhaPagamento: req.body?.simularFalhaPagamento,
        simularFalhaExecucao: req.body?.simularFalhaExecucao,
      });

      // 202 Accepted e nao 201: a OS existe, mas a transacao de negocio
      // (a Saga) ainda esta em andamento nos outros servicos.
      res.status(202).json(resultado);
    } catch (erro) {
      next(erro);
    }
  });

  /**
   * @openapi
   * /ordens-servico:
   *   get:
   *     summary: Lista ordens de servico
   *     tags: [Ordens de Servico]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: status
   *         schema: { type: string, example: EM_EXECUCAO }
   *       - in: query
   *         name: clienteId
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Lista de ordens de servico }
   */
  router.get("/", authMiddleware, async (req, res, next) => {
    try {
      const ordens = await container.listarOrdensServico.execute({
        status: req.query.status as string | undefined,
        clienteId: req.query.clienteId as string | undefined,
      });
      res.json(ordens);
    } catch (erro) {
      next(erro);
    }
  });

  /**
   * @openapi
   * /ordens-servico/tempo-medio:
   *   get:
   *     summary: Tempo medio de permanencia em cada status
   *     description: Indicador de negocio reaproveitado dos dashboards da Fase 3.
   *     tags: [Ordens de Servico]
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Tempo medio por status }
   */
  router.get("/tempo-medio", authMiddleware, async (_req, res, next) => {
    try {
      res.json(await container.monitorarTempoMedio.execute());
    } catch (erro) {
      next(erro);
    }
  });

  /**
   * @openapi
   * /ordens-servico/{id}:
   *   get:
   *     summary: Consulta uma ordem de servico e o estado da sua Saga
   *     description: |
   *       Retorna a OS com seus itens e, quando existir, o saga log completo -
   *       estado atual, passo corrente e situacao de cada passo (inclusive os
   *       compensados). E a visao usada para demonstrar o rollback.
   *     tags: [Ordens de Servico]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Ordem de servico encontrada }
   *       404: { description: Ordem de servico nao encontrada }
   */
  router.get("/:id", authMiddleware, async (req, res, next) => {
    try {
      res.json(await container.consultarOrdemServico.execute(String(req.params.id)));
    } catch (erro) {
      next(erro);
    }
  });

  /**
   * @openapi
   * /ordens-servico/{id}/aprovacao:
   *   post:
   *     summary: Aprova ou recusa o orcamento (passo 3 da Saga)
   *     description: |
   *       Aprovacao: a Saga retoma e o comando REGISTRAR_PAGAMENTO e publicado.
   *       Recusa: a Saga entra em compensacao e desfaz os passos ja concluidos
   *       em ordem inversa.
   *     tags: [Ordens de Servico]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [aprovado]
   *             properties:
   *               aprovado: { type: boolean }
   *               motivoRecusa: { type: string }
   *     responses:
   *       200: { description: Decisao registrada }
   *       409: { description: A OS nao esta aguardando aprovacao }
   */
  router.post("/:id/aprovacao", authMiddleware, async (req, res, next) => {
    try {
      const resultado = await container.decidirOrcamento.execute({
        ordemServicoId: String(req.params.id),
        aprovado: req.body?.aprovado,
        motivoRecusa: req.body?.motivoRecusa,
      });
      res.json(resultado);
    } catch (erro) {
      next(erro);
    }
  });

  /**
   * @openapi
   * /ordens-servico/{id}/finalizacao:
   *   post:
   *     summary: Marca a OS como finalizada
   *     description: |
   *       Normalmente acionado pelo evento EXECUCAO_FINALIZADA publicado pelo
   *       servico de Execucao. Exposto tambem por REST para operacao manual.
   *     tags: [Ordens de Servico]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Ordem de servico finalizada }
   *       409: { description: Transicao de status invalida }
   */
  router.post("/:id/finalizacao", authMiddleware, async (req, res, next) => {
    try {
      const resultado = await container.finalizarOrdemServico.execute({
        ordemServicoId: String(req.params.id),
        execucaoId: req.body?.execucaoId,
      });
      res.json(resultado);
    } catch (erro) {
      next(erro);
    }
  });

  /**
   * @openapi
   * /ordens-servico/{id}/entrega:
   *   post:
   *     summary: Registra a entrega do veiculo ao cliente
   *     tags: [Ordens de Servico]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Veiculo entregue }
   *       409: { description: Transicao de status invalida }
   */
  router.post("/:id/entrega", authMiddleware, async (req, res, next) => {
    try {
      const resultado = await container.entregarOrdemServico.execute({
        ordemServicoId: String(req.params.id),
      });
      res.json(resultado);
    } catch (erro) {
      next(erro);
    }
  });

  return router;
}
