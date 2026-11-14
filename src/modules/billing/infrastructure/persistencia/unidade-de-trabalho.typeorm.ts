import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, FindOptionsWhere } from 'typeorm';
import { criarEnvelope, Eventos, TipoEvento } from '../../../../shared/mensageria/contrato';
import { Orcamento, StatusOrcamento } from '../../domain/orcamento.entity';
import { Pagamento, StatusPagamento } from '../../domain/pagamento.entity';
import { OrcamentoRepository, PagamentoRepository } from '../../domain/repositorios';
import { Inbox, PublicadorEventos, Transacao, UnidadeDeTrabalho } from '../../application/portas';
import { OrcamentoOrmEntity } from './orcamento.orm-entity';
import { PagamentoOrmEntity } from './pagamento.orm-entity';

// Toda leitura por id trava a linha: a transacao que chegar depois (webhook x
// resposta do checkout, aprovar x cancelar) espera e enxerga o estado novo.
const TRAVA = { mode: 'pessimistic_write' } as const;

export class OrcamentoTypeOrmRepository implements OrcamentoRepository {
  constructor(private readonly manager: EntityManager) {}

  private get repo() {
    return this.manager.getRepository(OrcamentoOrmEntity);
  }

  async salvar(orcamento: Orcamento): Promise<void> {
    await this.repo.save({
      id: orcamento.id,
      osId: orcamento.osId,
      osNumero: orcamento.osNumero,
      cliente: orcamento.cliente,
      itens: orcamento.itens,
      valorTotal: orcamento.valorTotal.toFixed(2),
      status: orcamento.status,
      tokenAprovacao: orcamento.tokenAprovacao,
      criadoEm: orcamento.criadoEm,
      atualizadoEm: orcamento.atualizadoEm,
    });
  }

  async buscarPorId(id: string): Promise<Orcamento | null> {
    return paraOrcamento(await this.repo.findOne({ where: { id }, lock: TRAVA }));
  }

  async buscarPorOsId(osId: string): Promise<Orcamento | null> {
    return paraOrcamento(await this.repo.findOne({ where: { osId }, lock: TRAVA }));
  }

  async listar(filtro: { osId?: string }): Promise<Orcamento[]> {
    const lista = await this.repo.find({
      where: filtro.osId ? { osId: filtro.osId } : {},
      order: { criadoEm: 'DESC' },
      take: 100,
    });
    return lista.map((orm) => paraOrcamento(orm) as Orcamento);
  }
}

export class PagamentoTypeOrmRepository implements PagamentoRepository {
  constructor(private readonly manager: EntityManager) {}

  private get repo() {
    return this.manager.getRepository(PagamentoOrmEntity);
  }

  async salvar(pagamento: Pagamento): Promise<void> {
    await this.repo.save({
      id: pagamento.id,
      orcamentoId: pagamento.orcamentoId,
      osId: pagamento.osId,
      valor: pagamento.valor.toFixed(2),
      status: pagamento.status,
      gatewayId: pagamento.gatewayId,
      motivoRecusa: pagamento.motivoRecusa,
      criadoEm: pagamento.criadoEm,
      atualizadoEm: pagamento.atualizadoEm,
    });
  }

  private async buscar(where: FindOptionsWhere<PagamentoOrmEntity>): Promise<Pagamento | null> {
    return paraPagamento(await this.repo.findOne({ where, lock: TRAVA }));
  }

  buscarPorId(id: string) {
    return this.buscar({ id });
  }
  buscarPorOrcamentoId(orcamentoId: string) {
    return this.buscar({ orcamentoId });
  }
  buscarPorGatewayId(gatewayId: string) {
    return this.buscar({ gatewayId });
  }
  buscarPorOsId(osId: string) {
    return this.buscar({ osId });
  }
}

/** Outbox transacional: o evento e gravado junto com a mudanca de estado. */
export class OutboxTypeOrm implements PublicadorEventos {
  constructor(
    private readonly manager: EntityManager,
    private readonly filaDestino: string,
  ) {}

  async publicar<T extends TipoEvento>(tipo: T, payload: Eventos[T], correlationId: string) {
    const envelope = criarEnvelope(tipo, payload, correlationId);
    await this.manager.query(
      'INSERT INTO outbox (id, tipo, fila_destino, corpo, correlation_id, criada_em) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        envelope.messageId,
        tipo,
        this.filaDestino,
        JSON.stringify(envelope),
        correlationId,
        envelope.occurredAt,
      ],
    );
  }
}

export class InboxTypeOrm implements Inbox {
  constructor(private readonly manager: EntityManager) {}

  async registrar(messageId: string, tipo: string): Promise<boolean> {
    // Se outra transacao inseriu o mesmo id, esta espera o commit dela e nao insere nada.
    const linhas: unknown[] = await this.manager.query(
      'INSERT INTO mensagens_processadas (message_id, tipo, processada_em) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING message_id',
      [messageId, tipo, Date.now()],
    );
    return linhas.length > 0;
  }
}

@Injectable()
export class TypeOrmUnidadeDeTrabalho implements UnidadeDeTrabalho {
  private readonly filaEventos: string;

  constructor(
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.filaEventos = config.getOrThrow<string>('SQS_OS_EVENTOS_URL');
  }

  executar<T>(fn: (tx: Transacao) => Promise<T>): Promise<T> {
    return this.dataSource.transaction((manager) =>
      fn({
        orcamentos: new OrcamentoTypeOrmRepository(manager),
        pagamentos: new PagamentoTypeOrmRepository(manager),
        eventos: new OutboxTypeOrm(manager, this.filaEventos),
        inbox: new InboxTypeOrm(manager),
      }),
    );
  }
}

function paraOrcamento(orm: OrcamentoOrmEntity | null): Orcamento | null {
  if (!orm) return null;
  return new Orcamento({
    ...orm,
    valorTotal: Number(orm.valorTotal),
    status: orm.status as StatusOrcamento,
  });
}

function paraPagamento(orm: PagamentoOrmEntity | null): Pagamento | null {
  if (!orm) return null;
  return new Pagamento({
    ...orm,
    valor: Number(orm.valor),
    status: orm.status as StatusPagamento,
  });
}
