import TelemetriaGateway from "../../domain/gateway/TelemetriaGateway";
import NewRelicTelemetriaGateway from "./NewRelicTelemetriaGateway";

// Instancia unica compartilhada pelas rotas, pelo orquestrador e pelo
// error handler. Sem NEW_RELIC_LICENSE_KEY (dev local e testes) o gateway
// apenas registra em log.
export const telemetriaGateway: TelemetriaGateway =
  new NewRelicTelemetriaGateway();

export default telemetriaGateway;
