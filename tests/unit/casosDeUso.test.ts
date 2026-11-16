import Cliente from "../../domain/entity/Cliente";
import Veiculo from "../../domain/entity/Veiculo";
import { StatusOrdemServico } from "../../domain/entity/OrdemServico";
import ErroDominio from "../../domain/ErroDominio";
import { criarContainer, Container } from "../../src/container";
import MensageriaGatewayMemoria from "../../domain/gateway/Mock/MensageriaGatewayMemoria";
import { EstadoSaga } from "../../domain/saga/SagaOrdemServico";

const DOCUMENTO = "52998224725";

async function semear(container: Container) {
  const cliente = new Cliente({
    documento: DOCUMENTO,
    nome: "Cliente Demonstracao",
    email: "cliente.demo@oficina.local",
  });
  await container.clienteRepository.salvar(cliente);

  const veiculo = new Veiculo({
    placa: "ABC1D23",
    clienteId: cliente.id.getValue(),
    marca: "Volkswagen",
    modelo: "Gol",
    ano: 2019,
  });
  await container.veiculoRepository.salvar(veiculo);

  return { cliente, veiculo };
}

function novoContainer() {
  // Container sem `db`: todos os adaptadores em memoria.
  return criarContainer();
}

describe("AbrirOrdemServicoUseCase", () => {
  it("abre a OS, inicia a Saga e devolve o valor estimado", async () => {
    const container = novoContainer();
    const { cliente, veiculo } = await semear(container);

    const resultado = await container.abrirOrdemServico.execute({
      clienteId: cliente.id.getValue(),
      veiculoId: veiculo.id.getValue(),
      itens: [
        { id: "srv-revisao", quantidade: 1 },
        { id: "pec-filtro-oleo", quantidade: 2 },
      ],
      correlationId: "corr-1",
    });

    expect(resultado.status).toBe(StatusOrdemServico.RECEBIDA);
    expect(resultado.valorEstimado).toBe(581);
    expect(resultado.sagaId).toBeTruthy();

    const mensageria = container.mensageria as MensageriaGatewayMemoria;
    expect(mensageria.tipos()).toContain("GERAR_ORCAMENTO");
  });

  it("rejeita cliente inexistente", async () => {
    const container = novoContainer();
    const { veiculo } = await semear(container);

    await expect(
      container.abrirOrdemServico.execute({
        clienteId: "nao-existe",
        veiculoId: veiculo.id.getValue(),
        itens: [{ id: "srv-revisao", quantidade: 1 }],
        correlationId: "corr-1",
      }),
    ).rejects.toThrow(ErroDominio);
  });

  it("rejeita cliente inativo", async () => {
    const container = novoContainer();
    const { cliente, veiculo } = await semear(container);

    cliente.inativar();
    await container.clienteRepository.atualizar(cliente);

    await expect(
      container.abrirOrdemServico.execute({
        clienteId: cliente.id.getValue(),
        veiculoId: veiculo.id.getValue(),
        itens: [{ id: "srv-revisao", quantidade: 1 }],
        correlationId: "corr-1",
      }),
    ).rejects.toThrow("Cliente esta inativo.");
  });

  it("rejeita veiculo que pertence a outro cliente", async () => {
    const container = novoContainer();
    const { cliente } = await semear(container);

    const outroCliente = new Cliente({
      documento: "11222333000181",
      nome: "Oficina Parceira",
    });
    await container.clienteRepository.salvar(outroCliente);

    const veiculoDeOutro = new Veiculo({
      placa: "XYZ9K88",
      clienteId: outroCliente.id.getValue(),
      marca: "Fiat",
      modelo: "Uno",
      ano: 2015,
    });
    await container.veiculoRepository.salvar(veiculoDeOutro);

    await expect(
      container.abrirOrdemServico.execute({
        clienteId: cliente.id.getValue(),
        veiculoId: veiculoDeOutro.id.getValue(),
        itens: [{ id: "srv-revisao", quantidade: 1 }],
        correlationId: "corr-1",
      }),
    ).rejects.toThrow(ErroDominio);
  });

  it("exige ao menos um item", async () => {
    const container = novoContainer();
    const { cliente, veiculo } = await semear(container);

    await expect(
      container.abrirOrdemServico.execute({
        clienteId: cliente.id.getValue(),
        veiculoId: veiculo.id.getValue(),
        itens: [],
        correlationId: "corr-1",
      }),
    ).rejects.toThrow(ErroDominio);
  });

  it("rejeita item fora do catalogo", async () => {
    const container = novoContainer();
    const { cliente, veiculo } = await semear(container);

    await expect(
      container.abrirOrdemServico.execute({
        clienteId: cliente.id.getValue(),
        veiculoId: veiculo.id.getValue(),
        itens: [{ id: "srv-inexistente", quantidade: 1 }],
        correlationId: "corr-1",
      }),
    ).rejects.toThrow(ErroDominio);
  });

  // Recusar cedo (antes da Saga comecar) e mais barato do que compensar
  // depois - a mesma logica que motiva a contramedida Pessimistic View.
  it("rejeita quantidade acima do estoque disponivel", async () => {
    const container = novoContainer();
    const { cliente, veiculo } = await semear(container);

    await expect(
      container.abrirOrdemServico.execute({
        clienteId: cliente.id.getValue(),
        veiculoId: veiculo.id.getValue(),
        itens: [{ id: "pec-pastilha-freio", quantidade: 999 }],
        correlationId: "corr-1",
      }),
    ).rejects.toThrow("Estoque insuficiente");
  });

  it("persiste as flags de simulacao de falha nos dados da Saga", async () => {
    const container = novoContainer();
    const { cliente, veiculo } = await semear(container);

    const resultado = await container.abrirOrdemServico.execute({
      clienteId: cliente.id.getValue(),
      veiculoId: veiculo.id.getValue(),
      itens: [{ id: "srv-revisao", quantidade: 1 }],
      correlationId: "corr-1",
      simularFalhaPagamento: true,
    });

    const saga = await container.sagaRepository.obter(resultado.sagaId);
    expect(saga?.dados.simularFalhaPagamento).toBe(true);
    expect(saga?.dados.simularFalhaExecucao).toBe(false);
  });

  // REGRESSAO: as flags chegavam ao participante apenas quando a instancia da
  // Saga continuava em memoria. Os passos 4 e 5 recarregam a Saga do banco
  // antes de publicar o comando, portanto uma flag registrada DEPOIS do
  // primeiro `salvar` era perdida - e os dois rollbacks da demonstracao nunca
  // disparavam, mesmo com a suite verde.
  it("repassa simularFalhaPagamento no comando REGISTRAR_PAGAMENTO", async () => {
    const container = novoContainer();
    const { cliente, veiculo } = await semear(container);
    const mensageria = container.mensageria as MensageriaGatewayMemoria;

    const aberta = await container.abrirOrdemServico.execute({
      clienteId: cliente.id.getValue(),
      veiculoId: veiculo.id.getValue(),
      itens: [{ id: "srv-revisao", quantidade: 1 }],
      correlationId: "corr-1",
      simularFalhaPagamento: true,
    });

    await container.orquestrador.orcamentoGerado(aberta.sagaId, "orc-1", 450);
    await container.decidirOrcamento.execute({
      ordemServicoId: aberta.ordemServicoId,
      aprovado: true,
    });

    const comando = mensageria.enviadas.find(
      (m) => m.tipo === "REGISTRAR_PAGAMENTO",
    );
    expect(comando?.body.simularFalha).toBe(true);
  });

  it("repassa simularFalhaExecucao no comando ENFILEIRAR_EXECUCAO", async () => {
    const container = novoContainer();
    const { cliente, veiculo } = await semear(container);
    const mensageria = container.mensageria as MensageriaGatewayMemoria;

    const aberta = await container.abrirOrdemServico.execute({
      clienteId: cliente.id.getValue(),
      veiculoId: veiculo.id.getValue(),
      itens: [{ id: "srv-revisao", quantidade: 1 }],
      correlationId: "corr-1",
      simularFalhaExecucao: true,
    });

    await container.orquestrador.orcamentoGerado(aberta.sagaId, "orc-1", 450);
    await container.decidirOrcamento.execute({
      ordemServicoId: aberta.ordemServicoId,
      aprovado: true,
    });
    await container.orquestrador.pagamentoRegistrado(aberta.sagaId, "pag-1");

    const comando = mensageria.enviadas.find(
      (m) => m.tipo === "ENFILEIRAR_EXECUCAO",
    );
    expect(comando?.body.simularFalha).toBe(true);

    // O pagamento do mesmo fluxo NAO deve ser afetado: so o passo indicado
    // falha, caso contrario a demonstracao mostraria o rollback errado.
    const pagamento = mensageria.enviadas.find(
      (m) => m.tipo === "REGISTRAR_PAGAMENTO",
    );
    expect(pagamento?.body.simularFalha).toBe(false);
  });
});

