import ErroDominio from "../ErroDominio";

export default class Email {
  private readonly value: string;

  constructor(value: string) {
    this.value = (value || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(this.value)) {
      throw new ErroDominio("email.invalido", "E-mail invalido.");
    }
  }

  getValue(): string {
    return this.value;
  }
}
