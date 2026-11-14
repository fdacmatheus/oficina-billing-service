import {
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtStrategy } from '../../../shared/auth/jwt.strategy';
import { HttpExceptionFilter } from '../../../shared/filters/http-exception.filter';
import { HealthController } from '../../../shared/health/health.controller';
import { CorrelacaoMiddleware } from '../../../shared/observabilidade/correlacao.middleware';
import { MetricasInterceptor } from '../../../shared/observabilidade/metricas.interceptor';
import { ObservabilidadeModule } from '../../../shared/observabilidade/observabilidade.module';
import { UnidadeDeTrabalhoFake, novoOrcamento } from '../../../test-utils/fakes';
import { OrcamentosService } from '../application/orcamentos.service';
import { PagamentosService } from '../application/pagamentos.service';
import { PAGAMENTO_GATEWAY, UNIDADE_DE_TRABALHO } from '../application/portas';
import { Pagamento } from '../domain/pagamento.entity';
import { FakePagamentoGateway } from '../infrastructure/gateway/fake.gateway';
import { AdminController } from './admin.controller';
import { PublicoController } from './publico.controller';
import { WebhooksController } from './webhooks.controller';

const JWT_SECRET = 'segredo-jwt-teste';
const MP_WEBHOOK_SECRET = 'segredo-webhook-teste';

