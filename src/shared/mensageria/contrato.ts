import { randomUUID } from 'node:crypto';
import { traceparentAtual } from '../observabilidade/telemetria';

/** Copia local do CONTRATO-MENSAGENS.md da Fase 4. Mudar la primeiro. */
export interface Envelope<P = unknown> {
  messageId: string;
  type: string;
  correlationId: string;
  /** Unix epoch em ms. */
  occurredAt: number;
  source: string;
  payload: P;
  /** W3C traceparent do contexto em que a mensagem foi criada; costura o trace da OS entre servicos. */
  traceparent?: string;
}

export const ORIGEM = 'billing-service';

export interface ItemComando {
  tipo: 'SERVICO' | 'PECA';
  referenciaId: string;
  descricao: string;
  quantidade: number;
  precoUnitario: number;
}

export interface Comandos {
  GerarOrcamento: {
    osId: string;
    osNumero: string;
    cliente: { id: string; nome: string; email: string; documento: string };
    itens: ItemComando[];
  };
  CobrarOrcamento: { osId: string; orcamentoId: string };
  CancelarOrcamento: { osId: string; orcamentoId: string; motivo: string };
  EstornarPagamento: { osId: string; pagamentoId: string; motivo: string };
}

export interface Eventos {
  OrcamentoGerado: { osId: string; orcamentoId: string; valorTotal: number; linkAprovacao: string };
  OrcamentoAprovado: { osId: string; orcamentoId: string };
  OrcamentoRecusado: { osId: string; orcamentoId: string };
  OrcamentoCancelado: { osId: string; orcamentoId: string };
  PagamentoAprovado: { osId: string; orcamentoId: string; pagamentoId: string; valor: number };
  PagamentoRecusado: { osId: string; orcamentoId: string; pagamentoId: string; motivo: string };
  PagamentoEstornado: { osId: string; pagamentoId: string };
}

export type TipoEvento = keyof Eventos;

export function criarEnvelope<P>(type: string, payload: P, correlationId: string): Envelope<P> {
  return {
    messageId: randomUUID(),
    type,
    correlationId,
    occurredAt: Date.now(),
    source: ORIGEM,
    payload,
    traceparent: traceparentAtual(),
  };
}
