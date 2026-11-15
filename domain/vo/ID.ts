import { randomUUID } from "crypto";
import ErroDominio from "../ErroDominio";

export default class ID {
  private readonly value: string;

  constructor(value?: string) {
    this.value = value ?? randomUUID();
    this.validate();
  }

  private validate() {
    if (!this.value || this.value.trim().length === 0) {
      throw new ErroDominio("id.invalido", "ID invalido.");
    }
  }

  getValue(): string {
    return this.value;
  }

  equals(other: ID): boolean {
    return this.value === other.getValue();
  }
}
