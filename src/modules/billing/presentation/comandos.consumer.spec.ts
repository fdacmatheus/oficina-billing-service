import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { mockClient } from 'aws-sdk-client-mock';
import { configFake, envelope, metricas, valorMetrica } from '../../../test-utils/fakes';
import { obterCorrelationId } from '../../../shared/observabilidade/correlacao.middleware';
import { ComandosService } from '../application/comandos.service';
import { ComandosConsumer } from './comandos.consumer';

describe('ComandosConsumer', () => {
  const sqs = new SQSClient({ region: 'us-east-1' });
  const sqsMock = mockClient(sqs);
  let processar: jest.Mock;
  let m: ReturnType<typeof metricas>;

  const criar = (env: Record<string, string> = {}) =>
    new ComandosConsumer(sqs, { processar } as unknown as ComandosService, m, configFake(env));

  const mensagem = (corpo: string, id = 'sqs-1') => ({
    MessageId: id,
    ReceiptHandle: `rh-${id}`,
    Body: corpo,
  });

  beforeEach(() => {
    sqsMock.reset();
    m = metricas();
    processar = jest.fn().mockResolvedValue('processada');
  });

  it('recebe com long polling e apaga após processar, dentro do contexto do correlationId', async () => {
    let correlacaoVista: string | undefined;
    processar.mockImplementation(async () => {
      correlacaoVista = obterCorrelationId();
      return 'processada';
    });
    const env = envelope('GerarOrcamento', {});
    sqsMock.on(ReceiveMessageCommand).resolves({ Messages: [mensagem(JSON.stringify(env))] });

    await criar().receberLote();

    expect(sqsMock.commandCalls(ReceiveMessageCommand)[0].args[0].input).toEqual({
      QueueUrl: 'http://sqs/billing-comandos',
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
      MessageAttributeNames: ['All'],
    });
    expect(processar).toHaveBeenCalledWith(env);
    expect(correlacaoVista).toBe('os-1');
    expect(sqsMock.commandCalls(DeleteMessageCommand)[0].args[0].input).toEqual({
      QueueUrl: 'http://sqs/billing-comandos',
      ReceiptHandle: 'rh-sqs-1',
    });
    expect(
      await valorMetrica(
        m,
        'oficina_billing_mensagens_consumidas_total',
        'tipo="GerarOrcamento",resultado="processada"',
      ),
    ).toBe(1);
  });

  it('lote vazio não faz nada', async () => {
    sqsMock.on(ReceiveMessageCommand).resolves({});
    await criar().receberLote();
    expect(processar).not.toHaveBeenCalled();
  });

  it('erro no processamento não apaga a mensagem', async () => {
    processar.mockRejectedValue(new Error('db fora'));
    await criar().tratar(mensagem(JSON.stringify(envelope('CobrarOrcamento', {}))));
    expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
    expect(
      await valorMetrica(
        m,
        'oficina_billing_mensagens_consumidas_total',
        'tipo="CobrarOrcamento",resultado="erro"',
      ),
    ).toBe(1);

    processar.mockRejectedValue('texto');
    await criar().tratar(mensagem(JSON.stringify(envelope('CobrarOrcamento', {}))));
    expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
  });

  it('corpo inválido não é processado nem apagado (vai para a DLQ)', async () => {
    await criar().tratar(mensagem('{nao-json'));
    await criar().tratar({ MessageId: 'x' });
    expect(processar).not.toHaveBeenCalled();
    expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
  });

  it('usa o atributo correlationId (ou gera um) quando o envelope não traz', async () => {
    const vistos: Array<string | undefined> = [];
    processar.mockImplementation(async () => {
      vistos.push(obterCorrelationId());
      return 'repetida';
    });
    const semCorrelacao = JSON.stringify({ messageId: 'm', type: 'GerarOrcamento' });
    await criar().tratar({
      ...mensagem(semCorrelacao),
      MessageAttributes: { correlationId: { DataType: 'String', StringValue: 'os-attr' } },
    });
    await criar().tratar(mensagem(semCorrelacao));
    expect(vistos[0]).toBe('os-attr');
    expect(vistos[1]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('inicia no bootstrap, sobrevive a erro de leitura e para no shutdown', async () => {
    let chamadas = 0;
    sqsMock.on(ReceiveMessageCommand).callsFake(async () => {
      chamadas += 1;
      if (chamadas === 1) throw new Error('floci fora');
      return {};
    });
    const consumidor = criar();
    consumidor.onApplicationBootstrap();
    await new Promise((r) => setImmediate(r));
    await consumidor.onApplicationShutdown();
    expect(chamadas).toBeGreaterThanOrEqual(1);
  });

  it('erro de leitura causado pelo shutdown encerra o laço sem esperar', async () => {
    const consumidor = criar();
    sqsMock.on(ReceiveMessageCommand).callsFake(async () => {
      await consumidor.onApplicationShutdown().catch(() => undefined);
      throw new Error('abortado');
    });
    consumidor.onApplicationBootstrap();
    await new Promise((r) => setImmediate(r));
    await consumidor.onApplicationShutdown();
    expect(sqsMock.commandCalls(ReceiveMessageCommand)).toHaveLength(1);
  });

  it('desligável por SQS_CONSUMER_ENABLED=false', async () => {
    const consumidor = criar({ SQS_CONSUMER_ENABLED: 'false' });
    consumidor.onApplicationBootstrap();
    await consumidor.onApplicationShutdown();
    expect(sqsMock.commandCalls(ReceiveMessageCommand)).toHaveLength(0);
  });
});
