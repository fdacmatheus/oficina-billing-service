import { ErroDominio } from './erro-dominio';
import { Pagamento, StatusPagamento } from './pagamento.entity';

const novo = () => Pagamento.criar({ orcamentoId: 'o-1', osId: 'os-1', valor: 100 });

describe('Pagamento', () => {
  it('nasce AGUARDANDO sem vínculo com o gateway', () => {
    const p = novo();
    expect(p.status).toBe(StatusPagamento.AGUARDANDO);
    expect(p.aguardando).toBe(true);
    expect(p.gatewayId).toBeNull();
    expect(p.motivoRecusa).toBeNull();
    expect(p).toMatchObject({ orcamentoId: 'o-1', osId: 'os-1', valor: 100 });
    expect(p.criadoEm).toBe(p.atualizadoEm);
  });

  it('aprova e depois estorna', () => {
    const p = novo();
    p.aprovar('ORD1');
    expect(p.status).toBe(StatusPagamento.APROVADO);
    expect(p.gatewayId).toBe('ORD1');
    p.estornar();
    expect(p.status).toBe(StatusPagamento.ESTORNADO);
    expect(() => p.estornar()).toThrow(ErroDominio);
  });

  it('recusa guardando o motivo e mantém o gateway anterior quando não informado', () => {
    const p = novo();
    p.vincularGateway('ORD9');
    p.recusar(null, 'rejected_by_issuer');
    expect(p.status).toBe(StatusPagamento.RECUSADO);
    expect(p.gatewayId).toBe('ORD9');
    expect(p.motivoRecusa).toBe('rejected_by_issuer');
    expect(() => p.aprovar('ORD9')).toThrow('Pagamento já está recusado');
  });

  it('não estorna pagamento que não foi aprovado', () => {
    expect(() => novo().estornar()).toThrow('aguardando não pode ser estornado');
  });
});
