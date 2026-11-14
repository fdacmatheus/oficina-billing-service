// Precisa vir antes de qualquer outro import para instrumentar as bibliotecas.
import './tracing';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter';
import { LoggerService } from './shared/observabilidade/logger.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.useLogger(app.get(LoggerService));
  app.set('trust proxy', true);
  // Os hooks de shutdown param o consumidor SQS e o publicador do outbox.
  app.enableShutdownHooks();
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Oficina Billing Service')
    .setDescription('Orçamento, aprovação do cliente e pagamento (Mercado Pago) da oficina')
    .setVersion('4.0.0')
    .addBearerAuth()
    .addTag('publico', 'Link do orçamento enviado ao cliente (protegido pelo token)')
    .addTag('admin', 'Consultas administrativas (JWT)')
    // Atrás do API Gateway o serviço fica sob um prefixo (/os, /billing, /execution).
    .addServer(process.env.SWAGGER_PREFIXO ?? '/', 'Ambiente atual')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  await app.listen(Number(config.get<string>('PORT', '3002')), '0.0.0.0');
}

void bootstrap();
