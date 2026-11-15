import type { Knex } from "knex";

import MensageriaGateway from "../domain/gateway/MensageriaGateway";
import TelemetriaGateway from "../domain/gateway/TelemetriaGateway";
import CatalogoRepository from "../domain/repository/CatalogoRepository";
import ClienteRepository from "../domain/repository/ClienteRepository";
import OrdemServicoRepository from "../domain/repository/OrdemServicoRepository";
import SagaRepository from "../domain/repository/SagaRepository";
import VeiculoRepository from "../domain/repository/VeiculoRepository";

import CatalogoRepositoryMySQL from "../domain/repository/MySQL/CatalogoRepositoryMySQL";
import ClienteRepositoryMySQL from "../domain/repository/MySQL/ClienteRepositoryMySQL";
import OrdemServicoRepositoryMySQL from "../domain/repository/MySQL/OrdemServicoRepositoryMySQL";
import SagaRepositoryMySQL from "../domain/repository/MySQL/SagaRepositoryMySQL";
import VeiculoRepositoryMySQL from "../domain/repository/MySQL/VeiculoRepositoryMySQL";

import CatalogoRepositoryMemoria from "../domain/repository/Mock/CatalogoRepositoryMemoria";
import ClienteRepositoryMemoria from "../domain/repository/Mock/ClienteRepositoryMemoria";
import OrdemServicoRepositoryMemoria from "../domain/repository/Mock/OrdemServicoRepositoryMemoria";
import SagaRepositoryMemoria from "../domain/repository/Mock/SagaRepositoryMemoria";
import VeiculoRepositoryMemoria from "../domain/repository/Mock/VeiculoRepositoryMemoria";
import MensageriaGatewayMemoria from "../domain/gateway/Mock/MensageriaGatewayMemoria";
import TelemetriaGatewayMemoria from "../domain/gateway/Mock/TelemetriaGatewayMemoria";

import SagaOrquestrador from "../domain/saga/SagaOrquestrador";
import AbrirOrdemServicoUseCase from "../domain/usecase/OrdemServico/AbrirOrdemServicoUseCase";
import ConsultarOrdemServicoUseCase from "../domain/usecase/OrdemServico/ConsultarOrdemServicoUseCase";
import DecidirOrcamentoUseCase from "../domain/usecase/OrdemServico/DecidirOrcamentoUseCase";
import EntregarOrdemServicoUseCase from "../domain/usecase/OrdemServico/EntregarOrdemServicoUseCase";
import FinalizarOrdemServicoUseCase from "../domain/usecase/OrdemServico/FinalizarOrdemServicoUseCase";
import ListarOrdensServicoUseCase from "../domain/usecase/OrdemServico/ListarOrdensServicoUseCase";
import MonitorarTempoMedioUseCase from "../domain/usecase/OrdemServico/MonitorarTempoMedioUseCase";
import GerenciarCatalogoUseCase from "../domain/usecase/Catalogo/GerenciarCatalogoUseCase";
import GerenciarClienteUseCase from "../domain/usecase/Cliente/GerenciarClienteUseCase";
import GerenciarVeiculoUseCase from "../domain/usecase/Veiculo/GerenciarVeiculoUseCase";

import RabbitMQMensageriaGateway from "./messaging/RabbitMQMensageriaGateway";
import telemetriaGateway from "./telemetry";

export type Container = {
  ordemServicoRepository: OrdemServicoRepository;
  sagaRepository: SagaRepository;
  clienteRepository: ClienteRepository;
  veiculoRepository: VeiculoRepository;
  catalogoRepository: CatalogoRepository;
  mensageria: MensageriaGateway;
  telemetria: TelemetriaGateway;
  orquestrador: SagaOrquestrador;
  abrirOrdemServico: AbrirOrdemServicoUseCase;
  decidirOrcamento: DecidirOrcamentoUseCase;
  consultarOrdemServico: ConsultarOrdemServicoUseCase;
  listarOrdensServico: ListarOrdensServicoUseCase;
  finalizarOrdemServico: FinalizarOrdemServicoUseCase;
  entregarOrdemServico: EntregarOrdemServicoUseCase;
  monitorarTempoMedio: MonitorarTempoMedioUseCase;
  gerenciarCliente: GerenciarClienteUseCase;
  gerenciarVeiculo: GerenciarVeiculoUseCase;
  gerenciarCatalogo: GerenciarCatalogoUseCase;
};