describe("ConsultarOrdemServicoUseCase", () => {
  it("devolve a OS com o saga log", async () => {
    const container = novoContainer();
    const { cliente, veiculo } = await semear(container);

    const aberta = await container.abrirOrdemServico.execute({
      clienteId: cliente.id.getValue(),
      veiculoId: veiculo.id.getValue(),
      itens: [{ id: "srv-revisao", quantidade: 1 }],
      correlationId: "corr-1",
    });

    const consulta = await container.consultarOrdemServico.execute(
      aberta.ordemServicoId,
    );

    expect(consulta.id).toBe(aberta.ordemServicoId);
    expect(consulta.itens).toHaveLength(1);
    expect(consulta.saga?.estado).toBe(EstadoSaga.EM_ANDAMENTO);
    expect(consulta.saga?.passos.length).toBeGreaterThan(0);
  });

  it("404 para OS inexistente", async () => {
    const container = novoContainer();

    await expect(
      container.consultarOrdemServico.execute("nao-existe"),
    ).rejects.toThrow(ErroDominio);
  });
});

describe("ListarOrdensServicoUseCase e MonitorarTempoMedioUseCase", () => {
  it("filtra por status", async () => {
    const container = novoContainer();
    const { cliente, veiculo } = await semear(container);

    await container.abrirOrdemServico.execute({
      clienteId: cliente.id.getValue(),
      veiculoId: veiculo.id.getValue(),
      itens: [{ id: "srv-revisao", quantidade: 1 }],
      correlationId: "corr-1",
    });

    const recebidas = await container.listarOrdensServico.execute({
      status: "recebida",
    });
    const entregues = await container.listarOrdensServico.execute({
      status: "ENTREGUE",
    });

    expect(recebidas).toHaveLength(1);
    expect(entregues).toHaveLength(0);
  });

  it("devolve o tempo medio por status", async () => {
    const container = novoContainer();
    const { cliente, veiculo } = await semear(container);

    const aberta = await container.abrirOrdemServico.execute({
      clienteId: cliente.id.getValue(),
      veiculoId: veiculo.id.getValue(),
      itens: [{ id: "srv-revisao", quantidade: 1 }],
      correlationId: "corr-1",
    });

    const saga = await container.sagaRepository.obterPorOrdemServico(
      aberta.ordemServicoId,
    );
    await container.orquestrador.orcamentoGerado(
      saga!.id.getValue(),
      "orc-1",
      450,
    );

    const medias = await container.monitorarTempoMedio.execute();

    // O repositorio em memoria registra a duracao do status anterior a cada
    // transicao, exatamente como o adaptador MySQL faz com o historico.
    expect(Array.isArray(medias.tempoMedioPorStatus)).toBe(true);
    const recebida = medias.tempoMedioPorStatus.find(
      (item) => item.status === "RECEBIDA",
    );
    expect(recebida?.ordens).toBe(1);
    expect(recebida?.tempoMedioMs).toBeGreaterThanOrEqual(0);
  });
});

