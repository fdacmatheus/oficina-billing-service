import { ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  it('erro que não é Error vira 500 genérico', () => {
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) };
    const host = {
      switchToHttp: () => ({
        getResponse: () => res,
        getRequest: () => ({ method: 'GET', url: '/x' }),
      }),
    } as unknown as ArgumentsHost;
    new HttpExceptionFilter().catch('falha crua', host);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, path: '/x', message: 'Internal server error' }),
    );
  });
});
