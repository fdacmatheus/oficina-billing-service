import { metricas, valorMetrica } from '../../../../test-utils/fakes';
import { MercadoPagoGateway } from './mercadopago.gateway';

const resposta = (status: number, corpo: unknown) =>
  new Response(corpo === undefined ? null : JSON.stringify(corpo), { status });

const dados = {
  pagamentoId: 'pag-1',
  osId: 'os-1',
  valor: 350.5,
  cardToken: 'card-tok',
  paymentMethodId: 'master',
  installments: 3,
  payerEmail: 'ana@exemplo.com',
};

describe('MercadoPagoGateway', () => {
  let fetchMock: jest.SpyInstance;
  let m: ReturnType<typeof metricas>;
  let gateway: MercadoPagoGateway;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
    m = metricas();
    gateway = new MercadoPagoGateway(
      { accessToken: 'TEST-token', baseUrl: 'https://mp.local', timeoutMs: 1000 },
      m,
    );
  });

  afterEach(() => fetchMock.mockRestore());

  const falhas = (operacao: string) =>
    valorMetrica(
      m,
      'oficina_integracao_falhas_total',
      `integracao="mercadopago",operacao="${operacao}"`,
    );

  it('cria a order online/automatic com idempotência e traduz processed para APROVADO', async () => {
    fetchMock.mockResolvedValue(
      resposta(201, {
        id: 'ORD01',
        status: 'processed',
        status_detail: 'accredited',
        external_reference: 'os-1',
        transactions: {
          payments: [{ id: 'PAY01', status: 'processed', status_detail: 'accredited' }],
        },
      }),
    );

    const r = await gateway.criarPagamento(dados);

    expect(r).toEqual({
      gatewayId: 'ORD01',
      situacao: 'APROVADO',
      detalhe: 'accredited',
      referenciaExterna: 'os-1',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://mp.local/v1/orders');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer TEST-token',
      'Content-Type': 'application/json',
      'X-Idempotency-Key': 'pag-1',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      type: 'online',
      processing_mode: 'automatic',
      total_amount: '350.50',
      external_reference: 'os-1',
      payer: { email: 'ana@exemplo.com' },
      transactions: {
        payments: [
          {
            amount: '350.50',
            payment_method: {
              id: 'master',
              type: 'credit_card',
              token: 'card-tok',
              installments: 3,
            },
          },
        ],
      },
    });
  });

  it('402 vira RECUSADO com o status_detail da transação', async () => {
    fetchMock.mockResolvedValue(
      resposta(402, {
        id: 'ORD02',
        status: 'failed',
        transactions: { payments: [{ status: 'failed', status_detail: 'rejected_by_issuer' }] },
      }),
    );
    expect(await gateway.criarPagamento(dados)).toMatchObject({
      gatewayId: 'ORD02',
      situacao: 'RECUSADO',
      detalhe: 'rejected_by_issuer',
    });
  });

  it('402 sem corpo usa o código do erro ou o status', async () => {
    fetchMock.mockResolvedValueOnce(resposta(402, { errors: [{ code: 'failed' }] }));
    expect(await gateway.criarPagamento(dados)).toMatchObject({
      situacao: 'RECUSADO',
      detalhe: 'failed',
    });
    fetchMock.mockResolvedValueOnce(resposta(402, undefined));
    expect(await gateway.criarPagamento(dados)).toMatchObject({
      gatewayId: '',
      situacao: 'RECUSADO',
      detalhe: 'failed',
    });
  });

  it('status em andamento vira PENDENTE', async () => {
    fetchMock.mockResolvedValue(
      resposta(201, { id: 'ORD03', status: 'action_required', status_detail: 'pending_challenge' }),
    );
    expect(await gateway.criarPagamento(dados)).toMatchObject({
      situacao: 'PENDENTE',
      detalhe: 'pending_challenge',
    });
  });

  it('erro HTTP lança e conta falha de integração', async () => {
    fetchMock.mockResolvedValue(resposta(500, { message: 'internal_error' }));
    await expect(gateway.criarPagamento(dados)).rejects.toThrow('respondeu 500');
    expect(await falhas('criar')).toBe(1);
  });

  it('erro de rede/timeout lança e conta falha de integração', async () => {
    fetchMock.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    await expect(gateway.criarPagamento(dados)).rejects.toThrow('indisponível');
    expect(await falhas('criar')).toBe(1);
  });

  it('consulta a order por GET', async () => {
    fetchMock.mockResolvedValue(
      resposta(200, { id: 'ORD01', status: 'refunded', status_detail: 'refunded' }),
    );
    expect(await gateway.consultar('ORD01')).toMatchObject({ situacao: 'ESTORNADO' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://mp.local/v1/orders/ORD01');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers['X-Idempotency-Key']).toBeUndefined();
  });

  it('estorna com POST /refund e chave refund:<pagamentoId>', async () => {
    fetchMock.mockResolvedValue(resposta(201, { id: 'ORD01', status: 'refunded' }));
    await gateway.estornar('ORD01', 'pag-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://mp.local/v1/orders/ORD01/refund');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Idempotency-Key']).toBe('refund:pag-1');
  });

  it('estorno já feito antes é tratado como sucesso', async () => {
    fetchMock.mockResolvedValue(resposta(409, { errors: [{ code: 'order_already_refunded' }] }));
    await expect(gateway.estornar('ORD01', 'pag-1')).resolves.toBeUndefined();
  });

  it('estorno recusado lança e conta falha', async () => {
    fetchMock.mockResolvedValue(resposta(400, { errors: [{ code: 'cannot_refund_order' }] }));
    await expect(gateway.estornar('ORD01', 'pag-1')).rejects.toThrow('cannot_refund_order');
    expect(await falhas('estornar')).toBe(1);
  });

  it('erro HTTP com corpo ilegível ainda lança', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.reject(new Error('stream')),
    } as unknown as Response);
    await expect(gateway.consultar('ORD01')).rejects.toThrow('respondeu 502');
    expect(await falhas('consultar')).toBe(1);
  });

  it('estorno com erro 500 lança e conta falha', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 503 }));
    await expect(gateway.estornar('ORD01', 'pag-1')).rejects.toThrow('respondeu 503');
    expect(await falhas('estornar')).toBe(1);
  });
});
