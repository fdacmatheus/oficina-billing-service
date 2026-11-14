import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { context, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { mockClient } from 'aws-sdk-client-mock';
import { DataSource } from 'typeorm';
import { ComandosService } from '../../modules/billing/application/comandos.service';
import { ComandosConsumer } from '../../modules/billing/presentation/comandos.consumer';
import { configFake, envelope, metricas } from '../../test-utils/fakes';
import { contextoRequisicao } from '../observabilidade/correlacao.middleware';
import { LoggerService } from '../observabilidade/logger.service';
import { emSpanDaMensagem, traceparentAtual } from '../observabilidade/telemetria';
import { criarEnvelope, Envelope } from './contrato';
import { OutboxPublicador } from './outbox.publicador';

/** O trace da OS precisa atravessar o billing: comando -> processamento -> evento -> publicacao. */
describe('rastreamento distribuído', () => {
  const spans = new InMemorySpanExporter();
  const registros = new InMemoryLogRecordExporter();
  const sqs = new SQSClient({ region: 'us-east-1' });
  const sqsMock = mockClient(sqs);

  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    trace.setGlobalTracerProvider(
      new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] }),
    );
    logs.setGlobalLoggerProvider(
      new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter: registros })] }),
    );
  });

  afterAll(() => {
    trace.disable();
    propagation.disable();
    context.disable();
    logs.disable();
  });

  beforeEach(() => {
    spans.reset();
    registros.reset();
    sqsMock.reset();
  });

  const idDoTrace = (traceparent?: string) => traceparent?.split('-')[1];
  const idDoSpan = (traceparent?: string) => traceparent?.split('-')[2];

  it('envelope criado fora de span não leva traceparent', () => {
    expect(criarEnvelope('OrcamentoGerado', {}, 'os-1').traceparent).toBeUndefined();
  });

  it('evento criado ao processar o comando carrega o traceparent do span de processamento', async () => {
    // O os-service publicou o comando dentro do trace da OS.
    let traceparentDoComando: string | undefined;
    await emSpanDaMensagem('publicar GerarOrcamento', 'produtor', undefined, {}, async () => {
      traceparentDoComando = traceparentAtual();
    });

    let eventoCriado: Envelope | undefined;
    const comandos = {
      processar: jest.fn(async () => {
        eventoCriado = criarEnvelope('OrcamentoGerado', {}, 'os-1');
        return 'processada';
      }),
    } as unknown as ComandosService;
    const consumidor = new ComandosConsumer(sqs, comandos, metricas(), configFake());

    await consumidor.tratar({
      MessageId: 'm',
      ReceiptHandle: 'rh',
      Body: JSON.stringify({
        ...envelope('GerarOrcamento', {}),
        traceparent: traceparentDoComando,
      }),
    });

    const processar = spans.getFinishedSpans().find((s) => s.name === 'processar GerarOrcamento');
    expect(processar?.spanContext().traceId).toBe(idDoTrace(traceparentDoComando));
    expect(processar?.parentSpanContext?.spanId).toBe(idDoSpan(traceparentDoComando));
    expect(processar?.attributes).toMatchObject({
      'messaging.source.name': 'billing-comandos',
      'oficina.os_id': 'os-1',
    });
    expect(idDoTrace(eventoCriado?.traceparent)).toBe(idDoTrace(traceparentDoComando));
    expect(idDoSpan(eventoCriado?.traceparent)).toBe(processar?.spanContext().spanId);
  });

  it('a publicação pelo outbox é filha do contexto em que o evento foi criado', async () => {
    let evento: Envelope | undefined;
    await emSpanDaMensagem('POST /aprovar', 'consumidor', undefined, {}, async () => {
      evento = criarEnvelope('OrcamentoAprovado', { osId: 'os-1' }, 'os-1');
    });
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'a',
          tipo: 'OrcamentoAprovado',
          fila_destino: 'http://sqs/os-eventos',
          corpo: evento,
          correlation_id: 'os-1',
        },
      ])
      .mockResolvedValueOnce([]);
    const dataSource = {
      transaction: (fn: (m: unknown) => unknown) => fn({ query }),
    } as unknown as DataSource;
    sqsMock.on(SendMessageCommand).resolves({});

    await new OutboxPublicador(dataSource, sqs, configFake(), metricas()).publicarPendentes();

    const publicar = spans.getFinishedSpans().find((s) => s.name === 'publicar OrcamentoAprovado');
    expect(publicar?.spanContext().traceId).toBe(idDoTrace(evento?.traceparent));
    expect(publicar?.parentSpanContext?.spanId).toBe(idDoSpan(evento?.traceparent));
    expect(publicar?.attributes['messaging.destination.name']).toBe('http://sqs/os-eventos');
  });

  it('o log também sai pelo OTel com severidade, atributos e o trace ativo', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const logger = new LoggerService();
      await emSpanDaMensagem('processar X', 'consumidor', undefined, {}, async () => {
        contextoRequisicao.run({ correlationId: 'os-1' }, () => {
          logger.error('falhou', 'pilha', 'Teste');
        });
      });
      logger.warn('sem contexto');
      const [erro, aviso] = registros.getFinishedLogRecords();
      expect(erro).toMatchObject({
        severityText: 'ERROR',
        body: 'falhou',
        attributes: { contexto: 'Teste', correlationId: 'os-1', detalhe: 'pilha' },
      });
      expect(erro.spanContext?.traceId).toBe(spans.getFinishedSpans()[0].spanContext().traceId);
      expect(aviso.attributes).toEqual({});
    } finally {
      jest.restoreAllMocks();
    }
  });
});
