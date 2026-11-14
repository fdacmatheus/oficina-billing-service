import { ConfigService } from '@nestjs/config';
import type { Envelope, Eventos, TipoEvento } from '../shared/mensageria/contrato';
import { MetricasService } from '../shared/observabilidade/metricas.service';
import type {
  PagamentoGateway,
  ResultadoGateway,
  Transacao,
  UnidadeDeTrabalho,
} from '../modules/billing/application/portas';
import { Orcamento } from '../modules/billing/domain/orcamento.entity';
import { Pagamento } from '../modules/billing/domain/pagamento.entity';

// Copia profunda mantendo a classe, como se a entidade fosse relida do banco.
const clonar = <T extends object>(obj: T): T =>
  Object.assign(Object.create(Object.getPrototypeOf(obj)), structuredClone({ ...obj }));

const clonarMapa = <T extends object>(mapa: Map<string, T>) =>
  new Map([...mapa].map(([k, v]) => [k, clonar(v)]));

export interface EventoGravado {
  tipo: TipoEvento;
  payload: Eventos[TipoEvento];
  correlationId: string;
}

/** Unidade de trabalho em memoria, com rollback quando a funcao lanca. */
export class UnidadeDeTrabalhoFake implements UnidadeDeTrabalho {
  orcamentos = new Map<string, Orcamento>();
  pagamentos = new Map<string, Pagamento>();
  eventos: EventoGravado[] = [];
  inbox = new Set<string>();

  async executar<T>(fn: (tx: Transacao) => Promise<T>): Promise<T> {
    const antes = {
      orcamentos: clonarMapa(this.orcamentos),
      pagamentos: clonarMapa(this.pagamentos),
      eventos: [...this.eventos],
      inbox: new Set(this.inbox),
    };
    const achar = <E extends object>(mapa: Map<string, E>, filtro: (e: E) => boolean) => {
      const achado = [...mapa.values()].find(filtro);
      return achado ? clonar(achado) : null;
    };
    try {
      return await fn({
        orcamentos: {
          salvar: async (o) => void this.orcamentos.set(o.id, clonar(o)),
          buscarPorId: async (id) => achar(this.orcamentos, (o) => o.id === id),
          buscarPorOsId: async (osId) => achar(this.orcamentos, (o) => o.osId === osId),
          listar: async ({ osId }) =>
            [...this.orcamentos.values()].filter((o) => !osId || o.osId === osId).map(clonar),
        },
        pagamentos: {
          salvar: async (p) => void this.pagamentos.set(p.id, clonar(p)),
          buscarPorId: async (id) => achar(this.pagamentos, (p) => p.id === id),
          buscarPorOrcamentoId: async (id) => achar(this.pagamentos, (p) => p.orcamentoId === id),
          buscarPorGatewayId: async (id) => achar(this.pagamentos, (p) => p.gatewayId === id),
          buscarPorOsId: async (id) => achar(this.pagamentos, (p) => p.osId === id),
        },
        eventos: {
          publicar: async (tipo, payload, correlationId) =>
            void this.eventos.push({ tipo, payload, correlationId }),
        },
        inbox: {
          registrar: async (messageId) => {
            if (this.inbox.has(messageId)) return false;
            this.inbox.add(messageId);
            return true;
          },
        },
      });
    } catch (erro) {
      Object.assign(this, antes);
      throw erro;
    }
  }
}

export const gatewayFake = (): jest.Mocked<PagamentoGateway> => ({
  criarPagamento: jest.fn(),
  consultar: jest.fn(),
  estornar: jest.fn(),
});

export const resultado = (parcial: Partial<ResultadoGateway> = {}): ResultadoGateway => ({
  gatewayId: 'ORD123',
  situacao: 'APROVADO',
  detalhe: 'accredited',
  ...parcial,
});

export const configFake = (valores: Record<string, string> = {}) =>
  new ConfigService({
    PUBLIC_BASE_URL: 'http://billing.local/',
    SQS_OS_EVENTOS_URL: 'http://sqs/os-eventos',
    SQS_BILLING_COMANDOS_URL: 'http://sqs/billing-comandos',
    ...valores,
  });

export const metricas = () => new MetricasService();

export const valorMetrica = async (m: MetricasService, nome: string, rotulos = '') => {
  const texto = await m.expor();
  const linha = texto
    .split('\n')
    .find((l) => l.startsWith(`${nome}${rotulos ? `{${rotulos}}` : ''} `));
  return linha ? Number(linha.split(' ').pop()) : 0;
};

export const novoOrcamento = (osId = 'os-1') =>
  Orcamento.criar({
    osId,
    osNumero: 'OS-0001',
    cliente: { id: 'c-1', nome: 'Ana', email: 'ana@exemplo.com', documento: '12345678909' },
    itens: [
      {
        tipo: 'SERVICO',
        referenciaId: 's-1',
        descricao: 'Troca de óleo',
        quantidade: 1,
        precoUnitario: 120.1,
      },
      {
        tipo: 'PECA',
        referenciaId: 'p-1',
        descricao: 'Filtro',
        quantidade: 2,
        precoUnitario: 35.2,
      },
    ],
  });

export const envelope = (
  type: string,
  payload: unknown,
  messageId = `m-${Math.random()}`,
): Envelope => ({
  messageId,
  type,
  correlationId: 'os-1',
  occurredAt: Date.now(),
  source: 'os-service',
  payload,
});
