/**
 * JavaScript da pagina de checkout (sem framework, ES2017).
 *
 * Todas as chamadas sao relativas a URL da pagina (.../orcamentos/{id}/checkout),
 * entao funcionam com ou sem o prefixo do API Gateway (/billing).
 * Escrito sem template literals para nao colidir com a string TypeScript.
 */
export const SCRIPT = `
(function () {
  'use strict';
  var dados = JSON.parse(document.getElementById('dados').textContent);
  var estado = dados.orcamento;
  var config = dados.pagamento;
  var ID = estado.id;
  var token = new URLSearchParams(location.search).get('token') || '';
  var q = '?token=' + encodeURIComponent(token);
  var acao = document.getElementById('acao');
  var selo = document.getElementById('status');
  var brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var espera = null;
  var inicioEspera = 0;
  var demorou = false;
  var emAnalise = false;
  var brick = null;
  var faseAtual = null;

  var ICONES = {
    ok: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    x: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    info: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></svg>',
    volta: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>'
  };

  var SELOS = {
    pendente: ['Aguardando sua aprovação', 'alerta'],
    preparando: ['Aprovado', 'info'],
    pagar: ['Aguardando pagamento', 'info'],
    analise: ['Pagamento em análise', 'info'],
    pago: ['Pago', 'sucesso'],
    pagamentoRecusado: ['Pagamento recusado', 'perigo'],
    recusado: ['Recusado', 'perigo'],
    cancelado: ['Cancelado', 'neutro'],
    estornado: ['Estornado', 'neutro']
  };

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function valor() {
    return estado.pagamento ? estado.pagamento.valor : estado.valorTotal;
  }

  function api(metodo, caminho, corpo) {
    return fetch(caminho + q, {
      method: metodo,
      headers: corpo ? { 'Content-Type': 'application/json' } : {},
      body: corpo ? JSON.stringify(corpo) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (!r.ok) {
          var m = b && b.message;
          var e = new Error((m && (m.message || m)) || ('Erro ' + r.status));
          e.status = r.status;
          throw e;
        }
        return b;
      });
    });
  }

  function recarregar() {
    return api('GET', '../' + ID).then(function (b) { estado = b; render(); return b; });
  }

  function fase() {
    var o = estado.status;
    var p = estado.pagamento;
    if (p && p.status === 'APROVADO') return 'pago';
    if (p && p.status === 'RECUSADO') return 'pagamentoRecusado';
    if (p && p.status === 'ESTORNADO') return 'estornado';
    if (o === 'PENDENTE') return 'pendente';
    if (o === 'RECUSADO') return 'recusado';
    if (o === 'CANCELADO') return 'cancelado';
    if (p && p.status === 'AGUARDANDO') return emAnalise ? 'analise' : 'pagar';
    return 'preparando';
  }

  function mostrarErro(msg) {
    var e = document.getElementById('erro');
    if (!e) return;
    e.textContent = msg;
    e.hidden = false;
  }

  function ocupado(botao, texto) {
    Array.prototype.forEach.call(acao.querySelectorAll('button'), function (b) { b.disabled = true; });
    if (botao) botao.textContent = texto;
  }

  function falhou(erro) {
    if (erro.status === 409) return recarregar();
    render(true);
    mostrarErro(erro.status === 403
      ? 'Este link não é mais válido. Use o link mais recente enviado por e-mail.'
      : 'Não foi possível concluir agora. Verifique sua conexão e tente novamente.');
  }

  function responder(acaoOrcamento, botao, texto) {
    ocupado(botao, texto);
    api('POST', acaoOrcamento).then(function (b) {
      b.pagamento = estado.pagamento;
      estado = b;
      render();
    }).catch(falhou);
  }

  function pagar(dadosCartao) {
    return api('POST', 'pagar', dadosCartao).then(function (p) {
      emAnalise = p.status === 'AGUARDANDO';
      return recarregar();
    });
  }

  function estadoFinal(icone, classe, titulo, texto, detalhe) {
    acao.innerHTML = '<div class="estado"><div class="icone icone-' + classe + '">' + ICONES[icone] + '</div>' +
      '<h2>' + titulo + '</h2><p class="texto">' + texto + '</p>' +
      (detalhe ? '<p class="detalhe">' + detalhe + '</p>' : '') + '</div>';
  }

  function aguardando(titulo, texto) {
    if (demorou) {
      acao.innerHTML = '<div class="estado"><div class="icone icone-info">' + ICONES.info + '</div>' +
        '<h2>Está demorando mais que o normal</h2>' +
        '<p class="texto">Ainda não recebemos a confirmação. Você pode verificar de novo agora ou voltar a este link mais tarde.</p>' +
        '<div class="botoes" style="justify-content:center"><button class="btn btn-primario" id="de-novo">Verificar novamente</button></div></div>';
      document.getElementById('de-novo').onclick = function () { demorou = false; render(true); };
      return;
    }
    acao.innerHTML = '<div class="estado"><div class="giro" role="status" aria-label="Carregando"></div>' +
      '<h2>' + titulo + '</h2><p class="texto">' + texto + '</p></div>';
  }

  var TELAS = {
    pendente: function () {
      acao.innerHTML = '<h2>Revise e aprove o orçamento</h2>' +
        '<p class="texto">Ao aprovar, a oficina reserva as peças e o pagamento com cartão é liberado aqui mesmo, nesta página.</p>' +
        '<div class="botoes"><button class="btn btn-secundario" id="recusar">Recusar</button>' +
        '<button class="btn btn-primario" id="aprovar">Aprovar orçamento · ' + brl.format(estado.valorTotal) + '</button></div>' +
        '<p class="erro" id="erro" hidden></p>';
      var aprovar = document.getElementById('aprovar');
      aprovar.onclick = function () { responder('aprovar', aprovar, 'Aprovando…'); };
      document.getElementById('recusar').onclick = TELAS.confirmarRecusa;
    },
    confirmarRecusa: function () {
      acao.innerHTML = '<h2>Recusar o orçamento?</h2>' +
        '<p class="texto">A oficina será avisada e o serviço não será realizado. Essa resposta não pode ser desfeita por aqui.</p>' +
        '<div class="botoes"><button class="btn btn-secundario" id="voltar">Voltar</button>' +
        '<button class="btn btn-perigo" id="confirmar">Confirmar recusa</button></div>' +
        '<p class="erro" id="erro" hidden></p>';
      document.getElementById('voltar').onclick = function () { render(true); };
      var confirmar = document.getElementById('confirmar');
      confirmar.onclick = function () { responder('recusar', confirmar, 'Recusando…'); };
    },
    preparando: function () {
      aguardando('Orçamento aprovado!', 'Estamos reservando as peças e preparando a cobrança. Isso leva só alguns segundos.');
    },
    analise: function () {
      aguardando('Pagamento em análise', 'A operadora do cartão está analisando o pagamento. Esta página se atualiza sozinha.');
    },
    pagar: function () {
      acao.innerHTML = '<div class="pagamento-topo"><div><h2>Pagamento</h2>' +
        '<p class="texto" style="margin:0">Cartão de crédito, em até 12x.</p></div>' +
        '<strong>' + brl.format(valor()) + '</strong></div>' +
        '<div id="meio-pagamento"></div><p class="erro" id="erro" hidden></p>';
      if (config.modo === 'fake') return formularioFake();
      desmontarBrick();
      montarBrick();
    },
    pago: function () {
      estadoFinal('ok', 'sucesso', 'Pagamento aprovado!',
        'Recebemos ' + brl.format(valor()) + '. A oficina já foi avisada e o seu veículo entra na fila de execução. Você vai receber as atualizações por e-mail.',
        'Código do pagamento: ' + esc(estado.pagamento.id.slice(0, 8).toUpperCase()));
    },
    pagamentoRecusado: function () {
      estadoFinal('x', 'perigo', 'Pagamento não aprovado',
        esc(estado.pagamento.mensagemRecusa || 'O pagamento não foi aprovado pela operadora do cartão.') +
        ' Por isso, este orçamento foi cancelado. Se quiser seguir com o serviço, procure a oficina para combinar uma nova tentativa.');
    },
    recusado: function () {
      estadoFinal('x', 'neutro', 'Orçamento recusado',
        'Você recusou este orçamento e a oficina já foi avisada. Se mudar de ideia, é só entrar em contato.');
    },
    cancelado: function () {
      estadoFinal('info', 'neutro', 'Orçamento cancelado',
        'Este orçamento foi cancelado pela oficina (por exemplo, por falta de peça em estoque). Entre em contato para mais detalhes.');
    },
    estornado: function () {
      estadoFinal('volta', 'neutro', 'Pagamento estornado',
        'O valor de ' + brl.format(valor()) + ' foi devolvido ao seu cartão. O prazo para aparecer na fatura depende do seu banco.');
    }
  };

  function formularioFake() {
    var opcoes = '';
    for (var n = 1; n <= 12; n++) {
      opcoes += '<option value="' + n + '">' + n + 'x de ' + brl.format(valor() / n) + (n === 1 ? ' (à vista)' : '') + '</option>';
    }
    document.getElementById('meio-pagamento').innerHTML =
      '<div class="aviso-demo"><strong>Modo demonstração.</strong> Nenhum cartão real é cobrado: use um dos tokens sugeridos.</div>' +
      '<form class="form" id="form-fake">' +
      '<label>Token do cartão<input name="cardToken" value="fake-aprovado" required autocomplete="off"></label>' +
      '<div class="atalhos">Sugestões: <button type="button" class="atalho" data-token="fake-aprovado">fake-aprovado</button>' +
      '<button type="button" class="atalho" data-token="fake-recusado">fake-recusado</button></div>' +
      '<div class="linha"><label>E-mail do pagador<input type="email" name="payerEmail" required value="' + esc(estado.cliente.email) + '"></label>' +
      '<label>Parcelas<select name="installments">' + opcoes + '</select></label></div>' +
      '<button class="btn btn-primario btn-bloco" type="submit">Pagar ' + brl.format(valor()) + '</button></form>';
    var form = document.getElementById('form-fake');
    Array.prototype.forEach.call(form.querySelectorAll('[data-token]'), function (b) {
      b.onclick = function () { form.cardToken.value = b.getAttribute('data-token'); };
    });
    form.onsubmit = function (ev) {
      ev.preventDefault();
      ocupado(form.querySelector('[type=submit]'), 'Processando pagamento…');
      pagar({
        cardToken: form.cardToken.value.trim(),
        paymentMethodId: 'visa',
        installments: Number(form.installments.value),
        payerEmail: form.payerEmail.value.trim()
      }).catch(falhou);
    };
  }

  function montarBrick() {
    if (brick) return;
    if (!window.MercadoPago || !config.publicKey) {
      mostrarErro('O pagamento online está indisponível no momento. Tente novamente em alguns minutos.');
      return;
    }
    document.getElementById('meio-pagamento').innerHTML = '<div id="cardPaymentBrick_container"></div>';
    var mp = new window.MercadoPago(config.publicKey, { locale: 'pt-BR' });
    var minha = {};
    brick = minha;
    mp.bricks().create('cardPayment', 'cardPaymentBrick_container', {
      initialization: { amount: valor(), payer: { email: '' } },
      customization: {
        visual: { style: { theme: 'default' } },
        paymentMethods: { maxInstallments: 12, types: { excluded: ['debit_card'] } }
      },
      callbacks: {
        onReady: function () {},
        onError: function (erro) { console.error('Card Payment Brick', erro); },
        onSubmit: function (formData) {
          return pagar({
            cardToken: formData.token,
            paymentMethodId: formData.payment_method_id,
            installments: Number(formData.installments),
            payerEmail: formData.payer.email
          }).catch(function (erro) {
            if (erro.status === 409) return recarregar();
            mostrarErro('Não foi possível processar o pagamento agora. Confira os dados e tente novamente.');
            throw erro;
          });
        }
      }
    }).then(function (controle) {
      if (brick === minha) brick = controle;
      else controle.unmount();
    }).catch(function (erro) {
      if (brick === minha) brick = null;
      console.error('Card Payment Brick', erro);
      mostrarErro('Não foi possível carregar o formulário de pagamento. Atualize a página.');
    });
  }

  function desmontarBrick() {
    if (brick && brick.unmount) brick.unmount();
    brick = null;
  }

  function pararEspera() {
    clearInterval(espera);
    espera = null;
  }

  function garantirEspera() {
    if (espera || demorou) return;
    inicioEspera = Date.now();
    espera = setInterval(function () {
      if (Date.now() - inicioEspera > 90000) {
        pararEspera();
        demorou = true;
        render(true);
        return;
      }
      recarregar().catch(function () {});
    }, 1500);
  }

  function render(forcar) {
    var f = fase();
    var s = SELOS[f];
    selo.className = 'selo selo-' + s[1];
    selo.textContent = s[0];
    if (f === 'preparando' || f === 'analise') garantirEspera();
    else pararEspera();
    // O polling chama render a cada 1,5 s: so redesenha quando a fase muda.
    if (f === faseAtual && !forcar) return;
    if (f !== 'pagar') desmontarBrick();
    faseAtual = f;
    TELAS[f]();
  }

  render();
})();
`;
