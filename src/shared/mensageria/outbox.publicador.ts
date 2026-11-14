import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { MetricasService } from '../observabilidade/metricas.service';
import { emSpanDaMensagem, semRastreamento } from '../observabilidade/telemetria';
import type { Envelope } from './contrato';
import { SQS_CLIENT } from './sqs';

interface LinhaOutbox {
  id: string;
  tipo: string;
  fila_destino: string;
  corpo: Envelope;
  correlation_id: string;
}

/**
 * Envia ao SQS os eventos gravados no outbox.
 *
 * SKIP LOCKED deixa varias replicas publicarem ao mesmo tempo sem pegar a mesma
 * linha. Se o processo cair depois do envio e antes do UPDATE, o evento sai de
 * novo: o consumidor do outro lado e idempotente por messageId.
 */
@Injectable()
export class OutboxPublicador implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxPublicador.name);
  private timer?: NodeJS.Timeout;
  private rodando = false;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    private readonly config: ConfigService,
    private readonly metricas: MetricasService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get<string>('OUTBOX_PUBLISHER_ENABLED', 'true') === 'false') return;
    const intervalo = Number(this.config.get<string>('OUTBOX_INTERVALO_MS', '1000'));
    this.timer = setInterval(() => void semRastreamento(() => this.publicarPendentes()), intervalo);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async publicarPendentes(): Promise<number> {
    if (this.rodando) return 0;
    this.rodando = true;
    try {
      return await this.dataSource.transaction(async (manager) => {
        const linhas: LinhaOutbox[] = await manager.query(
          `SELECT id, tipo, fila_destino, corpo, correlation_id FROM outbox
           WHERE publicada_em IS NULL ORDER BY criada_em LIMIT 50 FOR UPDATE SKIP LOCKED`,
        );
        const enviadas: string[] = [];
        for (const linha of linhas) {
          try {
            await this.enviar(linha);
            enviadas.push(linha.id);
            this.metricas.mensagensPublicadas.inc({ tipo: linha.tipo });
          } catch (erro) {
            // Para no primeiro erro para preservar a ordem; o resto sai no proximo ciclo.
            this.logger.error(`Falha ao publicar ${linha.tipo} (${linha.id}): ${String(erro)}`);
            break;
          }
        }
        if (enviadas.length) {
          await manager.query('UPDATE outbox SET publicada_em = $1 WHERE id = ANY($2::uuid[])', [
            Date.now(),
            enviadas,
          ]);
        }
        return enviadas.length;
      });
    } catch (erro) {
      this.logger.error(`Falha no ciclo do outbox: ${String(erro)}`);
      return 0;
    } finally {
      this.rodando = false;
    }
  }

  /** O span de envio e filho do contexto em que o evento foi criado (traceparent do envelope). */
  private enviar(linha: LinhaOutbox) {
    return emSpanDaMensagem(
      `publicar ${linha.tipo}`,
      'produtor',
      linha.corpo.traceparent,
      { 'messaging.destination.name': linha.fila_destino, 'oficina.os_id': linha.correlation_id },
      () =>
        this.sqs.send(
          new SendMessageCommand({
            QueueUrl: linha.fila_destino,
            MessageBody: JSON.stringify(linha.corpo),
            MessageAttributes: {
              type: { DataType: 'String', StringValue: linha.tipo },
              correlationId: { DataType: 'String', StringValue: linha.correlation_id },
            },
          }),
        ),
    );
  }
}
