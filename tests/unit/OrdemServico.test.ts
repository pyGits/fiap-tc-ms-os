import OrdemServico, {
  StatusOrdemServico,
} from "../../domain/entity/OrdemServico";
import ItemOrdemServico, { TipoItem } from "../../domain/entity/ItemOrdemServico";
import ErroDominio from "../../domain/ErroDominio";

function novaOrdem(): OrdemServico {
  const ordem = new OrdemServico(undefined, "cliente-1", "veiculo-1");
  ordem.definirItens([
    new ItemOrdemServico({
      referenciaId: "srv-revisao",
      descricao: "Revisao completa",
      tipo: TipoItem.SERVICO,
      quantidade: 1,
      valorUnitario: 450,
    }),
    new ItemOrdemServico({
      referenciaId: "pec-filtro-oleo",
      descricao: "Filtro de oleo",
      tipo: TipoItem.PECA,
      quantidade: 2,
      valorUnitario: 65.5,
    }),
  ]);
  return ordem;
}

// Leva a OS ate o status pedido pelo caminho feliz completo.
function avancarAte(ordem: OrdemServico, destino: StatusOrdemServico) {
  ordem.iniciarDiagnostico();
  if (destino === StatusOrdemServico.EM_DIAGNOSTICO) return;

  ordem.registrarOrcamentoGerado("orc-1", ordem.valorTotal);
  if (destino === StatusOrdemServico.AGUARDANDO_APROVACAO) return;

  ordem.aprovarOrcamento();
  if (destino === StatusOrdemServico.AGUARDANDO_PAGAMENTO) return;

  ordem.registrarPagamento("pag-1");
  ordem.registrarExecucaoIniciada("exec-1");
  if (destino === StatusOrdemServico.EM_EXECUCAO) return;

  ordem.finalizar();
  if (destino === StatusOrdemServico.FINALIZADA) return;

  ordem.entregar();
}

describe("OrdemServico", () => {
  it("nasce RECEBIDA e registra a transicao inicial", () => {
    const ordem = novaOrdem();

    expect(ordem.status).toBe(StatusOrdemServico.RECEBIDA);
    expect(ordem.transicoesPendentes).toHaveLength(1);
    expect(ordem.transicoesPendentes[0].statusAnterior).toBeNull();
  });

  it("exige cliente e veiculo", () => {
    expect(() => new OrdemServico(undefined, "", "veiculo-1")).toThrow(
      ErroDominio,
    );
    expect(() => new OrdemServico(undefined, "cliente-1", "")).toThrow(
      ErroDominio,
    );
  });

  it("calcula o valor total somando quantidade x valor unitario", () => {
    const ordem = novaOrdem();
    // 450 + (2 x 65,50) = 581,00
    expect(ordem.valorTotal).toBe(581);
  });

  it("percorre o fluxo completo ate ENTREGUE", () => {
    const ordem = novaOrdem();
    avancarAte(ordem, StatusOrdemServico.ENTREGUE);

    expect(ordem.status).toBe(StatusOrdemServico.ENTREGUE);
    expect(ordem.estaEmEstadoFinal()).toBe(true);
    expect(ordem.dataFimExecucao).toBeInstanceOf(Date);
  });

  it("recusa transicao invalida com status 409", () => {
    const ordem = novaOrdem();

    try {
      ordem.entregar();
      fail("deveria ter lancado ErroDominio");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroDominio);
      expect((erro as ErroDominio).codigo).toBe("os.transicao.invalida");
      expect((erro as ErroDominio).status).toBe(409);
    }
  });

  it("guarda os identificadores dos agregados dos outros servicos", () => {
    const ordem = novaOrdem();
    ordem.iniciarDiagnostico();
    ordem.registrarOrcamentoGerado("orc-99", 999);

    expect(ordem.orcamentoId).toBe("orc-99");
    expect(ordem.valorTotal).toBe(999);
    expect(ordem.status).toBe(StatusOrdemServico.AGUARDANDO_APROVACAO);
  });

  it("registra a recusa do orcamento com o motivo", () => {
    const ordem = novaOrdem();
    ordem.iniciarDiagnostico();
    ordem.registrarOrcamentoGerado("orc-1", 581);
    ordem.recusarOrcamento("Cliente achou caro");

    expect(ordem.status).toBe(StatusOrdemServico.RECUSADA);
    expect(ordem.motivoRecusa).toBe("Cliente achou caro");
    expect(ordem.estaEmEstadoFinal()).toBe(true);
  });

  // Cancelamento e o efeito da COMPENSACAO do primeiro passo da Saga.
  it("permite cancelar enquanto a OS nao esta em estado final", () => {
    const ordem = novaOrdem();
    ordem.iniciarDiagnostico();
    ordem.cancelar("Falha no pagamento");

    expect(ordem.status).toBe(StatusOrdemServico.CANCELADA);
    expect(ordem.motivoCancelamento).toBe("Falha no pagamento");
  });

  it("nao cancela uma OS ja entregue", () => {
    const ordem = novaOrdem();
    avancarAte(ordem, StatusOrdemServico.ENTREGUE);

    expect(() => ordem.cancelar("tarde demais")).toThrow(ErroDominio);
  });

  it("hidratarStatus nao gera transicao (reidratacao do repositorio)", () => {
    const ordem = novaOrdem();
    ordem.hidratarStatus(StatusOrdemServico.EM_EXECUCAO);

    expect(ordem.status).toBe(StatusOrdemServico.EM_EXECUCAO);
    expect(ordem.transicoesPendentes).toHaveLength(0);
  });

  it("consumirTransicoesPendentes esvazia a lista", () => {
    const ordem = novaOrdem();
    ordem.iniciarDiagnostico();

    const transicoes = ordem.consumirTransicoesPendentes();

    expect(transicoes.length).toBeGreaterThan(0);
    expect(ordem.transicoesPendentes).toHaveLength(0);
  });

  it("podeTransitarPara reflete o mapa de transicoes validas", () => {
    const ordem = novaOrdem();

    expect(ordem.podeTransitarPara(StatusOrdemServico.EM_DIAGNOSTICO)).toBe(true);
    expect(ordem.podeTransitarPara(StatusOrdemServico.ENTREGUE)).toBe(false);
  });

  it("adicionarItem recalcula o total", () => {
    const ordem = novaOrdem();
    ordem.adicionarItem(
      new ItemOrdemServico({
        referenciaId: "ins-oleo-5w30",
        descricao: "Oleo 5W30",
        tipo: TipoItem.INSUMO,
        quantidade: 4,
        valorUnitario: 48.9,
      }),
    );

    expect(ordem.valorTotal).toBe(776.6);
  });
});

describe("ItemOrdemServico", () => {
  it("calcula o total do item", () => {
    const item = new ItemOrdemServico({
      referenciaId: "pec-1",
      descricao: "Pastilha",
      tipo: TipoItem.PECA,
      quantidade: 3,
      valorUnitario: 289.9,
    });

    expect(item.getTotal()).toBe(869.7);
  });

  it.each([
    ["descricao vazia", { descricao: "  ", quantidade: 1, valorUnitario: 10 }],
    ["quantidade zero", { descricao: "Item", quantidade: 0, valorUnitario: 10 }],
    ["valor negativo", { descricao: "Item", quantidade: 1, valorUnitario: -1 }],
  ])("rejeita %s", (_caso, dados) => {
    expect(
      () =>
        new ItemOrdemServico({
          referenciaId: "x",
          tipo: TipoItem.PECA,
          ...dados,
        }),
    ).toThrow(ErroDominio);
  });
});
