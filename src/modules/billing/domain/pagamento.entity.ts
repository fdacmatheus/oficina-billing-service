import { randomUUID } from 'node:crypto';
import { ErroDominio } from './erro-dominio';

export enum StatusPagamento {
  AGUARDANDO = 'AGUARDANDO',
  APROVADO = 'APROVADO',
  RECUSADO = 'RECUSADO',
  ESTORNADO = 'ESTORNADO',
}

export interface PagamentoProps {
  id: string;
  orcamentoId: string;
  osId: string;
  valor: number;
  status: StatusPagamento;
  gatewayId: string | null;
  motivoRecusa: string | null;
  /** Unix epoch em ms. */
  criadoEm: number;
  atualizadoEm: number;
}

export class Pagamento {
  constructor(private readonly props: PagamentoProps) {}

  static criar(dados: { orcamentoId: string; osId: string; valor: number }): Pagamento {
    const agora = Date.now();
    return new Pagamento({
      ...dados,
      criadoEm: agora,
      atualizadoEm: agora,
      id: randomUUID(),
      status: StatusPagamento.AGUARDANDO,
      gatewayId: null,
      motivoRecusa: null,
    });
  }

  get id(): string {
    return this.props.id;
  }
  get orcamentoId(): string {
    return this.props.orcamentoId;
  }
  get osId(): string {
    return this.props.osId;
  }
  get valor(): number {
    return this.props.valor;
  }
  get status(): StatusPagamento {
    return this.props.status;
  }
  get gatewayId(): string | null {
    return this.props.gatewayId;
  }
  get motivoRecusa(): string | null {
    return this.props.motivoRecusa;
  }
  get criadoEm(): number {
    return this.props.criadoEm;
  }
  get atualizadoEm(): number {
    return this.props.atualizadoEm;
  }

  get aguardando(): boolean {
    return this.props.status === StatusPagamento.AGUARDANDO;
  }

  vincularGateway(gatewayId: string): void {
    this.props.gatewayId = gatewayId;
    this.props.atualizadoEm = Date.now();
  }

  aprovar(gatewayId: string): void {
    this.exigirAguardando();
    this.props.gatewayId = gatewayId;
    this.props.status = StatusPagamento.APROVADO;
    this.props.atualizadoEm = Date.now();
  }

  recusar(gatewayId: string | null, motivo: string): void {
    this.exigirAguardando();
    this.props.gatewayId = gatewayId ?? this.props.gatewayId;
    this.props.motivoRecusa = motivo;
    this.props.status = StatusPagamento.RECUSADO;
    this.props.atualizadoEm = Date.now();
  }

  estornar(): void {
    if (this.props.status !== StatusPagamento.APROVADO) {
      throw new ErroDominio(`Pagamento ${this.props.status.toLowerCase()} não pode ser estornado`);
    }
    this.props.status = StatusPagamento.ESTORNADO;
    this.props.atualizadoEm = Date.now();
  }

  private exigirAguardando(): void {
    if (!this.aguardando) {
      throw new ErroDominio(`Pagamento já está ${this.props.status.toLowerCase()}`);
    }
  }
}
