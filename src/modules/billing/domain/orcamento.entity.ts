import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { ErroDominio } from './erro-dominio';

export enum StatusOrcamento {
  PENDENTE = 'PENDENTE',
  APROVADO = 'APROVADO',
  RECUSADO = 'RECUSADO',
  CANCELADO = 'CANCELADO',
}

export interface ClienteSnapshot {
  id: string;
  nome: string;
  email: string;
  documento: string;
}

export interface ItemOrcamento {
  tipo: 'SERVICO' | 'PECA';
  referenciaId: string;
  descricao: string;
  quantidade: number;
  precoUnitario: number;
}

export interface OrcamentoProps {
  id: string;
  osId: string;
  osNumero: string;
  cliente: ClienteSnapshot;
  itens: ItemOrcamento[];
  valorTotal: number;
  status: StatusOrcamento;
  tokenAprovacao: string;
  /** Unix epoch em ms. */
  criadoEm: number;
  atualizadoEm: number;
}

const centavos = (valor: number): number => Math.round(valor * 100);

export class Orcamento {
  constructor(private readonly props: OrcamentoProps) {}

  static criar(dados: {
    osId: string;
    osNumero: string;
    cliente: ClienteSnapshot;
    itens: ItemOrcamento[];
  }): Orcamento {
    if (!dados.itens.length) {
      throw new ErroDominio('Orçamento precisa de ao menos um item');
    }
    for (const item of dados.itens) {
      if (!(item.quantidade > 0) || !(item.precoUnitario >= 0)) {
        throw new ErroDominio(`Item inválido: ${item.descricao}`);
      }
    }
    // Soma em centavos para nao acumular erro de ponto flutuante.
    const total = dados.itens.reduce(
      (soma, item) => soma + Math.round(item.quantidade * centavos(item.precoUnitario)),
      0,
    );
    const agora = Date.now();
    return new Orcamento({
      ...dados,
      criadoEm: agora,
      atualizadoEm: agora,
      id: randomUUID(),
      valorTotal: total / 100,
      status: StatusOrcamento.PENDENTE,
      tokenAprovacao: randomBytes(24).toString('hex'),
    });
  }

  get id(): string {
    return this.props.id;
  }
  get osId(): string {
    return this.props.osId;
  }
  get osNumero(): string {
    return this.props.osNumero;
  }
  get cliente(): ClienteSnapshot {
    return this.props.cliente;
  }
  get itens(): ItemOrcamento[] {
    return this.props.itens;
  }
  get valorTotal(): number {
    return this.props.valorTotal;
  }
  get status(): StatusOrcamento {
    return this.props.status;
  }
  get tokenAprovacao(): string {
    return this.props.tokenAprovacao;
  }
  get criadoEm(): number {
    return this.props.criadoEm;
  }
  get atualizadoEm(): number {
    return this.props.atualizadoEm;
  }

  /** Comparacao em tempo constante: o token e a unica protecao das rotas publicas. */
  tokenConfere(token: string | undefined): boolean {
    const esperado = Buffer.from(this.props.tokenAprovacao);
    const recebido = Buffer.from(token ?? '');
    return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
  }

  aprovar(): void {
    this.transicionar(StatusOrcamento.APROVADO);
  }

  recusar(): void {
    this.transicionar(StatusOrcamento.RECUSADO);
  }

  /** Retorna false quando ja estava cancelado (comando repetido). */
  cancelar(): boolean {
    if (this.props.status === StatusOrcamento.CANCELADO) return false;
    if (this.props.status === StatusOrcamento.RECUSADO) {
      throw new ErroDominio('Orçamento recusado não pode ser cancelado');
    }
    this.props.status = StatusOrcamento.CANCELADO;
    this.props.atualizadoEm = Date.now();
    return true;
  }

  private transicionar(para: StatusOrcamento): void {
    if (this.props.status !== StatusOrcamento.PENDENTE) {
      throw new ErroDominio(`Orçamento ${this.props.status.toLowerCase()} não pode ser alterado`);
    }
    this.props.status = para;
    this.props.atualizadoEm = Date.now();
  }
}
