import CPFCNPJ from "../../domain/vo/CPFCNPJ";
import Email from "../../domain/vo/Email";
import Placa from "../../domain/vo/Placa";
import ID from "../../domain/vo/ID";
import Cliente, { StatusCliente } from "../../domain/entity/Cliente";
import Veiculo from "../../domain/entity/Veiculo";
import ErroDominio from "../../domain/ErroDominio";

// CPFs/CNPJs de teste gerados em gerador ficticio - nao correspondem a
// pessoas reais.
describe("CPFCNPJ", () => {
  it.each(["529.982.247-25", "52998224725"])(
    "aceita CPF valido (%s) e normaliza para digitos",
    (documento) => {
      expect(new CPFCNPJ(documento).getValue()).toBe("52998224725");
    },
  );

  it("aceita CNPJ valido", () => {
    expect(new CPFCNPJ("11.222.333/0001-81").getValue()).toBe("11222333000181");
  });

  it.each([
    ["digito verificador errado", "52998224726"],
    ["todos os digitos iguais", "11111111111"],
    ["tamanho invalido", "123"],
    ["vazio", ""],
    ["CNPJ invalido", "11222333000182"],
  ])("rejeita %s", (_caso, documento) => {
    expect(() => new CPFCNPJ(documento)).toThrow(ErroDominio);
  });

  it("formata CPF para exibicao", () => {
    expect(new CPFCNPJ("52998224725").formatado()).toBe("529.982.247-25");
  });

  it("compara dois documentos por valor", () => {
    expect(new CPFCNPJ("52998224725").igual(new CPFCNPJ("529.982.247-25"))).toBe(
      true,
    );
  });
});

describe("Email", () => {
  it("normaliza para minusculas", () => {
    expect(new Email("Cliente@Oficina.LOCAL").getValue()).toBe(
      "cliente@oficina.local",
    );
  });

  it.each(["sem-arroba", "@dominio.com", "cliente@", "cliente@dominio", ""])(
    "rejeita e-mail invalido (%s)",
    (valor) => {
      expect(() => new Email(valor)).toThrow(ErroDominio);
    },
  );
});

describe("Placa", () => {
  it("aceita placa Mercosul e normaliza", () => {
    expect(new Placa("abc1d23").getValue()).toBe("ABC1D23");
  });

  it("aceita placa no padrao antigo", () => {
    expect(new Placa("ABC-1234").getValue()).toBe("ABC1234");
  });

  it.each(["AB1234", "12345678", "ABCDEFG", ""])(
    "rejeita placa invalida (%s)",
    (valor) => {
      expect(() => new Placa(valor)).toThrow(ErroDominio);
    },
  );
});

describe("ID", () => {
  it("gera UUID quando nao recebe valor", () => {
    expect(new ID().getValue()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("preserva o valor recebido", () => {
    const valor = "11111111-1111-4111-8111-111111111111";
    expect(new ID(valor).getValue()).toBe(valor);
  });
});

describe("Cliente", () => {
  it("nasce ATIVO", () => {
    const cliente = new Cliente({ documento: "52998224725", nome: "Maria" });

    expect(cliente.estaAtivo()).toBe(true);
    expect(cliente.status).toBe(StatusCliente.ATIVO);
  });

  it("rejeita nome com menos de 3 caracteres", () => {
    expect(
      () => new Cliente({ documento: "52998224725", nome: "Jo" }),
    ).toThrow(ErroDominio);
  });

  it("atualiza dados de contato", () => {
    const cliente = new Cliente({ documento: "52998224725", nome: "Maria" });
    cliente.atualizar({ nome: "Maria Silva", email: "maria@teste.local" });

    expect(cliente.nome).toBe("Maria Silva");
    expect(cliente.email?.getValue()).toBe("maria@teste.local");
  });

  it("rejeita atualizacao com nome invalido", () => {
    const cliente = new Cliente({ documento: "52998224725", nome: "Maria" });

    expect(() => cliente.atualizar({ nome: "M" })).toThrow(ErroDominio);
  });

  it("inativa e reativa (exclusao logica)", () => {
    const cliente = new Cliente({ documento: "52998224725", nome: "Maria" });

    cliente.inativar();
    expect(cliente.estaAtivo()).toBe(false);

    cliente.ativar();
    expect(cliente.estaAtivo()).toBe(true);
  });
});

describe("Veiculo", () => {
  const base = {
    placa: "ABC1D23",
    clienteId: "cliente-1",
    marca: "Volkswagen",
    modelo: "Gol",
    ano: 2019,
  };

  it("monta a descricao legivel", () => {
    expect(new Veiculo(base).descricao()).toBe(
      "Volkswagen Gol 2019 (ABC1D23)",
    );
  });

  it("exige marca e modelo", () => {
    expect(() => new Veiculo({ ...base, marca: "" })).toThrow(ErroDominio);
    expect(() => new Veiculo({ ...base, modelo: "" })).toThrow(ErroDominio);
  });

  it.each([1899, 2.5, new Date().getFullYear() + 5])(
    "rejeita ano invalido (%s)",
    (ano) => {
      expect(() => new Veiculo({ ...base, ano })).toThrow(ErroDominio);
    },
  );
});
