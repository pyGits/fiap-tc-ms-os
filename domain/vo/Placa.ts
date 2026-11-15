import ErroDominio from "../ErroDominio";

// Aceita o padrao antigo (ABC1234) e o Mercosul (ABC1D23).
const PADRAO_ANTIGO = /^[A-Z]{3}[0-9]{4}$/;
const PADRAO_MERCOSUL = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/;

export default class Placa {
  private readonly value: string;

  constructor(value: string) {
    this.value = (value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

    if (!PADRAO_ANTIGO.test(this.value) && !PADRAO_MERCOSUL.test(this.value)) {
      throw new ErroDominio(
        "placa.invalida",
        "Placa invalida. Use o padrao ABC1234 ou ABC1D23.",
      );
    }
  }

  getValue(): string {
    return this.value;
  }

  isMercosul(): boolean {
    return PADRAO_MERCOSUL.test(this.value);
  }
}
