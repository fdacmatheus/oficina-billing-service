import { DadosCobranca, PagamentoGateway, ResultadoGateway } from '../../application/portas';

/**
 * Gateway em memoria para ambiente local e CI (MP_MODO=fake).
 * cardToken iniciando com `fake-recusado` simula recusa; qualquer outro aprova.
 */
export class FakePagamentoGateway implements PagamentoGateway {
  private readonly orders = new Map<string, ResultadoGateway>();

  async criarPagamento(dados: DadosCobranca): Promise<ResultadoGateway> {
    const recusado = dados.cardToken.startsWith('fake-recusado');
    const resultado: ResultadoGateway = {
      gatewayId: `fake-${dados.pagamentoId}`,
      situacao: recusado ? 'RECUSADO' : 'APROVADO',
      detalhe: recusado ? 'rejected_by_issuer' : 'accredited',
      referenciaExterna: dados.osId,
    };
    this.orders.set(resultado.gatewayId, resultado);
    return resultado;
  }

  async consultar(gatewayId: string): Promise<ResultadoGateway> {
    const resultado = this.orders.get(gatewayId);
    if (!resultado) throw new Error(`Order ${gatewayId} não encontrada no gateway fake`);
    return resultado;
  }

  async estornar(gatewayId: string): Promise<void> {
    // Depois de um restart a order some da memoria; o estorno segue valendo.
    const anterior = this.orders.get(gatewayId);
    if (anterior)
      this.orders.set(gatewayId, { ...anterior, situacao: 'ESTORNADO', detalhe: 'refunded' });
  }
}