export type OpcoesContainer = {
  // Quando ausente, usa os adaptadores em memoria - e assim que os testes de
  // integracao e os cenarios BDD rodam a aplicacao inteira sem MySQL nem
  // RabbitMQ, trocando apenas as bordas.
  db?: Knex;
  mensageria?: MensageriaGateway;
  telemetria?: TelemetriaGateway;
};

// Composition Root: o unico lugar do servico que conhece, ao mesmo tempo, o
// dominio e a infraestrutura. As dependencias sempre apontam para dentro.
export function criarContainer(opcoes: OpcoesContainer = {}): Container {
  const usarMysql = Boolean(opcoes.db);

  const ordemServicoRepository: OrdemServicoRepository = opcoes.db
    ? new OrdemServicoRepositoryMySQL(opcoes.db)
    : new OrdemServicoRepositoryMemoria();
  const sagaRepository: SagaRepository = opcoes.db
    ? new SagaRepositoryMySQL(opcoes.db)
    : new SagaRepositoryMemoria();
  const clienteRepository: ClienteRepository = opcoes.db
    ? new ClienteRepositoryMySQL(opcoes.db)
    : new ClienteRepositoryMemoria();
  const veiculoRepository: VeiculoRepository = opcoes.db
    ? new VeiculoRepositoryMySQL(opcoes.db)
    : new VeiculoRepositoryMemoria();
  const catalogoRepository: CatalogoRepository = opcoes.db
    ? new CatalogoRepositoryMySQL(opcoes.db)
    : new CatalogoRepositoryMemoria();

  const mensageria: MensageriaGateway =
    opcoes.mensageria ??
    (usarMysql ? new RabbitMQMensageriaGateway() : new MensageriaGatewayMemoria());

  const telemetria: TelemetriaGateway =
    opcoes.telemetria ??
    (usarMysql ? telemetriaGateway : new TelemetriaGatewayMemoria());

  const orquestrador = new SagaOrquestrador(
    sagaRepository,
    ordemServicoRepository,
    mensageria,
    telemetria,
  );

  return {
    ordemServicoRepository,
    sagaRepository,
    clienteRepository,
    veiculoRepository,
    catalogoRepository,
    mensageria,
    telemetria,
    orquestrador,
    abrirOrdemServico: new AbrirOrdemServicoUseCase(
      ordemServicoRepository,
      clienteRepository,
      veiculoRepository,
      catalogoRepository,
      orquestrador,
    ),
    decidirOrcamento: new DecidirOrcamentoUseCase(
      orquestrador,
      ordemServicoRepository,
    ),
    consultarOrdemServico: new ConsultarOrdemServicoUseCase(
      ordemServicoRepository,
      sagaRepository,
    ),
    listarOrdensServico: new ListarOrdensServicoUseCase(ordemServicoRepository),
    finalizarOrdemServico: new FinalizarOrdemServicoUseCase(
      ordemServicoRepository,
      telemetria,
    ),
    entregarOrdemServico: new EntregarOrdemServicoUseCase(
      ordemServicoRepository,
      telemetria,
    ),
    monitorarTempoMedio: new MonitorarTempoMedioUseCase(ordemServicoRepository),
    gerenciarCliente: new GerenciarClienteUseCase(clienteRepository),
    gerenciarVeiculo: new GerenciarVeiculoUseCase(
      veiculoRepository,
      clienteRepository,
    ),
    gerenciarCatalogo: new GerenciarCatalogoUseCase(catalogoRepository),
  };
}

export default criarContainer;
