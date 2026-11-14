import { BadGatewayException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  UnidadeDeTrabalhoFake,
  gatewayFake,
  metricas,
  novoOrcamento,
  resultado,
  valorMetrica,
} from '../../../test-utils/fakes';
import { Pagamento, StatusPagamento } from '../domain/pagamento.entity';
import { PagamentosService } from './pagamentos.service';

const cartao = {
  cardToken: 'tok',
  paymentMethodId: 'visa',
  installments: 1,
  payerEmail: 'ana@exemplo.com',
};

describe('PagamentosService', () => {
  let uow: UnidadeDeTrabalhoFake;
  let gateway: ReturnType<typeof gatewayFake>;
  let m: ReturnType<typeof metricas>;
  let service: PagamentosService;

  beforeEach(() => {
    uow = new UnidadeDeTrabalhoFake();
    gateway = gatewayFake();
    m = metricas();
    service = new PagamentosService(uow, gateway, m);
  });

  const preparar = async ({ aprovar = true, cobrar = true } = {}) => {
    const orcamento = novoOrcamento();
    if (aprovar) orcamento.aprovar();
    const pagamento = Pagamento.criar({
      orcamentoId: orcamento.id,
      osId: orcamento.osId,
      valor: orcamento.valorTotal,
    });
    await uow.executar(async (tx) => {
      await tx.orcamentos.salvar(orcamento);
      if (cobrar) await tx.pagamentos.salvar(pagamento);
    });
    return { orcamento, pagamento };
  };

  describe('pagar', () => {
    it('aprovado: chama o gateway com o id do pagamento e publica PagamentoAprovado', async () => {
      const { orcamento, pagamento } = await preparar();
      gateway.criarPagamento.mockResolvedValue(resultado());
      const r = await service.pagar(orcamento.id, orcamento.tokenAprovacao, cartao);
      expect(gateway.criarPagamento).toHaveBeenCalledWith({
        ...cartao,
        pagamentoId: pagamento.id,
        osId: 'os-1',
        valor: 190.5,
      });
      expect(r.status).toBe(StatusPagamento.APROVADO);
      expect(r.gatewayId).toBe('ORD123');
      expect(uow.eventos).toEqual([
        {
          tipo: 'PagamentoAprovado',
          correlationId: 'os-1',
          payload: {
            osId: 'os-1',
            orcamentoId: orcamento.id,
            pagamentoId: pagamento.id,
            valor: 190.5,
          },
        },
      ]);
      expect(await valorMetrica(m, 'oficina_billing_pagamentos_total', 'status="APROVADO"')).toBe(
        1,
      );
    });

    it('recusado: publica PagamentoRecusado com o motivo', async () => {
      const { orcamento, pagamento } = await preparar();
      gateway.criarPagamento.mockResolvedValue(
        resultado({ situacao: 'RECUSADO', detalhe: 'rejected_by_issuer' }),
      );
      const r = await service.pagar(orcamento.id, orcamento.tokenAprovacao, cartao);
      expect(r.status).toBe(StatusPagamento.RECUSADO);
      expect(r.motivoRecusa).toBe('rejected_by_issuer');
      expect(uow.eventos[0]).toMatchObject({
        tipo: 'PagamentoRecusado',
        payload: { pagamentoId: pagamento.id, motivo: 'rejected_by_issuer' },
      });
    });

    it('pendente: guarda o id da order e continua aguardando', async () => {
      const { orcamento, pagamento } = await preparar();
      gateway.criarPagamento.mockResolvedValue(
        resultado({ situacao: 'PENDENTE', detalhe: 'in_review' }),
      );
      const r = await service.pagar(orcamento.id, orcamento.tokenAprovacao, cartao);
      expect(r.status).toBe(StatusPagamento.AGUARDANDO);
      expect(uow.pagamentos.get(pagamento.id)?.gatewayId).toBe('ORD123');
      expect(uow.eventos).toHaveLength(0);
    });

    it('sem pagamento aguardando (ou orçamento não aprovado) responde 409', async () => {
      const { orcamento } = await preparar({ cobrar: false });
      await expect(
        service.pagar(orcamento.id, orcamento.tokenAprovacao, cartao),
      ).rejects.toBeInstanceOf(ConflictException);
      const outro = await preparar({ aprovar: false });
      await expect(
        service.pagar(outro.orcamento.id, outro.orcamento.tokenAprovacao, cartao),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(gateway.criarPagamento).not.toHaveBeenCalled();
    });

    it('não paga duas vezes', async () => {
      const { orcamento } = await preparar();
      gateway.criarPagamento.mockResolvedValue(resultado());
      await service.pagar(orcamento.id, orcamento.tokenAprovacao, cartao);
      await expect(
        service.pagar(orcamento.id, orcamento.tokenAprovacao, cartao),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('falha do gateway vira 502 e o pagamento segue aguardando', async () => {
      const { orcamento, pagamento } = await preparar();
      gateway.criarPagamento.mockRejectedValue(new Error('timeout'));
      await expect(
        service.pagar(orcamento.id, orcamento.tokenAprovacao, cartao),
      ).rejects.toBeInstanceOf(BadGatewayException);
      expect(uow.pagamentos.get(pagamento.id)?.status).toBe(StatusPagamento.AGUARDANDO);
    });
  });

  describe('reconciliar (webhook)', () => {
    it('acha o pagamento pelo id da order e aprova', async () => {
      const { pagamento } = await preparar();
      await uow.executar(async (tx) => {
        const p = (await tx.pagamentos.buscarPorId(pagamento.id)) as Pagamento;
        p.vincularGateway('ORD123');
        await tx.pagamentos.salvar(p);
      });
      gateway.consultar.mockResolvedValue(resultado());
      expect((await service.reconciliar('ORD123'))?.status).toBe(StatusPagamento.APROVADO);
      expect(gateway.consultar).toHaveBeenCalledWith('ORD123');
      // Segundo webhook igual nao publica de novo.
      await service.reconciliar('ORD123');
      expect(uow.eventos).toHaveLength(1);
    });

    it('acha pelo external_reference (osId) quando a order não foi vinculada', async () => {
      await preparar();
      gateway.consultar.mockResolvedValue(
        resultado({ situacao: 'RECUSADO', detalhe: 'expired', referenciaExterna: 'os-1' }),
      );
      expect((await service.reconciliar('ORD123'))?.status).toBe(StatusPagamento.RECUSADO);
    });

    it('estorno feito fora do serviço marca ESTORNADO e publica', async () => {
      const { pagamento } = await preparar();
      gateway.criarPagamento.mockResolvedValue(resultado());
      const { orcamento } = { orcamento: uow.orcamentos.values().next().value! };
      await service.pagar(orcamento.id, orcamento.tokenAprovacao, cartao);
      gateway.consultar.mockResolvedValue(resultado({ situacao: 'ESTORNADO' }));
      expect((await service.reconciliar('ORD123'))?.status).toBe(StatusPagamento.ESTORNADO);
      expect(uow.eventos.map((e) => e.tipo)).toEqual(['PagamentoAprovado', 'PagamentoEstornado']);
      expect(uow.eventos[1].payload).toEqual({ osId: 'os-1', pagamentoId: pagamento.id });
      expect(await valorMetrica(m, 'oficina_billing_estornos_total')).toBe(1);
    });

    it('order desconhecida é ignorada', async () => {
      gateway.consultar.mockResolvedValue(resultado());
      expect(await service.reconciliar('ORD-X')).toBeNull();
      gateway.consultar.mockResolvedValue(resultado({ referenciaExterna: 'os-x' }));
      expect(await service.reconciliar('ORD-X')).toBeNull();
    });
  });

  it('busca por id', async () => {
    const { pagamento } = await preparar();
    expect((await service.buscar(pagamento.id)).id).toBe(pagamento.id);
    await expect(service.buscar('x')).rejects.toBeInstanceOf(NotFoundException);
  });
});
