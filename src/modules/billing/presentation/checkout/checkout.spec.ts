import { motivoAmigavel } from './motivo-recusa';
import { SCRIPT } from './script';

describe('motivoAmigavel', () => {
  it.each([
    ['rejected_by_issuer', 'O banco emissor do cartão recusou o pagamento.'],
    ['cc_rejected_other_reason', 'O banco emissor do cartão recusou o pagamento.'],
    ['cc_rejected_insufficient_amount', 'O cartão não tem limite suficiente para este valor.'],
    ['cc_rejected_bad_filled_security_code', 'O código de segurança (CVV) não confere.'],
    ['cc_rejected_bad_filled_date', 'A data de validade do cartão não confere.'],
    ['cc_rejected_bad_filled_other', 'Algum dado do cartão foi preenchido incorretamente.'],
    [
      'cc_rejected_call_for_authorize',
      'O banco pediu que você autorize este pagamento. Fale com o seu banco.',
    ],
    ['cc_rejected_card_disabled', 'Este cartão está bloqueado ou desabilitado.'],
    ['cc_rejected_duplicated_payment', 'Já existe um pagamento igual feito há pouco.'],
    ['cc_rejected_max_attempts', 'O limite de tentativas com este cartão foi atingido.'],
    ['rejected_high_risk', 'O pagamento foi recusado pela análise de segurança.'],
  ])('%s', (detalhe, mensagem) => {
    expect(motivoAmigavel(detalhe)).toBe(mensagem);
  });

  it('código desconhecido ou ausente usa uma mensagem genérica', () => {
    expect(motivoAmigavel('failed')).toBe('O pagamento não foi aprovado pela operadora do cartão.');
    expect(motivoAmigavel(null)).toBe('O pagamento não foi aprovado pela operadora do cartão.');
  });
});

describe('script da página', () => {
  it('é JavaScript válido', () => {
    expect(() => new Function(SCRIPT)).not.toThrow();
  });
});
