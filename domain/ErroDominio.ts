// Erro de negocio com codigo e status HTTP, seguindo o formato de erro
// recomendado na Aula 4 de "Modelo API para microsservicos":
//   { "erro": { "codigo": "...", "descricao": "..." } }
export default class ErroDominio extends Error {
  readonly codigo: string;
  readonly status: number;

  constructor(codigo: string, mensagem: string, status = 400) {
    super(mensagem);
    this.name = "ErroDominio";
    this.codigo = codigo;
    this.status = status;
    Object.setPrototypeOf(this, ErroDominio.prototype);
  }

  static naoEncontrado(codigo: string, mensagem: string): ErroDominio {
    return new ErroDominio(codigo, mensagem, 404);
  }

  static conflito(codigo: string, mensagem: string): ErroDominio {
    return new ErroDominio(codigo, mensagem, 409);
  }
}
