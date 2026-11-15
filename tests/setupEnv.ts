// Variaveis de ambiente dos testes.
//
// Carregado por setupFiles ANTES dos modulos da aplicacao: o middleware de
// autenticacao avalia AUTH_DISABLED no momento do import, portanto definir a
// variavel dentro do arquivo de teste seria tarde demais.
//
// A autenticacao real (Cognito via Function Serverless) continua exercitada no
// repositorio fiap-tc-lambda-auth, herdado da Fase 3.
process.env.AUTH_DISABLED = "true";
process.env.NODE_ENV = "test";
process.env.APP_ENV = "test";
// Sem licenca, o gateway de telemetria apenas registra em log.
delete process.env.NEW_RELIC_LICENSE_KEY;
// Silencia os logs estruturados durante os testes: o que importa aqui sao as
// asserçoes, nao o ruido no terminal.
process.env.LOG_LEVEL = "silent";
