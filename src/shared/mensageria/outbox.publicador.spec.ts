import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { mockClient } from 'aws-sdk-client-mock';
import { DataSource } from 'typeorm';
import { configFake, metricas, valorMetrica } from '../../test-utils/fakes';
import { OutboxPublicador } from './outbox.publicador';

const linha = (id: string, tipo = 'OrcamentoGerado') => ({
  id,
  tipo,
  fila_destino: 'http://sqs/os-eventos',
  corpo: { messageId: id, type: tipo },
  correlation_id: 'os-1',
});

describe('OutboxPublicador', () => {
  const sqs = new SQSClient({ region: 'us-east-1' });
  const sqsMock = mockClient(sqs);
  const query = jest.fn();
  const dataSource = {
    transaction: jest.fn((fn: (m: unknown) => unknown) => fn({ query })),
  } as unknown as DataSource;
  let m: ReturnType<typeof metricas>;

  const criar = (env: Record<string, string> = {}) =>
    new OutboxPublicador(dataSource, sqs, configFake(env), m);

  beforeEach(() => {
    sqsMock.reset();
    query.mockReset();
    m = metricas();
  });

  it('envia pendentes com atributos type e correlationId e marca publicada_em', async () => {
    query
      .mockResolvedValueOnce([linha('a'), linha('b', 'OrcamentoAprovado')])
      .mockResolvedValueOnce([]);
    sqsMock.on(SendMessageCommand).resolves({});

    expect(await criar().publicarPendentes()).toBe(2);

    expect(query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    const envio = sqsMock.commandCalls(SendMessageCommand)[0].args[0].input;
    expect(envio).toEqual({
      QueueUrl: 'http://sqs/os-eventos',
      MessageBody: JSON.stringify({ messageId: 'a', type: 'OrcamentoGerado' }),
      MessageAttributes: {
        type: { DataType: 'String', StringValue: 'OrcamentoGerado' },
        correlationId: { DataType: 'String', StringValue: 'os-1' },
      },
    });
    expect(query.mock.calls[1][1][1]).toEqual(['a', 'b']);
    expect(
      await valorMetrica(
        m,
        'oficina_billing_mensagens_publicadas_total',
        'tipo="OrcamentoAprovado"',
      ),
    ).toBe(1);
  });

  it('para no primeiro erro e marca só o que saiu', async () => {
    query.mockResolvedValueOnce([linha('a'), linha('b'), linha('c')]).mockResolvedValueOnce([]);
    sqsMock.on(SendMessageCommand).resolvesOnce({}).rejectsOnce(new Error('fora do ar'));
    expect(await criar().publicarPendentes()).toBe(1);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(2);
    expect(query.mock.calls[1][1][1]).toEqual(['a']);
  });

  it('sem pendentes não faz update; erro de banco não derruba o ciclo', async () => {
    query.mockResolvedValueOnce([]);
    expect(await criar().publicarPendentes()).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);

    query.mockRejectedValueOnce(new Error('db fora'));
    expect(await criar().publicarPendentes()).toBe(0);
  });

  it('não sobrepõe ciclos', async () => {
    let liberar: (v: unknown[]) => void = () => undefined;
    query.mockReturnValueOnce(new Promise((r) => (liberar = r)));
    const p = criar();
    const primeiro = p.publicarPendentes();
    expect(await p.publicarPendentes()).toBe(0);
    liberar([]);
    await primeiro;
  });

  it('agenda no bootstrap e para no shutdown; desligável por env', () => {
    jest.useFakeTimers();
    try {
      query.mockResolvedValue([]);
      const p = criar({ OUTBOX_INTERVALO_MS: '100' });
      p.onApplicationBootstrap();
      jest.advanceTimersByTime(250);
      expect(dataSource.transaction).toHaveBeenCalled();
      p.onApplicationShutdown();

      (dataSource.transaction as jest.Mock).mockClear();
      const desligado = criar({ OUTBOX_PUBLISHER_ENABLED: 'false' });
      desligado.onApplicationBootstrap();
      jest.advanceTimersByTime(5000);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
