import { Logger } from '@nestjs/common';
import { MetricasService } from '../../../../shared/observabilidade/metricas.service';
import {
  DadosCobranca,
  PagamentoGateway,
  ResultadoGateway,
  SituacaoGateway,
} from '../../application/portas';

interface OrderMercadoPago {
  id?: string;
  status?: string;
  status_detail?: string;
  external_reference?: string;
  transactions?: { payments?: Array<{ status?: string; status_detail?: string }> };
  errors?: Array<{ code?: string; message?: string }>;
  /** No 402 a order vem embrulhada aqui, ao lado de `errors`. */
  data?: OrderMercadoPago;
}

export interface ConfigMercadoPago {
  accessToken: string;
  baseUrl: string;
  timeoutMs: number;
}

const SITUACAO_POR_STATUS: Record<string, SituacaoGateway> = {
  processed: 'APROVADO',
  refunded: 'ESTORNADO',
  failed: 'RECUSADO',
  canceled: 'RECUSADO',
  cancelled: 'RECUSADO',
  expired: 'RECUSADO',
  rejected: 'RECUSADO',
};

/**
 * Adapter da API de Orders do Mercado Pago (Checkout Transparente, modo online).
 * https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api/create-order/post
 */
export class MercadoPagoGateway implements PagamentoGateway {
  private readonly logger = new Logger(MercadoPagoGateway.name);

  constructor(
    private readonly config: ConfigMercadoPago,
    private readonly metricas: MetricasService,
  ) {}

  async criarPagamento(dados: DadosCobranca): Promise<ResultadoGateway> {
    const valor = dados.valor.toFixed(2);
    // 402 = order criada, mas a transacao foi recusada; o corpo traz o motivo.
    const { http, order } = await this.requisitar(
      'criar',
      'POST',
      '/v1/orders',
      dados.pagamentoId,
      [402],
      {
        type: 'online',
        processing_mode: 'automatic',
        total_amount: valor,
        external_reference: dados.osId,
        payer: { email: dados.payerEmail },
        transactions: {
          payments: [
            {
              amount: valor,
              payment_method: {
                id: dados.paymentMethodId,
                type: 'credit_card',
                token: dados.cardToken,
                installments: dados.installments,
              },
            },
          ],
        },
      },
    );
    // 402: `{ errors, data: <order> }`, com o motivo em data.transactions.payments[0].status_detail.
    return this.traduzir(
      http === 402 ? { status: 'failed', errors: order.errors, ...order.data } : order,
    );
  }

  async consultar(gatewayId: string): Promise<ResultadoGateway> {
    const { order } = await this.requisitar(
      'consultar',
      'GET',
      `/v1/orders/${encodeURIComponent(gatewayId)}`,
    );
    return this.traduzir(order);
  }

  async estornar(gatewayId: string, pagamentoId: string): Promise<void> {
    const { order: resposta } = await this.requisitar(
      'estornar',
      'POST',
      `/v1/orders/${encodeURIComponent(gatewayId)}/refund`,
      `refund:${pagamentoId}`,
      [400, 409],
    );
    // Estorno total ja feito antes (ex.: tentativa anterior que caiu depois do MP responder).
    if (resposta.errors?.length && resposta.errors[0].code !== 'order_already_refunded') {
      this.metricas.falhasIntegracao.inc({ integracao: 'mercadopago', operacao: 'estornar' });
      throw new Error(`Mercado Pago recusou o estorno: ${resposta.errors[0].code}`);
    }
  }

  private traduzir(order: OrderMercadoPago): ResultadoGateway {
    const status = order.status ?? '';
    const situacao = SITUACAO_POR_STATUS[status] ?? 'PENDENTE';
    const transacao = order.transactions?.payments?.[0];
    const detalhe =
      (situacao === 'RECUSADO' && (transacao?.status_detail ?? order.errors?.[0]?.code)) ||
      order.status_detail ||
      status;
    return {
      gatewayId: order.id ?? '',
      situacao,
      detalhe,
      referenciaExterna: order.external_reference,
    };
  }

  private async requisitar(
    operacao: string,
    metodo: 'GET' | 'POST',
    caminho: string,
    chaveIdempotencia?: string,
    statusAceitos: number[] = [],
    corpo?: unknown,
  ): Promise<{ http: number; order: OrderMercadoPago }> {
    let resposta: Response;
    try {
      resposta = await fetch(`${this.config.baseUrl}${caminho}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
          ...(chaveIdempotencia ? { 'X-Idempotency-Key': chaveIdempotencia } : {}),
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (erro) {
      this.metricas.falhasIntegracao.inc({ integracao: 'mercadopago', operacao });
      throw new Error(`Mercado Pago indisponível (${operacao}): ${String(erro)}`);
    }

    if (!resposta.ok && !statusAceitos.includes(resposta.status)) {
      this.metricas.falhasIntegracao.inc({ integracao: 'mercadopago', operacao });
      const texto = await resposta.text().catch(() => '');
      this.logger.error(`Mercado Pago ${operacao} respondeu ${resposta.status}: ${texto}`);
      throw new Error(`Mercado Pago ${operacao} respondeu ${resposta.status}`);
    }
    const order = ((await resposta.json().catch(() => null)) ?? {}) as OrderMercadoPago;
    return { http: resposta.status, order };
  }
}
