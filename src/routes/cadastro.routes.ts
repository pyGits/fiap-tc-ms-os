import { Router } from "express";
import { Container } from "../container";
import { authMiddleware } from "../middleware/auth";

/**
 * @openapi
 * tags:
 *   - name: Clientes
 *     description: Cadastro de clientes da oficina
 *   - name: Veiculos
 *     description: Cadastro de veiculos vinculados aos clientes
 *   - name: Catalogo
 *     description: Servicos, pecas e insumos cobraveis
 */

export function criarClienteRoutes(container: Container): Router {
  const router = Router();

  /**
   * @openapi
   * /clientes:
   *   post:
   *     summary: Cadastra um cliente
   *     tags: [Clientes]
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [documento, nome]
   *             properties:
   *               documento: { type: string, example: "52998224725" }
   *               nome: { type: string }
   *               email: { type: string, format: email }
   *               telefone: { type: string }
   *     responses:
   *       201: { description: Cliente criado }
   *       409: { description: Documento ja cadastrado }
   *   get:
   *     summary: Lista clientes
   *     tags: [Clientes]
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Lista de clientes }
   */
  router.post("/", authMiddleware, async (req, res, next) => {
    try {
      res.status(201).json(await container.gerenciarCliente.criar(req.body));
    } catch (erro) {
      next(erro);
    }
  });

  router.get("/", authMiddleware, async (_req, res, next) => {
    try {
      res.json(await container.gerenciarCliente.listar());
    } catch (erro) {
      next(erro);
    }
  });

  /**
   * @openapi
   * /clientes/{id}:
   *   get:
   *     summary: Consulta um cliente
   *     tags: [Clientes]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Cliente encontrado }
   *       404: { description: Cliente nao encontrado }
   *   put:
   *     summary: Atualiza um cliente
   *     tags: [Clientes]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Cliente atualizado }
   *       404: { description: Cliente nao encontrado }
   *   delete:
   *     summary: Inativa um cliente (exclusao logica)
   *     description: |
   *       A exclusao e logica porque o historico de ordens de servico precisa
   *       continuar apontando para um cliente existente.
   *     tags: [Clientes]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Cliente inativado }
   *       404: { description: Cliente nao encontrado }
   */
  router.get("/:id", authMiddleware, async (req, res, next) => {
    try {
      res.json(await container.gerenciarCliente.obter(String(req.params.id)));
    } catch (erro) {
      next(erro);
    }
  });

  router.put("/:id", authMiddleware, async (req, res, next) => {
    try {
      res.json(
        await container.gerenciarCliente.atualizar(String(req.params.id), req.body),
      );
    } catch (erro) {
      next(erro);
    }
  });

  router.delete("/:id", authMiddleware, async (req, res, next) => {
    try {
      res.json(await container.gerenciarCliente.inativar(String(req.params.id)));
    } catch (erro) {
      next(erro);
    }
  });

  return router;
}

