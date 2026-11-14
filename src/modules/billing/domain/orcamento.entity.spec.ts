import { novoOrcamento } from '../../../test-utils/fakes';
import { ErroDominio } from './erro-dominio';
import { Orcamento, StatusOrcamento } from './orcamento.entity';

describe('Orcamento', () => {
  it('calcula o total em centavos, nasce PENDENTE e com token aleatório', () => {
    const antes = Date.now();
    const o = novoOrcamento();
    expect(o.valorTotal).toBe(190.5);
    expect(o.status).toBe(StatusOrcamento.PENDENTE);
    expect(o.tokenAprovacao).toMatch(/^[0-9a-f]{48}$/);
    expect(novoOrcamento().tokenAprovacao).not.toBe(o.tokenAprovacao);
    expect(o.criadoEm).toBeGreaterThanOrEqual(antes);
    expect(o.atualizadoEm).toBe(o.criadoEm);
    expect(o.osNumero).toBe('OS-0001');
    expect(o.cliente.nome).toBe('Ana');
    expect(o.itens).toHaveLength(2);
  });

  it('rejeita orçamento sem itens ou com item inválido', () => {
    const base = { osId: 'x', osNumero: '1', cliente: novoOrcamento().cliente };
    expect(() => Orcamento.criar({ ...base, itens: [] })).toThrow(ErroDominio);
    expect(() =>
      Orcamento.criar({
        ...base,
        itens: [
          { tipo: 'PECA', referenciaId: 'p', descricao: 'd', quantidade: 0, precoUnitario: 1 },
        ],
      }),
    ).toThrow('Item inválido');
    expect(() =>
      Orcamento.criar({
        ...base,
        itens: [
          { tipo: 'PECA', referenciaId: 'p', descricao: 'd', quantidade: 1, precoUnitario: -1 },
        ],
      }),
    ).toThrow(ErroDominio);
  });

  it('confere o token', () => {
    const o = novoOrcamento();
    expect(o.tokenConfere(o.tokenAprovacao)).toBe(true);
    expect(o.tokenConfere('errado')).toBe(false);
    expect(o.tokenConfere(undefined)).toBe(false);
  });

  it('aprova e recusa só quando pendente', () => {
    const a = novoOrcamento();
    a.aprovar();
    expect(a.status).toBe(StatusOrcamento.APROVADO);
    expect(() => a.recusar()).toThrow('aprovado não pode ser alterado');

    const r = novoOrcamento();
    r.recusar();
    expect(r.status).toBe(StatusOrcamento.RECUSADO);
    expect(() => r.aprovar()).toThrow(ErroDominio);
  });

  it('cancela de forma idempotente e não cancela recusado', () => {
    const o = novoOrcamento();
    o.aprovar();
    expect(o.cancelar()).toBe(true);
    expect(o.status).toBe(StatusOrcamento.CANCELADO);
    expect(o.cancelar()).toBe(false);

    const r = novoOrcamento();
    r.recusar();
    expect(() => r.cancelar()).toThrow(ErroDominio);
  });
});