describe("GerenciarClienteUseCase", () => {
  it("cria, consulta, atualiza e inativa", async () => {
    const container = novoContainer();

    const criado = await container.gerenciarCliente.criar({
      documento: DOCUMENTO,
      nome: "Maria Silva",
      email: "maria@teste.local",
    });

    expect(criado.id).toBeTruthy();

    const atualizado = await container.gerenciarCliente.atualizar(criado.id, {
      telefone: "11988887777",
    });
    expect(atualizado.telefone).toBe("11988887777");

    const inativado = await container.gerenciarCliente.inativar(criado.id);
    expect(inativado.status).toBe("INATIVO");

    const lista = await container.gerenciarCliente.listar();
    expect(lista).toHaveLength(1);
  });

  it("rejeita documento duplicado", async () => {
    const container = novoContainer();
    await container.gerenciarCliente.criar({
      documento: DOCUMENTO,
      nome: "Maria Silva",
    });

    await expect(
      container.gerenciarCliente.criar({
        documento: DOCUMENTO,
        nome: "Outro Nome",
      }),
    ).rejects.toThrow(ErroDominio);
  });

  it("404 ao consultar cliente inexistente", async () => {
    const container = novoContainer();

    await expect(container.gerenciarCliente.obter("x")).rejects.toThrow(
      ErroDominio,
    );
  });
});

