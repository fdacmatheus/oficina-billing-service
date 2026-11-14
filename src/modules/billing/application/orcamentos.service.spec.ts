import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  UnidadeDeTrabalhoFake,
  metricas,
  novoOrcamento,
  valorMetrica,
} from '../../../test-utils/fakes';
import { ErroDominio } from '../domain/erro-dominio';
import { StatusOrcamento } from '../domain/orcamento.entity';
import { OrcamentosService } from './orcamentos.service';

describe('OrcamentosService', () => {
  let uow: UnidadeDeTrabalhoFake;
  let m: ReturnType<typeof metricas>;
  let service: OrcamentosService;

  beforeEach(() => {
    uow = new UnidadeDeTrabalhoFake();
    m = metricas();
    service = new OrcamentosService(uow, m);
  });

  const salvar = async (osId = 'os-1') => {
    const o = novoOrcamento(osId);
    await uow.executar((tx) => tx.orcamentos.salvar(o));
    return o;
  };

  it('consulta com token válido e rejeita token inválido ou id inexistente', async () => {
    const o = await salvar();
    const consulta = await service.consultarPublico(o.id, o.tokenAprovacao);
    expect(consulta.orcamento.id).toBe(o.id);
    expect(consulta.pagamento).toBeNull();
    await expect(service.consultarPublico(o.id, 'x')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.consultarPublico('nao', 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('aprova, publica OrcamentoAprovado e conta a resposta', async () => {
    const o = await salvar();
    const aprovado = await service.aprovar(o.id, o.tokenAprovacao);
    expect(aprovado.status).toBe(StatusOrcamento.APROVADO);
    expect(uow.eventos).toEqual([
      {
        tipo: 'OrcamentoAprovado',
        payload: { osId: 'os-1', orcamentoId: o.id },
        correlationId: 'os-1',
      },
    ]);
    expect(
      await valorMetrica(m, 'oficina_billing_orcamento_respostas_total', 'resposta="aprovado"'),
    ).toBe(1);
  });

  it('recusa e publica OrcamentoRecusado', async () => {
    const o = await salvar();
    await service.recusar(o.id, o.tokenAprovacao);
    expect(uow.orcamentos.get(o.id)?.status).toBe(StatusOrcamento.RECUSADO);
    expect(uow.eventos[0].tipo).toBe('OrcamentoRecusado');
  });

  it('não aceita segunda resposta nem token errado', async () => {
    const o = await salvar();
    await service.aprovar(o.id, o.tokenAprovacao);
    await expect(service.recusar(o.id, o.tokenAprovacao)).rejects.toBeInstanceOf(ErroDominio);
    await expect(service.aprovar(o.id, 'errado')).rejects.toBeInstanceOf(ForbiddenException);
    expect(uow.eventos).toHaveLength(1);
  });

  it('lista com e sem filtro e busca por id', async () => {
    const a = await salvar('os-1');
    await salvar('os-2');
    expect(await service.listar()).toHaveLength(2);
    expect((await service.listar('os-1')).map((o) => o.id)).toEqual([a.id]);
    expect((await service.buscar(a.id)).osId).toBe('os-1');
    await expect(service.buscar('nao')).rejects.toBeInstanceOf(NotFoundException);
  });
});
