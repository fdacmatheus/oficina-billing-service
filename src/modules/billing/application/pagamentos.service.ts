import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MetricasService } from '../../../shared/observabilidade/metricas.service';
import { StatusOrcamento } from '../domain/orcamento.entity';
import { Pagamento, StatusPagamento } from '../domain/pagamento.entity';
import { exigirOrcamentoComToken } from './orcamentos.service';
import {
  DadosCobranca,
  PAGAMENTO_GATEWAY,
  PagamentoGateway,
  ResultadoGateway,
  Transacao,
  UNIDADE_DE_TRABALHO,
  UnidadeDeTrabalho,
} from './portas';

export type DadosCartao = Pick<
  DadosCobranca,
  'cardToken' | 'paymentMethodId' | 'installments' | 'payerEmail'
>;

@Injectable()
export class PagamentosService {
  private readonly logger = new Logger(PagamentosService.name);

  constructor(
    @Inject(UNIDADE_DE_TRABALHO) private readonly uow: UnidadeDeTrabalho,
    @Inject(PAGAMENTO_GATEWAY) private readonly gateway: PagamentoGateway,
    private readonly metricas: MetricasService,
  ) {}

  /** Pagamento pelo cliente com o cartao tokenizado no navegador (checkout transparente). */
  async pagar(orcamentoId: string, token: string | undefined, cartao: DadosCartao) {
    const pagamento = await this.uow.executar(async (tx) => {
      const orcamento = await exigirOrcamentoComToken(tx, orcamentoId, token);
      const pagamento = await tx.pagamentos.buscarPorOrcamentoId(orcamento.id);
      if (orcamento.status !== StatusOrcamento.APROVADO || !pagamento?.aguardando) {
        throw new ConflictException('Não há pagamento aguardando para este orçamento');
      }
      return pagamento;
    });

    // Fora da transacao: nao segura conexao do banco durante a chamada externa.
    // O id do pagamento e a chave de idempotencia, entao repetir e seguro.
    let resultado: ResultadoGateway;
    try {
      resultado = await this.gateway.criarPagamento({
        ...cartao,
        pagamentoId: pagamento.id,
        osId: pagamento.osId,
        valor: pagamento.valor,
      });
    } catch (erro) {
      this.logger.error(`Falha ao cobrar pagamento ${pagamento.id}: ${String(erro)}`);
      throw new BadGatewayException('Falha ao processar o pagamento, tente novamente');
    }

    return this.aplicar(pagamento.id, resultado);
  }

  /** Webhook do Mercado Pago: consulta a order e reconcilia o pagamento local. */
  async reconciliar(gatewayId: string): Promise<Pagamento | null> {
    const resultado = await this.gateway.consultar(gatewayId);
    const pagamento = await this.uow.executar(
      async (tx) =>
        (await tx.pagamentos.buscarPorGatewayId(gatewayId)) ??
        (resultado.referenciaExterna
          ? await tx.pagamentos.buscarPorOsId(resultado.referenciaExterna)
          : null),
    );
    if (!pagamento) {
      this.logger.warn(`Webhook de order ${gatewayId} sem pagamento correspondente`);
      return null;
    }
    return this.aplicar(pagamento.id, resultado);
  }

  async buscar(id: string): Promise<Pagamento> {
    const pagamento = await this.uow.executar((tx) => tx.pagamentos.buscarPorId(id));
    if (!pagamento) throw new NotFoundException(`Pagamento ${id} não encontrado`);
    return pagamento;
  }

  private async aplicar(pagamentoId: string, resultado: ResultadoGateway): Promise<Pagamento> {
    let mudou: StatusPagamento | undefined;
    const pagamento = await this.uow.executar(async (tx) => {
      // Relido dentro da transacao: o webhook pode ter chegado primeiro.
      const pagamento = (await tx.pagamentos.buscarPorId(pagamentoId)) as Pagamento;
      mudou = await this.transicionar(tx, pagamento, resultado);
      return pagamento;
    });
    if (mudou === StatusPagamento.ESTORNADO) this.metricas.estornos.inc();
    else if (mudou) this.metricas.pagamentos.inc({ status: mudou });
    return pagamento;
  }

  private async transicionar(
    tx: Transacao,
    pagamento: Pagamento,
    resultado: ResultadoGateway,
  ): Promise<StatusPagamento | undefined> {
    const { osId, orcamentoId, id: pagamentoId } = pagamento;

    if (pagamento.aguardando && resultado.situacao === 'APROVADO') {
      pagamento.aprovar(resultado.gatewayId);
      await tx.pagamentos.salvar(pagamento);
      await tx.eventos.publicar(
        'PagamentoAprovado',
        { osId, orcamentoId, pagamentoId, valor: pagamento.valor },
        osId,
      );
      return pagamento.status;
    }

    if (pagamento.aguardando && resultado.situacao === 'RECUSADO') {
      pagamento.recusar(resultado.gatewayId, resultado.detalhe);
      await tx.pagamentos.salvar(pagamento);
      await tx.eventos.publicar(
        'PagamentoRecusado',
        { osId, orcamentoId, pagamentoId, motivo: resultado.detalhe },
        osId,
      );
      return pagamento.status;
    }

    // Estorno feito direto no painel do Mercado Pago tambem chega pelo webhook.
    if (pagamento.status === StatusPagamento.APROVADO && resultado.situacao === 'ESTORNADO') {
      pagamento.estornar();
      await tx.pagamentos.salvar(pagamento);
      await tx.eventos.publicar('PagamentoEstornado', { osId, pagamentoId }, osId);
      return pagamento.status;
    }

    // Pendente (ex.: em analise antifraude): guarda o id da order para o webhook achar.
    if (pagamento.aguardando && pagamento.gatewayId !== resultado.gatewayId) {
      pagamento.vincularGateway(resultado.gatewayId);
      await tx.pagamentos.salvar(pagamento);
    }
    return undefined;
  }
}