export function criarVeiculoRoutes(container: Container): Router {
  const router = Router();

  /**
   * @openapi
   * /veiculos:
   *   post:
   *     summary: Cadastra um veiculo
   *     tags: [Veiculos]
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [placa, clienteId, marca, modelo, ano]
   *             properties:
   *               placa: { type: string, example: ABC1D23 }
   *               clienteId: { type: string, format: uuid }
   *               marca: { type: string }
   *               modelo: { type: string }
   *               ano: { type: integer, example: 2019 }
   *     responses:
   *       201: { description: Veiculo criado }
   *       404: { description: Cliente nao encontrado }
   *       409: { description: Placa ja cadastrada }
   *   get:
   *     summary: Lista veiculos
   *     tags: [Veiculos]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: clienteId
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Lista de veiculos }
   */
  router.post("/", authMiddleware, async (req, res, next) => {
    try {
      res.status(201).json(await container.gerenciarVeiculo.criar(req.body));
    } catch (erro) {
      next(erro);
    }
  });

  router.get("/", authMiddleware, async (req, res, next) => {
    try {
      res.json(
        await container.gerenciarVeiculo.listar(
          req.query.clienteId as string | undefined,
        ),
      );
    } catch (erro) {
      next(erro);
    }
  });

  /**
   * @openapi
   * /veiculos/{id}:
   *   get:
   *     summary: Consulta um veiculo
   *     tags: [Veiculos]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Veiculo encontrado }
   *       404: { description: Veiculo nao encontrado }
   *   delete:
   *     summary: Remove um veiculo
   *     tags: [Veiculos]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       204: { description: Veiculo removido }
   *       404: { description: Veiculo nao encontrado }
   */
  router.get("/:id", authMiddleware, async (req, res, next) => {
    try {
      res.json(await container.gerenciarVeiculo.obter(String(req.params.id)));
    } catch (erro) {
      next(erro);
    }
  });

  router.delete("/:id", authMiddleware, async (req, res, next) => {
    try {
      await container.gerenciarVeiculo.excluir(String(req.params.id));
      res.status(204).send();
    } catch (erro) {
      next(erro);
    }
  });

  return router;
}

export function criarCatalogoRoutes(container: Container): Router {
  const router = Router();

  /**
   * @openapi
   * /catalogo:
   *   post:
   *     summary: Cadastra um item cobravel (servico, peca ou insumo)
   *     tags: [Catalogo]
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [descricao, tipo, valorUnitario]
   *             properties:
   *               descricao: { type: string }
   *               tipo: { type: string, enum: [SERVICO, PECA, INSUMO] }
   *               valorUnitario: { type: number, example: 120.5 }
   *               estoque:
   *                 type: integer
   *                 nullable: true
   *                 description: Nulo para servicos; obrigatorio para pecas e insumos
   *     responses:
   *       201: { description: Item criado }
   *   get:
   *     summary: Lista os itens do catalogo
   *     tags: [Catalogo]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: tipo
   *         schema: { type: string, enum: [SERVICO, PECA, INSUMO] }
   *     responses:
   *       200: { description: Itens do catalogo }
   */
  router.post("/", authMiddleware, async (req, res, next) => {
    try {
      res.status(201).json(await container.gerenciarCatalogo.criar(req.body));
    } catch (erro) {
      next(erro);
    }
  });

  router.get("/", authMiddleware, async (req, res, next) => {
    try {
      res.json(
        await container.gerenciarCatalogo.listar(
          req.query.tipo as "SERVICO" | "PECA" | "INSUMO" | undefined,
        ),
      );
    } catch (erro) {
      next(erro);
    }
  });

  /**
   * @openapi
   * /catalogo/{id}:
   *   get:
   *     summary: Consulta um item do catalogo
   *     tags: [Catalogo]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Item encontrado }
   *       404: { description: Item nao encontrado }
   *   put:
   *     summary: Atualiza um item do catalogo
   *     tags: [Catalogo]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Item atualizado }
   *       404: { description: Item nao encontrado }
   *   delete:
   *     summary: Remove um item do catalogo
   *     tags: [Catalogo]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       204: { description: Item removido }
   *       404: { description: Item nao encontrado }
   */
  router.get("/:id", authMiddleware, async (req, res, next) => {
    try {
      res.json(await container.gerenciarCatalogo.obter(String(req.params.id)));
    } catch (erro) {
      next(erro);
    }
  });

  router.put("/:id", authMiddleware, async (req, res, next) => {
    try {
      res.json(
        await container.gerenciarCatalogo.atualizar(String(req.params.id), req.body),
      );
    } catch (erro) {
      next(erro);
    }
  });

  router.delete("/:id", authMiddleware, async (req, res, next) => {
    try {
      await container.gerenciarCatalogo.excluir(String(req.params.id));
      res.status(204).send();
    } catch (erro) {
      next(erro);
    }
  });

  return router;
}
