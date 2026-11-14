// Codigos da API de Orders (rejected_by_issuer...) e os cc_rejected_* da API de Payments.
const MENSAGENS: Array<[RegExp, string]> = [
  [/insufficient_amount/, 'O cartão não tem limite suficiente para este valor.'],
  [/security_code/, 'O código de segurança (CVV) não confere.'],
  [/bad_filled_date|expir/, 'A data de validade do cartão não confere.'],
  [/bad_filled|insufficient_data/, 'Algum dado do cartão foi preenchido incorretamente.'],
  [/call_for_authorize/, 'O banco pediu que você autorize este pagamento. Fale com o seu banco.'],
  [/card_disabled|blacklist/, 'Este cartão está bloqueado ou desabilitado.'],
  [/duplicated/, 'Já existe um pagamento igual feito há pouco.'],
  [/max_attempts/, 'O limite de tentativas com este cartão foi atingido.'],
  [/high_risk|fraud/, 'O pagamento foi recusado pela análise de segurança.'],
  [/by_issuer|by_bank|other_reason/, 'O banco emissor do cartão recusou o pagamento.'],
];

/** Traduz o status_detail do Mercado Pago para uma frase que o cliente entende. */
export function motivoAmigavel(detalhe: string | null | undefined): string {
  const encontrado = MENSAGENS.find(([padrao]) => padrao.test(detalhe ?? ''));
  return encontrado ? encontrado[1] : 'O pagamento não foi aprovado pela operadora do cartão.';
}