describe('API HTTP', () => {
  let app: INestApplication<App>;
  let uow: UnidadeDeTrabalhoFake;
  let gateway: FakePagamentoGateway;

  const criarApp = async (env: Record<string, string>) => {
    @Module({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => env] }),
        ObservabilidadeModule,
        PassportModule,
      ],
      controllers: [HealthController, PublicoController, AdminController, WebhooksController],
      providers: [
        OrcamentosService,
        PagamentosService,
        JwtStrategy,
        { provide: UNIDADE_DE_TRABALHO, useValue: uow },
        { provide: PAGAMENTO_GATEWAY, useValue: gateway },
        { provide: APP_INTERCEPTOR, useClass: MetricasInterceptor },
      ],
    })
    class TesteModule implements NestModule {
      configure(consumer: MiddlewareConsumer) {
        consumer.apply(CorrelacaoMiddleware).forRoutes('*');
      }
    }
    const ref = await Test.createTestingModule({ imports: [TesteModule] }).compile();
    const nova = ref.createNestApplication<INestApplication<App>>({ logger: false });
    nova.setGlobalPrefix('api');
    nova.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    nova.useGlobalFilters(new HttpExceptionFilter());
    await nova.init();
    return nova;
  };

  beforeEach(async () => {
    uow = new UnidadeDeTrabalhoFake();
    gateway = new FakePagamentoGateway();
    app = await criarApp({ JWT_SECRET, MP_WEBHOOK_SECRET });
  });

  afterEach(() => app.close());

  const http = () => request(app.getHttpServer());

  const salvarOrcamento = async () => {
    const o = novoOrcamento();
    await uow.executar((tx) => tx.orcamentos.salvar(o));
    return o;
  };

  const cobrar = async (orcamentoId: string) => {
    const p = Pagamento.criar({ orcamentoId, osId: 'os-1', valor: 190.5 });
    await uow.executar((tx) => tx.pagamentos.salvar(p));
    return p;
  };

  const cartao = (cardToken = 'fake-ok') => ({
    cardToken,
    paymentMethodId: 'visa',
    installments: 1,
    payerEmail: 'ana@exemplo.com',
  });

  it('health e métricas', async () => {
    await http()
      .get('/api/health')
      .expect(200, /"status":"ok"/);
    const metricas = await http().get('/api/metrics').expect(200);
    expect(metricas.text).toContain(
      'http_requests_total{method="GET",route="/api/health",status="200"} 1',
    );
  });

  it('fluxo público: consulta, aprova e paga (aprovado)', async () => {
    const o = await salvarOrcamento();
    const q = `token=${o.tokenAprovacao}`;

    const consulta = await http()
      .get(`/api/publico/orcamentos/${o.id}?${q}`)
      .set('x-correlation-id', 'corr-1')
      .expect(200);
    expect(consulta.headers['x-correlation-id']).toBe('corr-1');
    expect(consulta.body).toMatchObject({ id: o.id, status: 'PENDENTE', valorTotal: 190.5 });
    expect(consulta.body.tokenAprovacao).toBeUndefined();
    expect(typeof consulta.body.criadoEm).toBe('number');

    await http()
      .post(`/api/publico/orcamentos/${o.id}/aprovar?${q}`)
      .expect(200, /APROVADO/);
    await http().post(`/api/publico/orcamentos/${o.id}/pagar?${q}`).send(cartao()).expect(409);

    const p = await cobrar(o.id);
    const pago = await http()
      .post(`/api/publico/orcamentos/${o.id}/pagar?${q}`)
      .send(cartao())
      .expect(200);
    expect(pago.body).toMatchObject({ id: p.id, status: 'APROVADO', gatewayId: `fake-${p.id}` });
    expect(uow.eventos.map((e) => e.tipo)).toEqual(['OrcamentoAprovado', 'PagamentoAprovado']);
  });

  it('pagamento recusado com cardToken fake-recusado', async () => {
    const o = await salvarOrcamento();
    const q = `token=${o.tokenAprovacao}`;
    await http().post(`/api/publico/orcamentos/${o.id}/aprovar?${q}`).expect(200);
    await cobrar(o.id);
    const r = await http()
      .post(`/api/publico/orcamentos/${o.id}/pagar?${q}`)
      .send(cartao('fake-recusado'))
      .expect(200);
    expect(r.body).toMatchObject({ status: 'RECUSADO', motivoRecusa: 'rejected_by_issuer' });
  });

  it('recusa, segunda resposta vira 409, token errado 403, id inválido 400, inexistente 404', async () => {
    const o = await salvarOrcamento();
    await http()
      .post(`/api/publico/orcamentos/${o.id}/recusar?token=${o.tokenAprovacao}`)
      .expect(200, /RECUSADO/);
    const conflito = await http()
      .post(`/api/publico/orcamentos/${o.id}/aprovar?token=${o.tokenAprovacao}`)
      .expect(409);
    expect(conflito.body).toMatchObject({ statusCode: 409, path: expect.stringContaining(o.id) });
    expect(typeof conflito.body.timestamp).toBe('number');
    await http().get(`/api/publico/orcamentos/${o.id}?token=errado`).expect(403);
    await http().get('/api/publico/orcamentos/nao-uuid?token=x').expect(400);
    await http()
      .get('/api/publico/orcamentos/6f1c2c1e-8d5c-4c62-9f0b-1b2d3c4d5e6f?token=x')
      .expect(404);
  });

  it('valida o corpo do pagamento', async () => {
    const o = await salvarOrcamento();
    await http()
      .post(`/api/publico/orcamentos/${o.id}/pagar?token=${o.tokenAprovacao}`)
      .send({ ...cartao(), installments: 0, extra: 1 })
      .expect(400);
  });

  describe('página de checkout', () => {
    const pagina = (id: string, token: string) =>
      http().get(`/api/publico/orcamentos/${id}/checkout?token=${token}`);

    it('devolve HTML com o resumo, os dados embutidos e cabeçalhos de segurança (modo fake)', async () => {
      const o = await salvarOrcamento();
      const r = await pagina(o.id, o.tokenAprovacao).expect(200);
      expect(r.headers['content-type']).toContain('text/html');
      expect(r.headers['referrer-policy']).toBe('no-referrer');
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.text).toContain('OS #OS-0001');
      expect(r.text).toContain('Troca de óleo');
      expect(r.text).toContain('R$\u00a0190,50');
      expect(r.text).not.toContain('sdk.mercadopago.com');
      const dados = JSON.parse(
        /<script id="dados" type="application\/json">(.*?)<\/script>/s.exec(r.text)![1],
      );
      expect(dados.pagamento).toEqual({ modo: 'fake', publicKey: null });
      expect(dados.orcamento).toMatchObject({ id: o.id, status: 'PENDENTE', pagamento: null });
      expect(dados.orcamento.tokenAprovacao).toBeUndefined();
    });

    it('embute o estado do pagamento com o motivo amigável da recusa', async () => {
      const o = await salvarOrcamento();
      await http()
        .post(`/api/publico/orcamentos/${o.id}/aprovar?token=${o.tokenAprovacao}`)
        .expect(200);
      await cobrar(o.id);
      const antes = await http()
        .get(`/api/publico/orcamentos/${o.id}?token=${o.tokenAprovacao}`)
        .expect(200);
      expect(antes.body.pagamento).toMatchObject({ status: 'AGUARDANDO', mensagemRecusa: null });
      await http()
        .post(`/api/publico/orcamentos/${o.id}/pagar?token=${o.tokenAprovacao}`)
        .send(cartao('fake-recusado'))
        .expect(200);
      const r = await pagina(o.id, o.tokenAprovacao).expect(200);
      const dados = JSON.parse(
        /<script id="dados" type="application\/json">(.*?)<\/script>/s.exec(r.text)![1],
      );
      expect(dados.orcamento.pagamento).toMatchObject({
        status: 'RECUSADO',
        motivoRecusa: 'rejected_by_issuer',
        mensagemRecusa: 'O banco emissor do cartão recusou o pagamento.',
      });
      const json = await http()
        .get(`/api/publico/orcamentos/${o.id}?token=${o.tokenAprovacao}`)
        .expect(200);
      expect(json.body.pagamento.status).toBe('RECUSADO');
    });

    it('escapa dados do cliente no HTML e no JSON embutido', async () => {
      const o = novoOrcamento();
      (o.cliente as { nome: string }).nome = '<script>alert(1)</script>';
      await uow.executar((tx) => tx.orcamentos.salvar(o));
      const r = await pagina(o.id, o.tokenAprovacao).expect(200);
      expect(r.text).not.toContain('<script>alert(1)</script>');
      expect(r.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(r.text).toContain('\\u003cscript>alert(1)\\u003c/script>');
    });

    it('token inválido, id inexistente ou malformado e falha interna viram páginas de erro', async () => {
      const o = await salvarOrcamento();
      const proibido = await pagina(o.id, 'errado').expect(403);
      expect(proibido.headers['content-type']).toContain('text/html');
      expect(proibido.text).toContain('Link inválido');
      expect(
        (await pagina('6f1c2c1e-8d5c-4c62-9f0b-1b2d3c4d5e6f', 'x').expect(404)).text,
      ).toContain('Orçamento não encontrado');
      expect((await pagina('nao-uuid', 'x').expect(404)).text).toContain(
        'Orçamento não encontrado',
      );
      jest.spyOn(uow, 'executar').mockRejectedValueOnce(new Error('db fora'));
      expect((await pagina(o.id, o.tokenAprovacao).expect(500)).text).toContain('Algo deu errado');
    });

    it('no modo mercadopago carrega o SDK e entrega a chave pública', async () => {
      await app.close();
      app = await criarApp({
        JWT_SECRET,
        MP_MODO: 'mercadopago',
        MP_PUBLIC_KEY: 'TEST-chave-publica',
      });
      const o = await salvarOrcamento();
      const r = await pagina(o.id, o.tokenAprovacao).expect(200);
      expect(r.text).toContain('<script src="https://sdk.mercadopago.com/js/v2"></script>');
      expect(r.text).toContain(
        '"pagamento":{"modo":"mercadopago","publicKey":"TEST-chave-publica"}',
      );
    });
  });

  it('erro inesperado vira 500', async () => {
    jest.spyOn(uow, 'executar').mockRejectedValueOnce(new Error('db fora'));
    await http()
      .get('/api/publico/orcamentos/6f1c2c1e-8d5c-4c62-9f0b-1b2d3c4d5e6f?token=x')
      .expect(500);
  });

  describe('rotas administrativas', () => {
    const bearer = () =>
      `Bearer ${sign({ sub: 'u-1' }, JWT_SECRET, { algorithm: 'HS256', expiresIn: 60 })}`;

    it('exigem JWT válido', async () => {
      await http().get('/api/orcamentos').expect(401);
      await http()
        .get('/api/orcamentos')
        .set('Authorization', `Bearer ${sign({ sub: 'u' }, 'outro-segredo')}`)
        .expect(401);
    });

    it('listam e detalham orçamentos e pagamentos', async () => {
      const o = await salvarOrcamento();
      const p = await cobrar(o.id);
      const lista = await http()
        .get('/api/orcamentos?osId=os-1')
        .set('Authorization', bearer())
        .expect(200);
      expect(lista.body).toHaveLength(1);
      await http().get(`/api/orcamentos/${o.id}`).set('Authorization', bearer()).expect(200);
      const pag = await http()
        .get(`/api/pagamentos/${p.id}`)
        .set('Authorization', bearer())
        .expect(200);
      expect(pag.body).toMatchObject({ id: p.id, status: 'AGUARDANDO', valor: 190.5 });
    });
  });

  describe('webhook do Mercado Pago', () => {
    const assinar = (
      dataId: string,
      requestId: string,
      ts = '1763121600000',
      segredo = MP_WEBHOOK_SECRET,
    ) =>
      `ts=${ts},v1=${createHmac('sha256', segredo)
        .update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`)
        .digest('hex')}`;

    it('com assinatura válida reconcilia a order', async () => {
      const o = await salvarOrcamento();
      const p = await cobrar(o.id);
      const order = await gateway.criarPagamento({
        ...cartao(),
        pagamentoId: p.id,
        osId: 'os-1',
        valor: 1,
      });

      const r = await http()
        .post(`/api/webhooks/mercadopago?data.id=${order.gatewayId}&type=order`)
        .set('x-signature', assinar(order.gatewayId, 'req-1'))
        .set('x-request-id', 'req-1')
        .send({ type: 'order', action: 'order.processed', data: { id: order.gatewayId } })
        .expect(200);
      expect(r.body).toEqual({ recebido: true, status: 'APROVADO' });
      expect(uow.eventos.map((e) => e.tipo)).toEqual(['PagamentoAprovado']);
    });

    it('ignora tópicos que não são order e order sem pagamento local', async () => {
      await http()
        .post('/api/webhooks/mercadopago?data.id=123&type=payment')
        .set('x-signature', assinar('123', 'r'))
        .set('x-request-id', 'r')
        .send({})
        .expect(200, { recebido: true, ignorado: true });

      const order = await gateway.criarPagamento({
        ...cartao(),
        pagamentoId: 'x',
        osId: 'os-x',
        valor: 1,
      });
      await http()
        .post('/api/webhooks/mercadopago')
        .set('x-signature', assinar(order.gatewayId, 'r'))
        .set('x-request-id', 'r')
        .send({ type: 'order', data: { id: order.gatewayId } })
        .expect(200, { recebido: true, status: null });
    });

    it('rejeita assinatura inválida', async () => {
      await http()
        .post('/api/webhooks/mercadopago?data.id=ORD1&type=order')
        .set('x-signature', assinar('ORD1', 'r', '1', 'segredo-errado'))
        .set('x-request-id', 'r')
        .send({})
        .expect(401);
    });

    it('rejeita tudo quando MP_WEBHOOK_SECRET não está definido', async () => {
      await app.close();
      app = await criarApp({ JWT_SECRET });
      await http()
        .post('/api/webhooks/mercadopago?data.id=ORD1&type=order')
        .set('x-signature', assinar('ORD1', 'r'))
        .set('x-request-id', 'r')
        .send({})
        .expect(401);
    });
  });
});
