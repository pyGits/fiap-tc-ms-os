import path from "path";
import swaggerJsdoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "FIAP Tech Challenge - OS Service",
      version: "1.0.0",
      description: [
        "Microsservico de Ordem de Servico da oficina mecanica.",
        "",
        "Responsabilidades:",
        "- contexto delimitado de Ordem de Servico, clientes, veiculos e catalogo;",
        "- ORQUESTRADOR da Saga de abertura/execucao da OS.",
        "",
        "Fluxo assincrono: a abertura da OS responde 202 e os passos seguintes",
        "acontecem por mensageria. Acompanhe o estado da transacao distribuida",
        "em GET /ordens-servico/{id}, que devolve o saga log completo.",
      ].join("\n"),
    },
    servers: [{ url: "/", description: "Servidor atual" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: {
        // Formato de erro unico para os tres microsservicos (Aula 4 de
        // "Estrutura de Microsservicos": padronizacao de respostas de erro).
        Erro: {
          type: "object",
          properties: {
            erro: {
              type: "object",
              properties: {
                codigo: { type: "string", example: "os.transicao.invalida" },
                descricao: {
                  type: "string",
                  example: "Transicao invalida: RECEBIDA -> ENTREGUE.",
                },
              },
            },
          },
        },
      },
    },
  },
  // Resolve a partir do __dirname para funcionar tanto rodando o TS (dev e
  // testes) quanto o JS compilado no container.
  // O glob do swagger-jsdoc exige barras normais, inclusive no Windows; sem a
  // normalizacao a lista de rotas volta vazia em desenvolvimento local.
  apis: [
    path.join(__dirname, "routes", "*.js").split(path.sep).join("/"),
    path.join(__dirname, "routes", "*.ts").split(path.sep).join("/"),
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
export default swaggerSpec;
