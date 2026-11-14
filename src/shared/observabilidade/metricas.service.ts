import { Injectable, OnModuleInit } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Registro central das metricas expostas em `/api/metrics`.
 *
 * As metricas HTTP mantem os nomes da Fase 3 para reaproveitar os dashboards;
 * as de negocio usam o prefixo `oficina_billing_`.
 */
@Injectable()
export class MetricasService implements OnModuleInit {
  readonly registry = new Registry();

  readonly requisicoes = new Counter({
    name: 'http_requests_total',
    help: 'Total de requisicoes HTTP',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });

  readonly duracaoRequisicao = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duracao das requisicoes HTTP em segundos',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  readonly orcamentosGerados = new Counter({
    name: 'oficina_billing_orcamentos_gerados_total',
    help: 'Orcamentos gerados',
    registers: [this.registry],
  });

  readonly respostasOrcamento = new Counter({
    name: 'oficina_billing_orcamento_respostas_total',
    help: 'Respostas do cliente ao orcamento',
    labelNames: ['resposta'] as const,
    registers: [this.registry],
  });

  readonly pagamentos = new Counter({
    name: 'oficina_billing_pagamentos_total',
    help: 'Pagamentos por status final',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });

  readonly estornos = new Counter({
    name: 'oficina_billing_estornos_total',
    help: 'Pagamentos estornados',
    registers: [this.registry],
  });

  /** Mesmo nome da Fase 3, que ja tem alerta configurado no Grafana. */
  readonly falhasIntegracao = new Counter({
    name: 'oficina_integracao_falhas_total',
    help: 'Falhas nas integracoes externas',
    labelNames: ['integracao', 'operacao'] as const,
    registers: [this.registry],
  });

  readonly mensagensConsumidas = new Counter({
    name: 'oficina_billing_mensagens_consumidas_total',
    help: 'Mensagens consumidas da fila billing-comandos',
    labelNames: ['tipo', 'resultado'] as const,
    registers: [this.registry],
  });

  readonly mensagensPublicadas = new Counter({
    name: 'oficina_billing_mensagens_publicadas_total',
    help: 'Mensagens publicadas pelo outbox',
    labelNames: ['tipo'] as const,
    registers: [this.registry],
  });

  onModuleInit(): void {
    collectDefaultMetrics({ register: this.registry, prefix: 'oficina_billing_' });
  }

  async expor(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
