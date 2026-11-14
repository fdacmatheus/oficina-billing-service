import {
  UnidadeDeTrabalhoFake,
  configFake,
  envelope,
  gatewayFake,
  metricas,
  novoOrcamento,
  valorMetrica,
} from '../../../test-utils/fakes';
import { StatusOrcamento } from '../domain/orcamento.entity';
import { Pagamento, StatusPagamento } from '../domain/pagamento.entity';
import { ComandosService } from './comandos.service';

const gerar = {
  osId: 'os-1',
  osNumero: 'OS-0001',
  cliente: { id: 'c-1', nome: 'Ana', email: 'ana@exemplo.com', documento: '123' },
  itens: [
    {
      tipo: 'SERVICO',
      referenciaId: 's',
      descricao: 'Revisão',
      quantidade: 2,
      precoUnitario: 175.25,
    },
  ],
};

describe('ComandosService', () => {
  let uow: UnidadeDeTrabalhoFake;
  let gateway: ReturnType<typeof gatewayFake>;
  let m: ReturnType<typeof metricas>;
  let service: ComandosService;

  beforeEach(() => {
    uow = new UnidadeDeTrabalhoFake();
    gateway = gatewayFake();
    m = metricas();
    service = new ComandosService(uow, gateway, m, configFake());
  });

  const salvarOrcamento = async (aprovar = true) => {
    const o = novoOrcamento();
    if (aprovar) o.aprovar();
    await uow.executar((tx) => tx.orcamentos.salvar(o));
    return o;
  };

  describe('GerarOrcamento', () => {
    it('cria o orçamento e publica OrcamentoGerado com o link de aprovação', async () => {
      expect(await service.processar(envelope('GerarOrcamento', gerar))).toBe('processada');
      const [orcamento] = uow.orcamentos.values();
      expect(orcamento.valorTotal).toBe(350.5);
      expect(uow.eventos).toEqual([
        {
          tipo: 'OrcamentoGerado',
          correlationId: 'os-1',
          payload: {
            osId: 'os-1',
            orcamentoId: orcamento.id,
            valorTotal: 350.5,
            linkAprovacao: `http://billing.local/api/publico/orcamentos/${orcamento.id}/checkout?token=${orcamento.tokenAprovacao}`,
          },
        },
      ]);
      expect(await valorMetrica(m, 'oficina_billing_orcamentos_gerados_total')).toBe(1);
    });

    it('com a mesma OS republica o evento sem criar outro orçamento', async () => {
      await service.processar(envelope('GerarOrcamento', gerar));
      await service.processar(envelope('GerarOrcamento', gerar));
      expect(uow.orcamentos.size).toBe(1);
      expect(uow.eventos).toHaveLength(2);
      expect(uow.eventos[0].payload).toEqual(uow.eventos[1].payload);
      expect(await valorMetrica(m, 'oficina_billing_orcamentos_gerados_total')).toBe(1);
    });

    it('ignora mensagem repetida (mesmo messageId)', async () => {
      await service.processar(envelope('GerarOrcamento', gerar, 'msg-1'));
      expect(await service.processar(envelope('GerarOrcamento', gerar, 'msg-1'))).toBe('repetida');
      expect(uow.eventos).toHaveLength(1);
    });

    it('descarta comando com itens inválidos, mas registra no inbox', async () => {
      const r = await service.processar(
        envelope('GerarOrcamento', { ...gerar, itens: [] }, 'msg-2'),
      );
      expect(r).toBe('descartada');
      expect(uow.inbox.has('msg-2')).toBe(true);
      expect(uow.eventos).toHaveLength(0);
    });
  });

  it('descarta tipo desconhecido', async () => {
    expect(await service.processar(envelope('Qualquer', {}))).toBe('descartada');
  });

  describe('CobrarOrcamento', () => {
    it('cria pagamento AGUARDANDO com o valor do orçamento, uma vez só', async () => {
      const o = await salvarOrcamento();
      await service.processar(envelope('CobrarOrcamento', { osId: o.osId, orcamentoId: o.id }));
      await service.processar(envelope('CobrarOrcamento', { osId: o.osId, orcamentoId: o.id }));
      expect(uow.pagamentos.size).toBe(1);
      const [p] = uow.pagamentos.values();
      expect(p).toMatchObject({
        status: StatusPagamento.AGUARDANDO,
        valor: 190.5,
        orcamentoId: o.id,
      });
      expect(uow.eventos).toHaveLength(0);
    });

    it('descarta cobrança de orçamento não aprovado ou inexistente', async () => {
      const o = await salvarOrcamento(false);
      expect(
        await service.processar(envelope('CobrarOrcamento', { osId: 'os-1', orcamentoId: o.id })),
      ).toBe('descartada');
      expect(
        await service.processar(envelope('CobrarOrcamento', { osId: 'os-1', orcamentoId: 'nao' })),
      ).toBe('descartada');
      expect(uow.pagamentos.size).toBe(0);
    });
  });

  describe('CancelarOrcamento', () => {
    it('cancela e publica OrcamentoCancelado; repetido só republica', async () => {
      const o = await salvarOrcamento();
      const payload = { osId: o.osId, orcamentoId: o.id, motivo: 'sem estoque' };
      await service.processar(envelope('CancelarOrcamento', payload));
      await service.processar(envelope('CancelarOrcamento', payload));
      expect(uow.orcamentos.get(o.id)?.status).toBe(StatusOrcamento.CANCELADO);
      expect(uow.eventos.map((e) => e.tipo)).toEqual(['OrcamentoCancelado', 'OrcamentoCancelado']);
      expect(uow.eventos[0].payload).toEqual({ osId: o.osId, orcamentoId: o.id });
    });
  });

  describe('EstornarPagamento', () => {
    const salvarPagamento = async (aprovar = true) => {
      const p = Pagamento.criar({ orcamentoId: 'o-1', osId: 'os-1', valor: 100 });
      if (aprovar) p.aprovar('ORD1');
      await uow.executar((tx) => tx.pagamentos.salvar(p));
      return p;
    };

    it('estorna no gateway com chave de idempotência e publica PagamentoEstornado', async () => {
      const p = await salvarPagamento();
      gateway.estornar.mockResolvedValue();
      await service.processar(envelope('EstornarPagamento', { osId: 'os-1', pagamentoId: p.id }));
      expect(gateway.estornar).toHaveBeenCalledWith('ORD1', p.id);
      expect(uow.pagamentos.get(p.id)?.status).toBe(StatusPagamento.ESTORNADO);
      expect(uow.eventos[0]).toMatchObject({
        tipo: 'PagamentoEstornado',
        payload: { osId: 'os-1', pagamentoId: p.id },
      });
      expect(await valorMetrica(m, 'oficina_billing_estornos_total')).toBe(1);
    });

    it('já estornado: só republica, sem chamar o gateway', async () => {
      const p = await salvarPagamento();
      gateway.estornar.mockResolvedValue();
      await service.processar(envelope('EstornarPagamento', { osId: 'os-1', pagamentoId: p.id }));
      await service.processar(envelope('EstornarPagamento', { osId: 'os-1', pagamentoId: p.id }));
      expect(gateway.estornar).toHaveBeenCalledTimes(1);
      expect(uow.eventos).toHaveLength(2);
    });

    it('falha no gateway desfaz tudo, inclusive o inbox, para a mensagem voltar', async () => {
      const p = await salvarPagamento();
      gateway.estornar.mockRejectedValue(new Error('timeout'));
      await expect(
        service.processar(
          envelope('EstornarPagamento', { osId: 'os-1', pagamentoId: p.id }, 'm-x'),
        ),
      ).rejects.toThrow('timeout');
      expect(uow.inbox.has('m-x')).toBe(false);
      expect(uow.pagamentos.get(p.id)?.status).toBe(StatusPagamento.APROVADO);
      expect(uow.eventos).toHaveLength(0);
    });

    it('descarta estorno de pagamento inexistente ou não aprovado', async () => {
      const p = await salvarPagamento(false);
      expect(
        await service.processar(envelope('EstornarPagamento', { osId: 'os-1', pagamentoId: p.id })),
      ).toBe('descartada');
      expect(
        await service.processar(envelope('EstornarPagamento', { osId: 'os-1', pagamentoId: 'x' })),
      ).toBe('descartada');
      expect(gateway.estornar).not.toHaveBeenCalled();
    });
  });

  it('usa a URL padrão quando PUBLIC_BASE_URL não está definida', async () => {
    const s = new ComandosService(uow, gateway, m, configFake({ PUBLIC_BASE_URL: '' }));
    await s.processar(envelope('GerarOrcamento', gerar));
    expect(JSON.stringify(uow.eventos[0].payload)).toContain('/api/publico/orcamentos/');
  });
});
