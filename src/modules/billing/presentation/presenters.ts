import { motivoAmigavel } from './checkout/motivo-recusa';
import { Orcamento } from '../domain/orcamento.entity';
import { Pagamento } from '../domain/pagamento.entity';

/** O token de aprovacao nunca sai nas respostas. */
export const apresentarOrcamento = (o: Orcamento) => ({
  id: o.id,
  osId: o.osId,
  osNumero: o.osNumero,
  cliente: o.cliente,
  itens: o.itens,
  valorTotal: o.valorTotal,
  status: o.status,
  criadoEm: o.criadoEm,
  atualizadoEm: o.atualizadoEm,
});

export const apresentarPagamento = (p: Pagamento) => ({
  id: p.id,
  orcamentoId: p.orcamentoId,
  osId: p.osId,
  valor: p.valor,
  status: p.status,
  gatewayId: p.gatewayId,
  motivoRecusa: p.motivoRecusa,
  criadoEm: p.criadoEm,
  atualizadoEm: p.atualizadoEm,
});

/** Resposta das rotas publicas: o orcamento e o andamento do pagamento, sem dados do gateway. */
export const apresentarConsultaPublica = ({
  orcamento,
  pagamento,
}: {
  orcamento: Orcamento;
  pagamento: Pagamento | null;
}) => ({
  ...apresentarOrcamento(orcamento),
  pagamento: pagamento && {
    id: pagamento.id,
    status: pagamento.status,
    valor: pagamento.valor,
    motivoRecusa: pagamento.motivoRecusa,
    mensagemRecusa: pagamento.motivoRecusa ? motivoAmigavel(pagamento.motivoRecusa) : null,
  },
});