describe("GerenciarVeiculoUseCase", () => {
  it("cria e lista por cliente", async () => {
    const container = novoContainer();
    const { cliente } = await semear(container);

    const veiculo = await container.gerenciarVeiculo.criar({
      placa: "XYZ9K88",
      clienteId: cliente.id.getValue(),
      marca: "Fiat",
      modelo: "Argo",
      ano: 2022,
    });

    expect(veiculo.placa).toBe("XYZ9K88");

    const doCliente = await container.gerenciarVeiculo.listar(
      cliente.id.getValue(),
    );
    expect(doCliente.length).toBeGreaterThanOrEqual(1);
  });

  it("rejeita placa duplicada", async () => {
    const container = novoContainer();
    const { cliente } = await semear(container);

    await expect(
      container.gerenciarVeiculo.criar({
        placa: "ABC1D23",
        clienteId: cliente.id.getValue(),
        marca: "Fiat",
        modelo: "Argo",
        ano: 2022,
      }),
    ).rejects.toThrow(ErroDominio);
  });

  it("rejeita veiculo para cliente inexistente", async () => {
    const container = novoContainer();

    await expect(
      container.gerenciarVeiculo.criar({
        placa: "XYZ9K88",
        clienteId: "nao-existe",
        marca: "Fiat",
        modelo: "Argo",
        ano: 2022,
      }),
    ).rejects.toThrow(ErroDominio);
  });

  it("exclui veiculo", async () => {
    const container = novoContainer();
    const { veiculo } = await semear(container);

    await container.gerenciarVeiculo.excluir(veiculo.id.getValue());

    await expect(
      container.gerenciarVeiculo.obter(veiculo.id.getValue()),
    ).rejects.toThrow(ErroDominio);
  });
});

describe("GerenciarCatalogoUseCase", () => {
  it("cria servico sem estoque e peca com estoque", async () => {
    const container = novoContainer();

    const servico = await container.gerenciarCatalogo.criar({
      descricao: "Troca de correia dentada",
      tipo: "SERVICO",
      valorUnitario: 780,
    });
    expect(servico.estoque).toBeNull();

    const peca = await container.gerenciarCatalogo.criar({
      descricao: "Correia dentada",
      tipo: "PECA",
      valorUnitario: 210.9,
      estoque: 8,
    });
    expect(peca.estoque).toBe(8);
  });

  it.each([
    ["tipo invalido", { descricao: "X", tipo: "OUTRO", valorUnitario: 10 }],
    ["valor negativo", { descricao: "X", tipo: "PECA", valorUnitario: -5 }],
    ["descricao vazia", { descricao: " ", tipo: "PECA", valorUnitario: 10 }],
  ])("rejeita %s", async (_caso, dados) => {
    const container = novoContainer();

    await expect(
      container.gerenciarCatalogo.criar(dados as never),
    ).rejects.toThrow(ErroDominio);
  });

  it("atualiza, lista por tipo e exclui", async () => {
    const container = novoContainer();

    const atualizado = await container.gerenciarCatalogo.atualizar(
      "srv-revisao",
      { valorUnitario: 499.9 },
    );
    expect(atualizado.valorUnitario).toBe(499.9);

    const servicos = await container.gerenciarCatalogo.listar("SERVICO");
    expect(servicos.every((item) => item.tipo === "SERVICO")).toBe(true);

    await container.gerenciarCatalogo.excluir("srv-revisao");
    await expect(
      container.gerenciarCatalogo.obter("srv-revisao"),
    ).rejects.toThrow(ErroDominio);
  });
});

