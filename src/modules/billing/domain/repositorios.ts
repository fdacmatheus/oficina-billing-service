import { Orcamento } from './orcamento.entity';
import { Pagamento } from './pagamento.entity';

export interface OrcamentoRepository {
  salvar(orcamento: Orcamento): Promise<void>;
  buscarPorId(id: string): Promise<Orcamento | null>;
  buscarPorOsId(osId: string): Promise<Orcamento | null>;
  listar(filtro: { osId?: string }): Promise<Orcamento[]>;
}

export interface PagamentoRepository {
  salvar(pagamento: Pagamento): Promise<void>;
  buscarPorId(id: string): Promise<Pagamento | null>;
  buscarPorOrcamentoId(orcamentoId: string): Promise<Pagamento | null>;
  buscarPorGatewayId(gatewayId: string): Promise<Pagamento | null>;
  buscarPorOsId(osId: string): Promise<Pagamento | null>;
}
