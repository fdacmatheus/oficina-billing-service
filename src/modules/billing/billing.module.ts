import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetricasService } from '../../shared/observabilidade/metricas.service';
import { ComandosService } from './application/comandos.service';
import { OrcamentosService } from './application/orcamentos.service';
import { PagamentosService } from './application/pagamentos.service';
import { PAGAMENTO_GATEWAY, UNIDADE_DE_TRABALHO } from './application/portas';
import { FakePagamentoGateway } from './infrastructure/gateway/fake.gateway';
import { MercadoPagoGateway } from './infrastructure/gateway/mercadopago.gateway';
import { OrcamentoOrmEntity } from './infrastructure/persistencia/orcamento.orm-entity';
import { PagamentoOrmEntity } from './infrastructure/persistencia/pagamento.orm-entity';
import { TypeOrmUnidadeDeTrabalho } from './infrastructure/persistencia/unidade-de-trabalho.typeorm';
import { AdminController } from './presentation/admin.controller';
import { ComandosConsumer } from './presentation/comandos.consumer';
import { PublicoController } from './presentation/publico.controller';
import { WebhooksController } from './presentation/webhooks.controller';

@Module({
  imports: [TypeOrmModule.forFeature([OrcamentoOrmEntity, PagamentoOrmEntity])],
  controllers: [PublicoController, AdminController, WebhooksController],
  providers: [
    ComandosService,
    OrcamentosService,
    PagamentosService,
    ComandosConsumer,
    { provide: UNIDADE_DE_TRABALHO, useClass: TypeOrmUnidadeDeTrabalho },
    {
      provide: PAGAMENTO_GATEWAY,
      inject: [ConfigService, MetricasService],
      useFactory: (config: ConfigService, metricas: MetricasService) =>
        config.get<string>('MP_MODO', 'fake') === 'mercadopago'
          ? new MercadoPagoGateway(
              {
                accessToken: config.getOrThrow<string>('MP_ACCESS_TOKEN'),
                baseUrl: config.get<string>('MP_BASE_URL', 'https://api.mercadopago.com'),
                timeoutMs: Number(config.get<string>('MP_TIMEOUT_MS', '10000')),
              },
              metricas,
            )
          : new FakePagamentoGateway(),
    },
  ],
})
export class BillingModule {}