describe("FinalizarOrdemServicoUseCase e EntregarOrdemServicoUseCase", () => {
  async function ordemEmExecucao(container: Container) {
    const { cliente, veiculo } = await semear(container);

    const aberta = await container.abrirOrdemServico.execute({
      clienteId: cliente.id.getValue(),
      veiculoId: veiculo.id.getValue(),
      itens: [{ id: "srv-revisao", quantidade: 1 }],
      correlationId: "corr-1",
    });

    await container.orquestrador.orcamentoGerado(aberta.sagaId, "orc-1", 450);
    await container.orquestrador.aprovacaoRecebida(aberta.ordemServicoId, true);
    await container.orquestrador.pagamentoRegistrado(aberta.sagaId, "pag-1");
    await container.orquestrador.execucaoEnfileirada(aberta.sagaId, "exec-1");

    return aberta;
  }

  it("finaliza e entrega a OS", async () => {
    const container = novoContainer();
    const aberta = await ordemEmExecucao(container);

    const finalizada = await container.finalizarOrdemServico.execute({
      ordemServicoId: aberta.ordemServicoId,
      execucaoId: "exec-1",
    });
    expect(finalizada.status).toBe(StatusOrdemServico.FINALIZADA);

    const entregue = await container.entregarOrdemServico.execute({
      ordemServicoId: aberta.ordemServicoId,
    });
    expect(entregue.status).toBe(StatusOrdemServico.ENTREGUE);
  });

  it("404 ao finalizar OS inexistente", async () => {
    const container = novoContainer();

    await expect(
      container.finalizarOrdemServico.execute({ ordemServicoId: "x" }),
    ).rejects.toThrow(ErroDominio);
  });

  it("409 ao entregar OS que nao esta finalizada", async () => {
    const container = novoContainer();
    const { cliente, veiculo } = await semear(container);

    const aberta = await container.abrirOrdemServico.execute({
      clienteId: cliente.id.getValue(),
      veiculoId: veiculo.id.getValue(),
      itens: [{ id: "srv-revisao", quantidade: 1 }],
      correlationId: "corr-1",
    });

    await expect(
      container.entregarOrdemServico.execute({
        ordemServicoId: aberta.ordemServicoId,
      }),
    ).rejects.toThrow(ErroDominio);
  });
});

describe("DecidirOrcamentoUseCase", () => {
  it("rejeita payload sem o campo aprovado", async () => {
    const container = novoContainer();

    await expect(
      container.decidirOrcamento.execute({
        ordemServicoId: "x",
        aprovado: undefined as never,
      }),
    ).rejects.toThrow(ErroDominio);
  });

  it("aprova e devolve o novo status", async () => {
    const container = novoContainer();
    const { cliente, veiculo } = await semear(container);

    const aberta = await container.abrirOrdemServico.execute({
      clienteId: cliente.id.getValue(),
      veiculoId: veiculo.id.getValue(),
      itens: [{ id: "srv-revisao", quantidade: 1 }],
      correlationId: "corr-1",
    });
    await container.orquestrador.orcamentoGerado(aberta.sagaId, "orc-1", 450);

    const resultado = await container.decidirOrcamento.execute({
      ordemServicoId: aberta.ordemServicoId,
      aprovado: true,
    });

    expect(resultado.aprovado).toBe(true);
    expect(resultado.status).toBe(StatusOrdemServico.AGUARDANDO_PAGAMENTO);
  });

  it("recusa e deixa a OS como RECUSADA", async () => {
    const container = novoContainer();
    const { cliente, veiculo } = await semear(container);

    const aberta = await container.abrirOrdemServico.execute({
      clienteId: cliente.id.getValue(),
      veiculoId: veiculo.id.getValue(),
      itens: [{ id: "srv-revisao", quantidade: 1 }],
      correlationId: "corr-1",
    });
    await container.orquestrador.orcamentoGerado(aberta.sagaId, "orc-1", 450);

    const resultado = await container.decidirOrcamento.execute({
      ordemServicoId: aberta.ordemServicoId,
      aprovado: false,
      motivoRecusa: "Vou pensar",
    });

    expect(resultado.status).toBe(StatusOrdemServico.RECUSADA);
  });
});
