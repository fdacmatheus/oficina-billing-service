import { FakePagamentoGateway } from './fake.gateway';

const dados = (cardToken: string) => ({
  pagamentoId: 'pag-1',
  osId: 'os-1',
  valor: 10,
  cardToken,
  paymentMethodId: 'visa',
  installments: 1,
  payerEmail: 'a@b.com',
});

describe('FakePagamentoGateway', () => {
  it('aprova qualquer token e recusa os que começam com fake-recusado', async () => {
    const g = new FakePagamentoGateway();
    expect(await g.criarPagamento(dados('fake-aprovado'))).toMatchObject({
      gatewayId: 'fake-pag-1',
      situacao: 'APROVADO',
      referenciaExterna: 'os-1',
    });
    expect(await g.criarPagamento(dados('fake-recusado-saldo'))).toMatchObject({
      situacao: 'RECUSADO',
      detalhe: 'rejected_by_issuer',
    });
  });

  it('consulta e estorna o que criou', async () => {
    const g = new FakePagamentoGateway();
    await g.criarPagamento(dados('ok'));
    await g.estornar('fake-pag-1');
    expect((await g.consultar('fake-pag-1')).situacao).toBe('ESTORNADO');
    await expect(g.estornar('desconhecida')).resolves.toBeUndefined();
    await expect(g.consultar('desconhecida')).rejects.toThrow('não encontrada');
  });
});
