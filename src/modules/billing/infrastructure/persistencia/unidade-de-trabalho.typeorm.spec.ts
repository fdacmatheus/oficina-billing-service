import { DataSource, EntityManager } from 'typeorm';
import { configFake, novoOrcamento } from '../../../../test-utils/fakes';
import { Pagamento, StatusPagamento } from '../../domain/pagamento.entity';
import { StatusOrcamento } from '../../domain/orcamento.entity';
import { epochMs } from '../../../../shared/database/epoch-ms.transformer';
import { TypeOrmUnidadeDeTrabalho } from './unidade-de-trabalho.typeorm';

describe('TypeOrmUnidadeDeTrabalho', () => {
  const repo = { save: jest.fn(), findOne: jest.fn(), find: jest.fn() };
  const manager = {
    getRepository: jest.fn(() => repo),
    query: jest.fn(),
  } as unknown as EntityManager & { query: jest.Mock };
  const dataSource = {
    transaction: jest.fn((fn: (m: EntityManager) => unknown) => fn(manager)),
  } as unknown as DataSource;
  const uow = new TypeOrmUnidadeDeTrabalho(dataSource, configFake());
  const trava = { mode: 'pessimistic_write' };

  beforeEach(() => jest.clearAllMocks());

  it('salva e lê orçamento convertendo numeric e bigint', async () => {
    const o = novoOrcamento();
    await uow.executar((tx) => tx.orcamentos.salvar(o));
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: o.id,
        valorTotal: '190.50',
        status: 'PENDENTE',
        criadoEm: o.criadoEm,
      }),
    );

    repo.findOne.mockResolvedValue({ ...repo.save.mock.calls[0][0] });
    const lido = await uow.executar((tx) => tx.orcamentos.buscarPorId(o.id));
    expect(lido?.valorTotal).toBe(190.5);
    expect(lido?.status).toBe(StatusOrcamento.PENDENTE);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: o.id }, lock: trava });

    repo.findOne.mockResolvedValue(null);
    expect(await uow.executar((tx) => tx.orcamentos.buscarPorOsId('os-x'))).toBeNull();
    expect(repo.findOne).toHaveBeenLastCalledWith({ where: { osId: 'os-x' }, lock: trava });
  });

  it('lista orçamentos com e sem filtro', async () => {
    repo.find.mockResolvedValue([{ id: 'o-1', valorTotal: '1.50', status: 'APROVADO' }]);
    const [lido] = await uow.executar((tx) => tx.orcamentos.listar({}));
    expect(lido.valorTotal).toBe(1.5);
    expect(repo.find).toHaveBeenLastCalledWith(expect.objectContaining({ where: {} }));
    await uow.executar((tx) => tx.orcamentos.listar({ osId: 'os-1' }));
    expect(repo.find).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { osId: 'os-1' } }),
    );
  });

  it('salva e busca pagamentos pelas várias chaves', async () => {
    const p = Pagamento.criar({ orcamentoId: 'o-1', osId: 'os-1', valor: 10 });
    await uow.executar((tx) => tx.pagamentos.salvar(p));
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ valor: '10.00', gatewayId: null }),
    );

    repo.findOne.mockResolvedValue({ ...repo.save.mock.calls[0][0] });
    const lido = await uow.executar((tx) => tx.pagamentos.buscarPorId(p.id));
    expect(lido?.valor).toBe(10);
    expect(lido?.status).toBe(StatusPagamento.AGUARDANDO);

    repo.findOne.mockResolvedValue(null);
    await uow.executar(async (tx) => {
      await tx.pagamentos.buscarPorOrcamentoId('o-1');
      await tx.pagamentos.buscarPorGatewayId('ORD1');
      await tx.pagamentos.buscarPorOsId('os-1');
    });
    expect(repo.findOne.mock.calls.slice(-3).map((c) => c[0].where)).toEqual([
      { orcamentoId: 'o-1' },
      { gatewayId: 'ORD1' },
      { osId: 'os-1' },
    ]);
  });

  it('grava o envelope no outbox para a fila os-eventos', async () => {
    await uow.executar((tx) =>
      tx.eventos.publicar('OrcamentoAprovado', { osId: 'os-1', orcamentoId: 'o-1' }, 'os-1'),
    );
    const [sql, params] = manager.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO outbox');
    expect(params[1]).toBe('OrcamentoAprovado');
    expect(params[2]).toBe('http://sqs/os-eventos');
    expect(JSON.parse(params[3])).toMatchObject({
      messageId: params[0],
      type: 'OrcamentoAprovado',
      correlationId: 'os-1',
      source: 'billing-service',
      occurredAt: params[5],
      payload: { osId: 'os-1', orcamentoId: 'o-1' },
    });
    expect(typeof params[5]).toBe('number');
  });

  it('converte bigint do driver para number', () => {
    expect(epochMs.from('1763121600000')).toBe(1763121600000);
    expect(epochMs.from(null)).toBeNull();
    expect(epochMs.to(5)).toBe(5);
  });

  it('inbox devolve false quando o insert não retorna linha', async () => {
    manager.query.mockResolvedValueOnce([{ message_id: 'm1' }]).mockResolvedValueOnce([]);
    expect(await uow.executar((tx) => tx.inbox.registrar('m1', 'GerarOrcamento'))).toBe(true);
    expect(await uow.executar((tx) => tx.inbox.registrar('m1', 'GerarOrcamento'))).toBe(false);
    expect(manager.query.mock.calls[0][0]).toContain('ON CONFLICT DO NOTHING');
  });
});
