// BDD (Behavior-Driven Development) com Gherkin em portugues, conforme a Aula 4
// de "Estrutura de Microsservicos - Parte II": Dado / Quando / Entao.
module.exports = {
  default: {
    require: ["tests/bdd/steps/**/*.ts"],
    requireModule: ["ts-node/register"],
    paths: ["tests/bdd/features/**/*.feature"],
    format: ["progress-bar", "summary", "html:tests/bdd/report.html"],
    formatOptions: { snippetInterface: "async-await" },
    publishQuiet: true,
  },
};
