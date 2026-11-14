/** CSS da pagina de checkout. Inline para a pagina funcionar sob qualquer prefixo (API Gateway). */
export const ESTILOS = `
:root {
  --fundo: #f3f5f9;
  --cartao: #ffffff;
  --texto: #111827;
  --suave: #6b7280;
  --linha: #e5e7eb;
  --marca: #0f172a;
  --primaria: #2563eb;
  --primaria-escura: #1d4ed8;
  --sucesso: #059669;
  --sucesso-fundo: #ecfdf5;
  --perigo: #dc2626;
  --perigo-fundo: #fef2f2;
  --alerta: #b45309;
  --alerta-fundo: #fffbeb;
  --info-fundo: #eff6ff;
  --neutro-fundo: #f3f4f6;
  --raio: 14px;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  background: var(--fundo);
  color: var(--texto);
  font-size: 15px;
  line-height: 1.5;
}
.topo {
  background: var(--marca);
  color: #fff;
  padding: 14px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.marca { display: flex; align-items: center; gap: 12px; }
.marca strong { display: block; font-size: 17px; letter-spacing: .2px; }
.marca div span { display: block; font-size: 12px; color: #cbd5e1; }
.logo {
  width: 38px; height: 38px; border-radius: 10px;
  background: linear-gradient(135deg, #3b82f6, #1e40af);
  display: grid; place-items: center;
}
.seguro { font-size: 12px; color: #cbd5e1; display: flex; align-items: center; gap: 6px; }
.pagina { max-width: 760px; margin: 28px auto 40px; padding: 0 16px; display: grid; gap: 18px; }
.cartao {
  background: var(--cartao);
  border-radius: var(--raio);
  box-shadow: 0 1px 2px rgba(15, 23, 42, .06), 0 8px 24px rgba(15, 23, 42, .06);
  padding: 24px;
}
.resumo-topo { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.rotulo { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--suave); font-weight: 600; }
h1 { margin: 2px 0 0; font-size: 26px; letter-spacing: -.3px; }
h2 { margin: 0 0 6px; font-size: 20px; letter-spacing: -.2px; }
.selo {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 600; padding: 6px 12px; border-radius: 999px; white-space: nowrap;
  background: var(--neutro-fundo); color: #374151;
}
.selo::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.selo-alerta { background: var(--alerta-fundo); color: var(--alerta); }
.selo-info { background: var(--info-fundo); color: var(--primaria-escura); }
.selo-sucesso { background: var(--sucesso-fundo); color: var(--sucesso); }
.selo-perigo { background: var(--perigo-fundo); color: var(--perigo); }
.dados { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 20px 0; }
.dados div { background: #f9fafb; border: 1px solid var(--linha); border-radius: 10px; padding: 10px 12px; min-width: 0; }
.dados dt { font-size: 12px; color: var(--suave); }
.dados dd { margin: 2px 0 0; font-weight: 600; overflow-wrap: anywhere; }
.itens { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--linha); }
.item {
  display: grid; grid-template-columns: minmax(0, 1fr) 56px 110px 120px; gap: 12px;
  align-items: center; padding: 12px 0; border-bottom: 1px solid var(--linha);
}
.item.cabecalho { font-size: 12px; color: var(--suave); text-transform: uppercase; letter-spacing: .06em; font-weight: 600; padding: 10px 0; }
.item .num { text-align: right; font-variant-numeric: tabular-nums; }
.item .sub { font-weight: 600; }
.descricao { display: flex; align-items: center; gap: 10px; min-width: 0; }
.tipo {
  font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
  padding: 3px 8px; border-radius: 6px; flex: none;
}
.tipo-servico { background: #ede9fe; color: #6d28d9; }
.tipo-peca { background: #e0f2fe; color: #0369a1; }
.total { display: flex; justify-content: space-between; align-items: baseline; padding-top: 16px; }
.total span { color: var(--suave); font-weight: 600; }
.total strong { font-size: 26px; letter-spacing: -.3px; font-variant-numeric: tabular-nums; }
.texto { color: #374151; margin: 0 0 18px; }
.botoes { display: flex; gap: 12px; justify-content: flex-end; flex-wrap: wrap; }
.btn {
  appearance: none; border: 0; border-radius: 10px; padding: 12px 20px;
  font: inherit; font-weight: 600; cursor: pointer; transition: background .15s, box-shadow .15s, opacity .15s;
}
.btn:disabled { opacity: .6; cursor: progress; }
.btn-primario { background: var(--primaria); color: #fff; box-shadow: 0 1px 2px rgba(37, 99, 235, .4); }
.btn-primario:hover:not(:disabled) { background: var(--primaria-escura); }
.btn-secundario { background: #fff; color: #374151; box-shadow: inset 0 0 0 1px #d1d5db; }
.btn-secundario:hover:not(:disabled) { background: #f9fafb; }
.btn-perigo { background: var(--perigo); color: #fff; }
.btn-bloco { width: 100%; padding: 14px 20px; font-size: 16px; }
.btn:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
.erro {
  margin: 14px 0 0; padding: 10px 12px; border-radius: 10px;
  background: var(--perigo-fundo); color: #991b1b; font-size: 14px;
}
.estado { text-align: center; padding: 12px 8px 4px; }
.estado .texto { max-width: 520px; margin: 0 auto 8px; }
.icone {
  width: 64px; height: 64px; border-radius: 50%; margin: 0 auto 14px;
  display: grid; place-items: center;
}
.icone-sucesso { background: var(--sucesso-fundo); color: var(--sucesso); }
.icone-perigo { background: var(--perigo-fundo); color: var(--perigo); }
.icone-neutro { background: var(--neutro-fundo); color: #4b5563; }
.icone-info { background: var(--info-fundo); color: var(--primaria); }
.giro {
  width: 40px; height: 40px; margin: 6px auto 16px; border-radius: 50%;
  border: 4px solid #dbeafe; border-top-color: var(--primaria); animation: girar 0.9s linear infinite;
}
@keyframes girar { to { transform: rotate(360deg); } }
.detalhe { font-size: 13px; color: var(--suave); margin-top: 10px; }
.pagamento-topo { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 14px; }
.pagamento-topo strong { font-size: 22px; font-variant-numeric: tabular-nums; }
.aviso-demo {
  background: var(--alerta-fundo); color: var(--alerta); border: 1px dashed #f59e0b;
  border-radius: 10px; padding: 10px 12px; font-size: 14px; margin-bottom: 16px;
}
.form { display: grid; gap: 14px; }
.form label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; color: #374151; }
.form input, .form select {
  font: inherit; padding: 11px 12px; border: 1px solid #d1d5db; border-radius: 10px; background: #fff; width: 100%;
}
.linha { display: grid; grid-template-columns: 1fr 220px; gap: 14px; }
.atalhos { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 13px; color: var(--suave); }
.atalho {
  font: inherit; font-size: 13px; padding: 4px 10px; border-radius: 999px; cursor: pointer;
  border: 1px solid #d1d5db; background: #fff; color: #374151;
}
.rodape { text-align: center; color: var(--suave); font-size: 13px; margin: 0; display: flex; gap: 6px; justify-content: center; align-items: center; }
.item .resumo-linha { display: none; color: var(--suave); font-size: 13px; }
@media (max-width: 640px) {
  .pagina { margin-top: 16px; }
  .cartao { padding: 18px; }
  .seguro { display: none; }
  h1 { font-size: 22px; }
  .resumo-topo { flex-direction: column; }
  .dados { grid-template-columns: 1fr; }
  .item { grid-template-columns: 1fr auto; row-gap: 2px; }
  .item.cabecalho { display: none; }
  .item .descricao { grid-column: 1 / -1; }
  .item .qtd, .item .unit { display: none; }
  .item .sub { grid-column: 2; }
  .item .resumo-linha { display: block; }
  .botoes { flex-direction: column-reverse; }
  .botoes .btn { width: 100%; }
  .linha { grid-template-columns: 1fr; }
}
`;
