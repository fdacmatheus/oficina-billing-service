import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MetricasService } from '../../../shared/observabilidade/metricas.service';
import { Orcamento } from '../domain/orcamento.entity';
import { Pagamento } from '../domain/pagamento.entity';
import { Transacao, UNIDADE_DE_TRABALHO, UnidadeDeTrabalho } from './portas';

/** Consulta e resposta do cliente ao orcamento (link publico) e consultas administrativas. */
@Injectable()
export class OrcamentosService {
  constructor(
    @Inject(UNIDADE_DE_TRABALHO) private readonly uow: UnidadeDeTrabalho,
    private readonly metricas: MetricasService,
  ) {}

  /** Orcamento e, se ja houve cobranca, o pagamento: tudo o que a pagina de checkout precisa. */
  consultarPublico(
    id: string,
    token: string | undefined,
  ): Promise<{ orcamento: Orcamento; pagamento: Pagamento | null }> {
    return this.uow.executar(async (tx) => {
      const orcamento = await exigirOrcamentoComToken(tx, id, token);
      return { orcamento, pagamento: await tx.pagamentos.buscarPorOrcamentoId(orcamento.id) };
    });
  }

  async aprovar(id: string, token: string | undefined): Promise<Orcamento> {
    const orcamento = await this.uow.executar(async (tx) => {
      const orcamento = await exigirOrcamentoComToken(tx, id, token);
      orcamento.aprovar();
      await tx.orcamentos.salvar(orcamento);
      await tx.eventos.publicar(
        'OrcamentoAprovado',
        { osId: orcamento.osId, orcamentoId: orcamento.id },
        orcamento.osId,
      );
      return orcamento;
    });
    this.metricas.respostasOrcamento.inc({ resposta: 'aprovado' });
    return orcamento;
  }

  async recusar(id: string, token: string | undefined): Promise<Orcamento> {
    const orcamento = await this.uow.executar(async (tx) => {
      const orcamento = await exigirOrcamentoComToken(tx, id, token);
      orcamento.recusar();
      await tx.orcamentos.salvar(orcamento);
      await tx.eventos.publicar(
        'OrcamentoRecusado',
        { osId: orcamento.osId, orcamentoId: orcamento.id },
        orcamento.osId,
      );
      return orcamento;
    });
    this.metricas.respostasOrcamento.inc({ resposta: 'recusado' });
    return orcamento;
  }

  listar(osId?: string): Promise<Orcamento[]> {
    return this.uow.executar((tx) => tx.orcamentos.listar({ osId }));
  }

  async buscar(id: string): Promise<Orcamento> {
    const orcamento = await this.uow.executar((tx) => tx.orcamentos.buscarPorId(id));
    if (!orcamento) throw new NotFoundException(`Orçamento ${id} não encontrado`);
    return orcamento;
  }
}

export async function exigirOrcamentoComToken(
  tx: Transacao,
  id: string,
  token: string | undefined,
): Promise<Orcamento> {
  const orcamento = await tx.orcamentos.buscarPorId(id);
  if (!orcamento) throw new NotFoundException(`Orçamento ${id} não encontrado`);
  if (!orcamento.tokenConfere(token)) throw new ForbiddenException('Token do orçamento inválido');
  return orcamento;
}
