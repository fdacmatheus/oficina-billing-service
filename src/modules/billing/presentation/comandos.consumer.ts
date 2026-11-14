import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { setTimeout as esperar } from 'node:timers/promises';
import { Envelope } from '../../../shared/mensageria/contrato';
import { SQS_CLIENT } from '../../../shared/mensageria/sqs';
import { contextoRequisicao } from '../../../shared/observabilidade/correlacao.middleware';
import { MetricasService } from '../../../shared/observabilidade/metricas.service';
import { emSpanDaMensagem, semRastreamento } from '../../../shared/observabilidade/telemetria';
import { ComandosService } from '../application/comandos.service';

/**
 * Consumidor da fila billing-comandos (long polling).
 *
 * A mensagem so e apagada depois do processamento confirmado. Em erro ela fica,
 * volta apos o visibility timeout e, apos 5 recebimentos, vai para a DLQ.
 */
@Injectable()
export class ComandosConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ComandosConsumer.name);
  private readonly abortar = new AbortController();
  private readonly filaUrl: string;
  private ativo = false;
  private laco?: Promise<void>;

  constructor(
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    private readonly comandos: ComandosService,
    private readonly metricas: MetricasService,
    private readonly config: ConfigService,
  ) {
    this.filaUrl = config.getOrThrow<string>('SQS_BILLING_COMANDOS_URL');
  }

  onApplicationBootstrap(): void {
    if (this.config.get<string>('SQS_CONSUMER_ENABLED', 'true') === 'false') return;
    this.ativo = true;
    this.laco = semRastreamento(() => this.executar());
    this.logger.log(`Consumindo ${this.filaUrl}`);
  }

  async onApplicationShutdown(): Promise<void> {
    this.ativo = false;
    this.abortar.abort();
    await this.laco;
  }

  private async executar(): Promise<void> {
    while (this.ativo) {
      try {
        await this.receberLote();
      } catch (erro) {
        if (!this.ativo) break;
        this.logger.error(`Falha ao ler a fila: ${String(erro)}`);
        await esperar(5000, undefined, { signal: this.abortar.signal }).catch(() => undefined);
      }
    }
  }

  async receberLote(): Promise<void> {
    const { Messages = [] } = await this.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: this.filaUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20,
        MessageAttributeNames: ['All'],
      }),
      { abortSignal: this.abortar.signal },
    );
    // Sequencial: comandos da mesma OS chegam em ordem e nao disputam a mesma linha.
    for (const mensagem of Messages) await this.tratar(mensagem);
  }

  async tratar(mensagem: Message): Promise<void> {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(mensagem.Body ?? '') as Envelope;
    } catch {
      this.metricas.mensagensConsumidas.inc({ tipo: 'invalida', resultado: 'erro' });
      this.logger.error(`Mensagem ${mensagem.MessageId} com corpo inválido; segue para a DLQ`);
      return;
    }

    const correlationId =
      envelope.correlationId ??
      mensagem.MessageAttributes?.correlationId?.StringValue ??
      randomUUID();

    await contextoRequisicao.run({ correlationId }, async () => {
      try {
        // Os eventos gravados no outbox durante o processamento herdam este span.
        const resultado = await emSpanDaMensagem(
          `processar ${envelope.type}`,
          'consumidor',
          envelope.traceparent,
          { 'messaging.source.name': 'billing-comandos', 'oficina.os_id': correlationId },
          () => this.comandos.processar(envelope),
        );
        await this.sqs.send(
          new DeleteMessageCommand({
            QueueUrl: this.filaUrl,
            ReceiptHandle: mensagem.ReceiptHandle,
          }),
        );
        this.metricas.mensagensConsumidas.inc({ tipo: envelope.type, resultado });
        this.logger.log(`${envelope.type} ${envelope.messageId}: ${resultado}`);
      } catch (erro) {
        this.metricas.mensagensConsumidas.inc({ tipo: envelope.type, resultado: 'erro' });
        this.logger.error(
          `Falha ao processar ${envelope.type} ${envelope.messageId}; volta para a fila`,
          erro instanceof Error ? erro.stack : String(erro),
        );
      }
    });
  }
}
