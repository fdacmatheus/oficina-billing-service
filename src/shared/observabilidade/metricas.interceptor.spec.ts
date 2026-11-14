import { CallHandler, ExecutionContext } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { of } from 'rxjs';
import { metricas, valorMetrica } from '../../test-utils/fakes';
import { MetricasInterceptor } from './metricas.interceptor';

describe('MetricasInterceptor', () => {
  const next: CallHandler = { handle: () => of('ok') };

  const contexto = (tipo: string, req: object, res: object) =>
    ({
      getType: () => tipo,
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    }) as unknown as ExecutionContext;

  it('ignora contextos que não são HTTP', () => {
    const m = metricas();
    const switchToHttp = jest.fn();
    const ctx = { getType: () => 'rpc', switchToHttp } as unknown as ExecutionContext;
    new MetricasInterceptor(m).intercept(ctx, next);
    expect(switchToHttp).not.toHaveBeenCalled();
  });

  it('sem rota nem path registra como desconhecida', async () => {
    const m = metricas();
    const res = Object.assign(new EventEmitter(), { statusCode: 404 });
    new MetricasInterceptor(m).intercept(contexto('http', { method: 'GET' }, res), next);
    res.emit('finish');
    expect(
      await valorMetrica(
        m,
        'http_requests_total',
        'method="GET",route="desconhecida",status="404"',
      ),
    ).toBe(1);
    expect(await valorMetrica(m, 'http_requests_total', 'method="POST",route="x",status="1"')).toBe(
      0,
    );
  });
});
