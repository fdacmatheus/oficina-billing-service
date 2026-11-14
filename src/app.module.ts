import { join } from 'node:path';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from './modules/billing/billing.module';
import { JwtStrategy } from './shared/auth/jwt.strategy';
import { HealthController } from './shared/health/health.controller';
import { MensageriaModule } from './shared/mensageria/mensageria.module';
import { CorrelacaoMiddleware } from './shared/observabilidade/correlacao.middleware';
import { MetricasInterceptor } from './shared/observabilidade/metricas.interceptor';
import { ObservabilidadeModule } from './shared/observabilidade/observabilidade.module';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
    ObservabilidadeModule,
    PassportModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: Number(config.get<string>('DB_PORT', '5434')),
        username: config.get<string>('DB_USER', 'billing'),
        password: config.get<string>('DB_PASSWORD', 'billing'),
        database: config.get<string>('DB_NAME', 'billing'),
        autoLoadEntities: true,
        // Schema so por migration. Com varias replicas subindo juntas, o TypeORM
        // serializa a execucao pela tabela de controle.
        synchronize: false,
        migrations: [join(__dirname, 'shared/database/migrations/*.{js,ts}')],
        migrationsRun: config.get<string>('DB_MIGRATIONS_RUN', 'true') === 'true',
        // O RDS exige TLS; a CA da AWS nao vai embarcada na imagem.
        ssl: config.get<string>('DB_SSL') === 'true' ? { rejectUnauthorized: false } : false,
        extra: { max: 10 },
        retryAttempts: 10,
        retryDelay: 3000,
      }),
    }),
    MensageriaModule,
    BillingModule,
  ],
  providers: [JwtStrategy, { provide: APP_INTERCEPTOR, useClass: MetricasInterceptor }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelacaoMiddleware).forRoutes('*');
  }
}
