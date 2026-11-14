import type { Eventos, TipoEvento } from '../../../shared/mensageria/contrato';
import type { OrcamentoRepository, PagamentoRepository } from '../domain/repositorios';

/** Grava o evento no outbox, na transacao corrente. */
export interface PublicadorEventos {
  publicar<T extends TipoEvento>(
    tipo: T,
    payload: Eventos[T],
    correlationId: string,
  ): Promise<void>;
}

/** Registro de mensagens ja processadas. Retorna false se a mensagem e repetida. */
export interface Inbox {
  registrar(messageId: string, tipo: string): Promise<boolean>;
}

export interface Transacao {
  orcamentos: OrcamentoRepository;
  pagamentos: PagamentoRepository;
  eventos: PublicadorEventos;
  inbox: Inbox;
}

export const UNIDADE_DE_TRABALHO = Symbol('UNIDADE_DE_TRABALHO');

/** Tudo o que acontece dentro de `fn` e confirmado ou desfeito junto. */
export interface UnidadeDeTrabalho {
  executar<T>(fn: (tx: Transacao) => Promise<T>): Promise<T>;
}

export const PAGAMENTO_GATEWAY = Symbol('PAGAMENTO_GATEWAY');

export type SituacaoGateway = 'APROVADO' | 'RECUSADO' | 'PENDENTE' | 'ESTORNADO';

export interface ResultadoGateway {
  gatewayId: string;
  situacao: SituacaoGateway;
  detalhe: string;
  /** external_reference da order, que e o osId. */
  referenciaExterna?: string;
}

export interface DadosCobranca {
  pagamentoId: string;
  osId: string;
  valor: number;
  cardToken: string;
  paymentMethodId: string;
  installments: number;
  payerEmail: string;
}

export interface PagamentoGateway {
  criarPagamento(dados: DadosCobranca): Promise<ResultadoGateway>;
  consultar(gatewayId: string): Promise<ResultadoGateway>;
  estornar(gatewayId: string, pagamentoId: string): Promise<void>;
}
