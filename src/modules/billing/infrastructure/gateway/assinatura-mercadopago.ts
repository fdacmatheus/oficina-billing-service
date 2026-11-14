import { createHmac, timingSafeEqual } from 'node:crypto';

export interface DadosAssinatura {
  /** Cabecalho x-signature: `ts=<ms>,v1=<hex>`. */
  assinatura?: string;
  /** Cabecalho x-request-id. */
  requestId?: string;
  /** Query string `data.id`. */
  dataId?: string;
  segredo?: string;
}

/**
 * Valida o x-signature dos webhooks do Mercado Pago:
 * HMAC-SHA256(segredo, `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`), comparado com v1.
 * Pares ausentes na notificacao saem do manifesto, como manda a documentacao.
 */
export function assinaturaValida({
  assinatura,
  requestId,
  dataId,
  segredo,
}: DadosAssinatura): boolean {
  if (!segredo || !assinatura) return false;

  const partes = new Map(
    assinatura.split(',').map((parte) => {
      const [chave, ...valor] = parte.split('=');
      return [chave.trim(), valor.join('=').trim()] as const;
    }),
  );
  const ts = partes.get('ts');
  const v1 = partes.get('v1');
  if (!ts || !v1) return false;

  const manifesto = (id?: string) =>
    `${id ? `id:${id};` : ''}${requestId ? `request-id:${requestId};` : ''}ts:${ts};`;

  // A doc pede data.id em minusculas quando alfanumerico, mas os exemplos da
  // API de Orders usam o id original; as duas formas sao aceitas.
  const candidatos = new Set([manifesto(dataId?.toLowerCase()), manifesto(dataId)]);
  const recebido = Buffer.from(v1);
  return [...candidatos].some((texto) => {
    const esperado = Buffer.from(createHmac('sha256', segredo).update(texto).digest('hex'));
    return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
  });
}
