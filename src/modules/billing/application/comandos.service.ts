import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Comandos, Envelope } from '../../../shared/mensageria/contrato';
import { MetricasService } from '../../../shared/observabilidade/metricas.service';
import { ErroDominio } from '../domain/erro-dominio';
import { Orcamento, StatusOrcamento } from '../domain/orcamento.entity';
import { Pagamento, StatusPagamento } from '../domain/pagamento.entity';
import {
  PAGAMENTO_GATEWAY,
  PagamentoGateway,
  Transacao,
  UNIDADE_DE_TRABALHO,
  UnidadeDeTrabalho,
} from './portas';

export type ResultadoComando = 'processada' | 'repetida' | 'descartada';

type Efeitos = Array<() => void>;

/**
 * Trata os comandos da fila billing-comandos.
 *
 * O registro no inbox, a mudanca de estado e o evento no outbox acontecem na
 * mesma transacao: ou tudo e gravado, ou nada e, e a mensagem volta para a fila.
 */
@Injectable()
export class ComandosService {
  private readonly logger = new Logger(ComandosService.name);
  private readonly baseUrl: string;

  constructor(
    @Inject(UNIDADE_DE_TRABALHO) private readonly uow: UnidadeDeTrabalho,
    @Inject(PAGAMENTO_GATEWAY) private readonly gateway: PagamentoGateway,
    private readonly metricas: MetricasService,
    config: ConfigService,
  ) {
    this.baseUrl = config
      .get<string>('PUBLIC_BASE_URL', 'http://localhost:3002')
      .replace(/\/$/, '');
  }

  async processar(envelope: Envelope): Promise<ResultadoComando> {
    const efeitos: Efeitos = [];
    const resultado = await this.uow.executar<ResultadoComando>(async (tx) => {
      if (!(await tx.inbox.registrar(envelope.messageId, envelope.type))) return 'repetida';
      try {
        await this.despachar(tx, envelope, efeitos);
        return 'processada';
      } catch (erro) {
        // Regra de negocio violada: repetir nao muda nada, entao a mensagem e
        // marcada como processada em vez de ir para a DLQ.
        if (erro instanceof ErroDominio) {
          this.logger.warn(`${envelope.type} descartado: ${erro.message}`);
          return 'descartada';
        }
        throw erro;
      }
    });
    if (resultado === 'processada') efeitos.forEach((efeito) => efeito());
    return resultado;
  }

  private async despachar(tx: Transacao, envelope: Envelope, efeitos: Efeitos): Promise<void> {
    const { correlationId } = envelope;
    switch (envelope.type) {
      case 'GerarOrcamento':
        return this.gerar(
          tx,
          envelope.payload as Comandos['GerarOrcamento'],
          correlationId,
          efeitos,
        );
      case 'CobrarOrcamento':
        return this.cobrar(tx, envelope.payload as Comandos['CobrarOrcamento']);
      case 'CancelarOrcamento':
        return this.cancelar(tx, envelope.payload as Comandos['CancelarOrcamento'], correlationId);
      case 'EstornarPagamento':
        return this.estornar(
          tx,
          envelope.payload as Comandos['EstornarPagamento'],
          correlationId,
          efeitos,
        );
      default:
        throw new ErroDominio(`Tipo de comando desconhecido: ${envelope.type}`);
    }
  }

  private async gerar(
    tx: Transacao,
    payload: Comandos['GerarOrcamento'],
    correlationId: string,
    efeitos: Efeitos,
  ): Promise<void> {
    let orcamento = await tx.orcamentos.buscarPorOsId(payload.osId);
    if (!orcamento) {
      orcamento = Orcamento.criar(payload);
      await tx.orcamentos.salvar(orcamento);
      efeitos.push(() => this.metricas.orcamentosGerados.inc());
    }
    await tx.eventos.publicar(
      'OrcamentoGerado',
      {
        osId: orcamento.osId,
        orcamentoId: orcamento.id,
        valorTotal: orcamento.valorTotal,
        // Pagina de checkout: o cliente aprova e paga no mesmo link.
        linkAprovacao: `${this.baseUrl}/api/publico/orcamentos/${orcamento.id}/checkout?token=${orcamento.tokenAprovacao}`,
      },
      correlationId,
    );
  }

  private async cobrar(tx: Transacao, payload: Comandos['CobrarOrcamento']): Promise<void> {
    const orcamento = await this.exigirOrcamento(tx, payload.orcamentoId);
    if (await tx.pagamentos.buscarPorOrcamentoId(orcamento.id)) return;
    if (orcamento.status !== StatusOrcamento.APROVADO) {
      throw new ErroDominio(`Orçamento ${orcamento.status.toLowerCase()} não pode ser cobrado`);
    }
    await tx.pagamentos.salvar(
      Pagamento.criar({
        orcamentoId: orcamento.id,
        osId: orcamento.osId,
        valor: orcamento.valorTotal,
      }),
    );
  }

  private async cancelar(
    tx: Transacao,
    payload: Comandos['CancelarOrcamento'],
    correlationId: string,
  ): Promise<void> {
    const orcamento = await this.exigirOrcamento(tx, payload.orcamentoId);
    if (orcamento.cancelar()) await tx.orcamentos.salvar(orcamento);
    await tx.eventos.publicar(
      'OrcamentoCancelado',
      { osId: orcamento.osId, orcamentoId: orcamento.id },
      correlationId,
    );
  }

  private async estornar(
    tx: Transacao,
    payload: Comandos['EstornarPagamento'],
    correlationId: string,
    efeitos: Efeitos,
  ): Promise<void> {
    const pagamento = await tx.pagamentos.buscarPorId(payload.pagamentoId);
    if (!pagamento) throw new ErroDominio(`Pagamento ${payload.pagamentoId} não encontrado`);

    if (pagamento.status !== StatusPagamento.ESTORNADO) {
      pagamento.estornar();
      // ponytail: chamada HTTP dentro da transacao segura uma conexao ate o
      // timeout do gateway; mover para um passo separado se o volume crescer.
      // Falha aqui desfaz a transacao e a mensagem volta para a fila; a chave
      // de idempotencia torna a nova tentativa segura.
      await this.gateway.estornar(pagamento.gatewayId as string, pagamento.id);
      await tx.pagamentos.salvar(pagamento);
      efeitos.push(() => this.metricas.estornos.inc());
    }
    await tx.eventos.publicar(
      'PagamentoEstornado',
      { osId: pagamento.osId, pagamentoId: pagamento.id },
      correlationId,
    );
  }

  private async exigirOrcamento(tx: Transacao, id: string): Promise<Orcamento> {
    const orcamento = await tx.orcamentos.buscarPorId(id);
    if (!orcamento) throw new ErroDominio(`Orçamento ${id} não encontrado`);
    return orcamento;
  }
}
