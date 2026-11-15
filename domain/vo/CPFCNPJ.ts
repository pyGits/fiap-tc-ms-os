import ErroDominio from "../ErroDominio";

// Documento do cliente (CPF ou CNPJ), com validacao dos digitos verificadores.
export default class CPFCNPJ {
  private readonly value: string;

  constructor(value: string) {
    this.value = (value || "").replace(/\D/g, "");
    this.validar();
  }

  private validar() {
    if (this.value.length === 11) {
      if (!CPFCNPJ.cpfValido(this.value)) {
        throw new ErroDominio("documento.cpf.invalido", "CPF invalido.");
      }
      return;
    }

    if (this.value.length === 14) {
      if (!CPFCNPJ.cnpjValido(this.value)) {
        throw new ErroDominio("documento.cnpj.invalido", "CNPJ invalido.");
      }
      return;
    }

    throw new ErroDominio(
      "documento.invalido",
      "Documento deve ter 11 (CPF) ou 14 (CNPJ) digitos.",
    );
  }

  private static cpfValido(cpf: string): boolean {
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    const digito = (ate: number): number => {
      let soma = 0;
      for (let i = 0; i < ate; i++) {
        soma += Number(cpf[i]) * (ate + 1 - i);
      }
      const resto = (soma * 10) % 11;
      return resto === 10 ? 0 : resto;
    };

    return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
  }

  private static cnpjValido(cnpj: string): boolean {
    if (/^(\d)\1{13}$/.test(cnpj)) return false;

    const digito = (ate: number): number => {
      const pesos =
        ate === 12
          ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
          : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      let soma = 0;
      for (let i = 0; i < ate; i++) {
        soma += Number(cnpj[i]) * pesos[i];
      }
      const resto = soma % 11;
      return resto < 2 ? 0 : 11 - resto;
    };

    return digito(12) === Number(cnpj[12]) && digito(13) === Number(cnpj[13]);
  }

  getValue(): string {
    return this.value;
  }

  isCPF(): boolean {
    return this.value.length === 11;
  }

  formatado(): string {
    if (this.isCPF()) {
      return this.value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    }
    return this.value.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      "$1.$2.$3/$4-$5",
    );
  }

  // Objeto de valor: a identidade e o proprio valor, por isso a comparacao e
  // por conteudo e nao por referencia.
  igual(outro: CPFCNPJ): boolean {
    return this.value === outro.getValue();
  }
}
