import Cliente from "../../entity/Cliente";
import ErroDominio from "../../ErroDominio";
import ClienteRepository from "../../repository/ClienteRepository";

export type InputCriarCliente = {
  documento: string;
  nome: string;
  email?: string;
  telefone?: string;
};

// Casos de uso de cliente agrupados em um unico servico de aplicacao.
//
// Na Fase 3 havia cinco classes de um metodo cada (Criar, Obter, Listar,
// Atualizar, Excluir). Agrupa-las reduz a cerimonia sem perder a separacao de
// camadas: o dominio continua isolado da infraestrutura pela interface do
// repositorio.
export default class GerenciarClienteUseCase {
  constructor(private readonly clienteRepository: ClienteRepository) {}

  async criar(input: InputCriarCliente) {
    const cliente = new Cliente(input);

    const existente = await this.clienteRepository.obterPorDocumento(
      cliente.documento.getValue(),
    );
    if (existente) {
      throw ErroDominio.conflito(
        "cliente.documento.duplicado",
        "Ja existe um cliente com este documento.",
      );
    }

    await this.clienteRepository.salvar(cliente);
    return this.apresentar(cliente);
  }

  async obter(id: string) {
    const cliente = await this.clienteRepository.obter(id);
    if (!cliente) {
      throw ErroDominio.naoEncontrado(
        "cliente.nao.encontrado",
        "Cliente nao encontrado.",
      );
    }
    return this.apresentar(cliente);
  }

  async listar() {
    const clientes = await this.clienteRepository.listar();
    return clientes.map((cliente) => this.apresentar(cliente));
  }

  async atualizar(
    id: string,
    dados: { nome?: string; email?: string; telefone?: string },
  ) {
    const cliente = await this.clienteRepository.obter(id);
    if (!cliente) {
      throw ErroDominio.naoEncontrado(
        "cliente.nao.encontrado",
        "Cliente nao encontrado.",
      );
    }

    cliente.atualizar(dados);
    await this.clienteRepository.atualizar(cliente);
    return this.apresentar(cliente);
  }

  // Exclusao logica: o historico de ordens de servico precisa continuar
  // apontando para um cliente existente.
  async inativar(id: string) {
    const cliente = await this.clienteRepository.obter(id);
    if (!cliente) {
      throw ErroDominio.naoEncontrado(
        "cliente.nao.encontrado",
        "Cliente nao encontrado.",
      );
    }

    cliente.inativar();
    await this.clienteRepository.atualizar(cliente);
    return this.apresentar(cliente);
  }

  private apresentar(cliente: Cliente) {
    return {
      id: cliente.id.getValue(),
      documento: cliente.documento.formatado(),
      nome: cliente.nome,
      email: cliente.email?.getValue(),
      telefone: cliente.telefone,
      status: cliente.status,
    };
  }
}
