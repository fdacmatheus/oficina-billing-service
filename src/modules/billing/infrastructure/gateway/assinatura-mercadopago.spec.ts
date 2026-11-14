import { createHmac } from 'node:crypto';
import { assinaturaValida } from './assinatura-mercadopago';

const segredo = 'segredo-de-teste';
const assinar = (manifesto: string) =>
  createHmac('sha256', segredo).update(manifesto).digest('hex');

describe('assinaturaValida', () => {
  const ts = '1742505638683';
  const requestId = '2066ca19-c6f1-498a-be75-1923005edd06';

  it('aceita o manifesto id;request-id;ts com data.id em minúsculas', () => {
    const v1 = assinar(`id:ord01jq4s4ky8;request-id:${requestId};ts:${ts};`);
    expect(
      assinaturaValida({
        assinatura: `ts=${ts},v1=${v1}`,
        requestId,
        dataId: 'ORD01JQ4S4KY8',
        segredo,
      }),
    ).toBe(true);
  });

  it('aceita o data.id original (exemplo da API de Orders)', () => {
    const v1 = assinar(`id:ORD01JQ4S4KY8;request-id:${requestId};ts:${ts};`);
    expect(
      assinaturaValida({
        assinatura: `ts=${ts}, v1=${v1}`,
        requestId,
        dataId: 'ORD01JQ4S4KY8',
        segredo,
      }),
    ).toBe(true);
  });

  it('omite do manifesto os pares ausentes', () => {
    const v1 = assinar(`ts:${ts};`);
    expect(assinaturaValida({ assinatura: `ts=${ts},v1=${v1}`, segredo })).toBe(true);
  });

  it('rejeita assinatura errada, incompleta, ausente ou sem segredo', () => {
    const v1 = assinar(`id:x;request-id:${requestId};ts:${ts};`);
    expect(
      assinaturaValida({ assinatura: `ts=${ts},v1=${v1}`, requestId, dataId: 'y', segredo }),
    ).toBe(false);
    expect(
      assinaturaValida({ assinatura: `ts=${ts},v1=abc`, requestId, dataId: 'x', segredo }),
    ).toBe(false);
    expect(assinaturaValida({ assinatura: `v1=${v1}`, segredo })).toBe(false);
    expect(assinaturaValida({ assinatura: undefined, segredo })).toBe(false);
    expect(assinaturaValida({ assinatura: `ts=${ts},v1=${v1}`, requestId, dataId: 'x' })).toBe(
      false,
    );
  });
});
