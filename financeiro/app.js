'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { session: null, data: null, page: 'family', myFamily: '', filters: { search: '', category: '', status: '', family: '' }, toastTimer: null };
  const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents || 0) / 100);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const date = (value, options = {}) => {
    if (!value) return 'Data não informada';
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00-03:00` : value);
    return Number.isNaN(d.getTime()) ? 'Data não informada' : new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', ...options, ...(!Object.keys(options).length ? { day: '2-digit', month: '2-digit', year: 'numeric' } : {}) }).format(d);
  };
  const amountInput = cents => (Number(cents || 0) / 100).toFixed(2).replace('.', ',');
  const parseMoney = value => {
    const clean = String(value ?? '').trim().replace(/\s|R\$/g, '');
    if (!clean) return NaN;
    const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return NaN;
    const n = Number(normalized);
    return Number.isFinite(n) && n <= 999999999 ? Math.round(n * 100) : NaN;
  };
  const families = () => state.data?.families || [];
  const assignedFamilyId = () => {
    const family = families().find(item => String(item.id) === String(state.session?.user?.family_id));
    return family ? String(family.id) : '';
  };
  const myFamilyId = () => {
    const id = assignedFamilyId() || state.myFamily;
    return families().some(family => String(family.id) === String(id)) ? String(id) : '';
  };
  const knownSum = amounts => amounts.every(Number.isSafeInteger) ? amounts.reduce((sum, amount) => sum + amount, 0) : null;
  const knownMoney = amount => Number.isSafeInteger(amount) ? money(amount) : 'A definir';
  function familyExpenseShare(expense, familyId) {
    const allocations = expense.allocations || [];
    const allocation = allocations.find(item => String(item.family_id) === String(familyId));
    const total = allocation ? allocation.amount_cents : 0;
    if (!Number.isSafeInteger(total) || total < 0) return { total_cents: null, future_cents: null };
    if (expense.status === 'cancelled') return { total_cents: total, future_cents: 0 };
    const denominator = knownSum(allocations.map(item => item.amount_cents));
    if (supplierUnknown(expense) || allocations.some(item => !Number.isSafeInteger(item.amount_cents) || item.amount_cents < 0) || !Number.isSafeInteger(expense.total_cents) || denominator !== expense.total_cents || !Number.isSafeInteger(expense.pending_cents) || expense.pending_cents < 0 || expense.pending_cents > denominator) return { total_cents: total, future_cents: null };
    if (!denominator) return { total_cents: total, future_cents: 0 };
    const paid = BigInt(denominator - expense.pending_cents), divisor = BigInt(denominator);
    const shares = allocations.map(item => ({ id: String(item.family_id), paid: Number(paid * BigInt(item.amount_cents) / divisor), remainder: paid * BigInt(item.amount_cents) % divisor }));
    let remainder = Number(paid) - shares.reduce((sum, item) => sum + item.paid, 0);
    shares.sort((a, b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1);
    for (const share of shares) if (remainder-- > 0) share.paid++;
    return { total_cents: total, future_cents: total - (shares.find(item => item.id === String(familyId))?.paid || 0) };
  }
  const visibleQuestions = () => (state.data?.questions || []).filter(question => question.field !== 'reimbursement_plans');
  const familyName = id => families().find(f => String(f.id) === String(id))?.name || 'Família não identificada';
  const editable = () => !!state.session && state.session.user?.role !== 'viewer';
  const tag = (label, color = '') => `<span class="tag ${color}">${esc(label)}</span>`;
  const sourceLabel = source => {
    if (!source) return 'Lançamento manual';
    if (typeof source === 'string') return source;
    return source.label || [source.sheet, source.row ? `linha ${source.row}` : ''].filter(Boolean).join(' · ') || 'Importado da planilha';
  };
  const expenseStatus = e => {
    if (e.status === 'cancelled') return { label: 'Cancelada', color: '' };
    if (compositeCardExpense(e)) {
      const purchases = (e.source.card_components || []).filter(component => component.kind === 'purchase');
      const installments = purchases.filter(component => Number(component.installment_count || component.count || 1) > 1).length;
      return { label:`${purchases.length} compras · ${installments} ${installments === 1 ? 'parcelada' : 'parceladas'}`,color:'' };
    }
    if (!onSiteExpense(e) && Number(e.card_progress?.count) > 0) {
      const count = Number(e.card_progress.count), matured = Number(e.card_progress.matured_count || 0);
      return { label: `${matured}/${count} parcelas vencidas`, color:matured === count ? 'green' : '' };
    }
    if (Number(e.assumed_due_cents) > 0) return { label: Number(e.assumed_due_cents) >= Number(e.total_cents) ? 'Considerada paga pelo responsável' : 'Parcelas vencidas consideradas pagas', color:'green' };
    if (supplierUnknown(e)) return { label: 'Situação a esclarecer', color: 'amber' };
    if (onSiteExpense(e)) return { label: 'Pagamento na hospedagem', color: '' };
    if (e.payment_status === 'card_charged' || (e.payments || []).some(p => p.method === 'card_purchase' && !p.voided_at)) return { label: 'Cobrado no cartão', color: 'green' };
    if (e.pending_cents <= 0) return { label: 'Pago ao fornecedor', color: 'green' };
    if (e.due_on && e.due_on < today()) return { label: 'Vencida', color: 'red' };
    if (e.paid_cents > 0) return { label: 'Pagamento parcial', color: 'amber' };
    if (!e.due_on) return { label: 'Sem vencimento', color: '' };
    return { label: 'A vencer', color: '' };
  };
  const onSiteExpense = expense => ['on_site','pay_at_property'].includes(expense?.payment_status);
  const compositeCardExpense = expense => expense?.source?.card_schedule_type === 'multiple_purchases';
  function priceEvidence(expense) {
    const missing = { documented: false, document_total_cents: null, difference_cents: null, basis: null, pricing: null };
    const total = expense?.total_cents;
    if (!Number.isSafeInteger(total) || total <= 0) return missing;
    const candidates = [expense.pricing, expense.source?.pricing].filter(pricing => pricing && typeof pricing === 'object');
    const result = (documentTotal, basis, pricing = null) => ({ documented: true, document_total_cents: documentTotal, difference_cents: total - documentTotal, basis, pricing });
    for (const pricing of candidates) {
      const components = [pricing.card_principal_cents, pricing.iof_cents, pricing.other_fees_cents];
      const itemized = pricing.final_confirmed === true && components.every(amount => Number.isSafeInteger(amount) && amount >= 0) && knownSum(components) === total;
      const documentMatches = (pricing.final_confirmed === true || pricing.supplier_total_confirmed === true) && Number.isSafeInteger(pricing.final_total_cents) && pricing.final_total_cents === total;
      if (itemized || documentMatches) return result(total, itemized ? 'itemized' : 'document_total', pricing);
    }
    const components = expense.source?.card_components;
    if (Array.isArray(components) && components.some(component => component.kind === 'purchase') && components.every(component => ['purchase','refund'].includes(component.kind) && ['receipt','user'].includes(component.evidence) && Number.isSafeInteger(component.amount_cents) && component.amount_cents > 0)) {
      const net = knownSum(components.map(component => component.amount_cents * (component.kind === 'refund' ? -1 : 1)));
      if (net === total) return result(net, 'card_components');
    }
    const difference = candidates.find(pricing => pricing.supplier_total_confirmed === true && pricing.discrepancy_cents === 1 && Number.isSafeInteger(pricing.final_total_cents) && pricing.final_total_cents - total === pricing.discrepancy_cents);
    return difference ? result(difference.final_total_cents, 'document_difference', difference) : missing;
  }
  const supplierUnknown = expense => expense.payment_status === 'unknown' || expense.payment_status_unknown === true || expense.payment_unknown === true || expense.pending_cents === null;
  const expensePayerId = expense => expense.declared_payer_family_id || expense.source?.declared_payer_family_id || expense.installment_plan?.payer_family_id || (expense.payments || []).find(payment => !payment.voided_at && payment.kind !== 'refund')?.family_id || null;
  const evidenceLabel = evidence => evidence === 'receipt' ? 'Comprovante' : evidence === 'spreadsheet' ? 'Informado na planilha' : evidence === 'pending' ? 'A esclarecer' : 'Registro da família';
  const expenseEvidence = expense => expense.evidence || expense.source?.evidence || (expense.source?.sheet ? 'spreadsheet' : 'manual');
  const paymentLabel = p => p.kind === 'refund' ? 'Devolução do fornecedor' : p.method === 'card_purchase' ? 'Compra no cartão' : 'Pagamento ao fornecedor';

  async function api(path, options = {}) {
    if (window.jp27Cloud && window.JP27_CONFIG?.supabaseUrl) return window.jp27Cloud.request(path, options);
    const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.method && options.method !== 'GET' && state.session?.csrf ? { 'X-CSRF-Token': state.session.csrf } : {}), ...(options.headers || {}) };
    let response;
    try { response = await fetch(path, { ...options, headers, credentials: 'same-origin', cache: 'no-store' }); }
    catch { const error = new Error('Falha ao conectar à área privada. Confira a conexão e tente novamente.'); error.connection = true; throw error; }
    const type = response.headers.get('content-type') || '';
    if (!type.includes('application/json')) { const error = new Error('Conexão privada ainda não configurada.'); error.connection = true; error.status = response.status; throw error; }
    const payload = await response.json();
    if (!response.ok) { const error = new Error(payload.error || 'Não foi possível concluir a operação.'); error.status = response.status; throw error; }
    return payload;
  }
  function showGate(kind, message) {
    $('#app').hidden = true; $('#gate').hidden = false; $('.skip-link').setAttribute('href','#main');
    $('#login-form').hidden = kind !== 'login'; $('#gate-status').hidden = kind === 'login';
    if (kind === 'offline') $('#gate-status').innerHTML = `<span class="eyebrow amber">ÁREA PRIVADA</span><h2>Conexão privada<br>ainda não configurada</h2><p>${esc(message || 'Este painel precisa do serviço privado para proteger os dados das famílias. O roteiro público continua disponível.')}</p><a class="button primary" href="../index.html">Voltar ao roteiro →</a>`;
    if (kind === 'login') { $('#login-error').hidden = true; $('#password').value = ''; }
  }
  async function init() {
    if (window.JP27_CONFIG?.supabaseUrl) { $$('[data-action="change-password"]').forEach(button => { button.hidden = false; }); $('#username').type = 'email'; $('#username').inputMode = 'email'; $('label[for="username"]').textContent = 'E-mail de acesso'; }
    try {
      const session = await api('/api/session');
      if (!session.user) return showGate('login');
      state.session = session; await loadDashboard();
    } catch (error) { showGate(error.status === 401 ? 'login' : 'offline'); }
  }
  async function loadDashboard({ preservePage = true } = {}) {
    state.data = await api('/api/dashboard');
    $('#gate').hidden = true; $('#app').hidden = false; $('.skip-link').setAttribute('href','#dashboard');
    $('#user-name').textContent = state.session.user.username;
    $('#user-avatar').textContent = state.session.user.username.slice(0, 1).toUpperCase();
    $('#user-role').textContent = state.session.user.role === 'admin' ? 'Administração · alterações registradas' : state.session.user.role === 'viewer' ? 'Acesso de consulta' : 'Família · pode registrar e editar';
    const count = visibleQuestions().length;
    $('#review-count').textContent = count; $('#review-count').hidden = count === 0;
    $('#updated-at').textContent = `Atualizado em ${date(state.data.as_of || new Date().toISOString(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
    if (!preservePage) state.page = 'family'; render();
  }
  function toast(message) {
    clearTimeout(state.toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
    state.toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000);
  }
  function setPage(page) {
    if (!['family', 'overview', 'expenses', 'transfers', 'timeline', 'upcoming', 'monthly', 'review', 'history'].includes(page)) return;
    state.page = page; render(); window.scrollTo({ top: 0, behavior: 'instant' });
  }
  const pageHeading = (eyebrow, title, subtitle, actions = '') => `<div class="page-heading"><div>${eyebrow ? `<span class="eyebrow">${eyebrow}</span>` : ''}<h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
  const newExpenseButton = () => editable() ? '<button class="button primary" data-action="new-expense"><span class="button-icon" aria-hidden="true">＋</span> Nova compra</button>' : '';
  const newTransferButton = () => editable() ? '<button class="button" data-action="new-transfer"><span class="button-icon" aria-hidden="true">⇄</span> Novo pagamento</button>' : '';
  const empty = (title, message, action = '') => `<div class="empty"><div class="empty-symbol" aria-hidden="true">◌</div><h3>${esc(title)}</h3><p>${esc(message)}</p>${action}</div>`;
  function reviewNotice() {
    const count = Number(state.data.summary?.unverified_count || 0);
    if (!count && !(state.data.review_items || []).length) return '';
    return `<div class="notice"><span aria-hidden="true">ⓘ</span><div class="notice-text"><strong>A conferência ainda está em andamento.</strong><br>${count ? `${count} ${count === 1 ? 'despesa precisa' : 'despesas precisam'} de revisão${state.data.summary?.unverified_cents ? `, somando ${money(state.data.summary.unverified_cents)} em referências` : ''}. ` : ''}Os saldos confirmados podem representar apenas parte da viagem. Veja os registros importados e as dúvidas antes de fazer um acerto.</div><button class="button small" data-page="review">Conferir →</button></div>`;
  }
  function myFamilyBalance(row, partial = false) {
    if (!row) return '<strong>A calcular</strong>';
    const due = Number(row.due_balance_cents || 0), advance = Number(row.advance_cents || 0), held = Number(row.advance_held_cents || 0);
    return `<strong class="amount ${due < 0 ? 'negative' : due > 0 || advance > 0 ? 'positive' : ''}">${due < 0 ? 'Deve ' + money(-due) : due > 0 ? 'A receber ' + money(due) : advance > 0 ? money(advance) + ' adiantados' : partial ? 'A conferir' : 'Em dia'}</strong>${partial ? '<span class="cell-meta amber">Saldo parcial</span>' : ''}${due !== 0 && advance > 0 ? `<span class="cell-meta">${money(advance)} adiantados</span>` : ''}${held > 0 ? `<span class="cell-meta">${money(held)} recebidos antecipadamente</span>` : ''}`;
  }
  function myFamilyExpenseTable(expenses, familyId, ownPurchases = false) {
    if (!expenses.length) return '<p class="family-empty">Nenhuma compra registrada.</p>';
    const active = expenses.filter(expense => expense.status !== 'cancelled');
    const total = knownSum(active.map(expense => ownPurchases ? expense.total_cents : familyExpenseShare(expense, familyId).total_cents));
    const future = ownPurchases ? null : knownSum(active.map(expense => familyExpenseShare(expense, familyId).future_cents));
    return `<div class="table-scroll"><table class="family-expenses-table${ownPurchases ? ' family-own-purchases' : ''}"><thead><tr><th scope="col">Compra</th>${ownPurchases ? '<th scope="col" class="family-purchase-date">Data</th>' : ''}<th scope="col" class="text-right">${ownPurchases ? 'Valor total' : 'Sua parte'}</th>${ownPurchases ? '' : '<th scope="col" class="text-right">A vencer</th>'}</tr></thead><tbody>${expenses.map(expense => {
      const share = familyExpenseShare(expense, familyId);
      return `<tr><th scope="row"><button class="table-title" data-action="expense-detail" data-id="${esc(expense.id)}" title="${esc(expense.title)}"><span class="purchase-title-text">${esc(expense.title)}</span></button></th>${ownPurchases ? `<td class="family-purchase-date">${expense.incurred_on ? date(expense.incurred_on) : 'Sem data'}</td>` : ''}<td class="text-right amount">${knownMoney(ownPurchases ? expense.total_cents : share.total_cents)}${expense.status === 'cancelled' ? '<span class="cell-meta">Cancelada</span>' : !priceEvidence(expense).documented ? `<span class="cell-meta">${onSiteExpense(expense) ? 'Estimativa' : 'A confirmar'}</span>` : ''}</td>${ownPurchases ? '' : `<td class="text-right amount">${knownMoney(share.future_cents)}</td>`}</tr>`;
    }).join('')}</tbody><tfoot><tr><th scope="row">Total${ownPurchases ? ' ativo' : ''}</th>${ownPurchases ? '<td class="family-purchase-date"></td>' : ''}<td class="text-right amount">${knownMoney(total)}</td>${ownPurchases ? '' : `<td class="text-right amount">${knownMoney(future)}</td>`}</tr></tfoot></table></div>`;
  }
  function myFamilyTransfers(transfers, familyId) {
    if (!transfers.length) return '<p class="family-empty">Nenhuma transferência registrada.</p>';
    const total = direction => transfers.filter(transfer => String(transfer[direction]) === familyId).reduce((sum, transfer) => sum + transfer.amount_cents, 0);
    return `<div class="family-transfer-totals"><span>Enviou <strong class="amount">${money(total('from_id'))}</strong></span><span>Recebeu <strong class="amount">${money(total('to_id'))}</strong></span></div><div class="table-scroll"><table class="family-transfers-table"><thead><tr><th scope="col">Data</th><th scope="col">Transferência</th><th scope="col" class="text-right">Valor</th></tr></thead><tbody>${transfers.map(transfer => {
      const sent = String(transfer.from_id) === familyId, other = sent ? transfer.to_id : transfer.from_id;
      return `<tr><td>${transfer.paid_on ? date(transfer.paid_on, { day:'2-digit', month:'2-digit', year:'2-digit' }) : '<span class="amber">Sem data</span>'}</td><td><button class="table-title" data-action="transfer-detail" data-id="${esc(transfer.id)}">${sent ? 'Enviou para' : 'Recebeu de'} ${esc(familyName(other))}</button></td><td class="text-right amount">${money(transfer.amount_cents)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  function myFamilyForecast(months, familyId, currentMonth, partial = false) {
    const upcoming = months.filter(month => month.month >= currentMonth);
    if (!upcoming.length) return '';
    return `<details class="audit-details family-forecast section-space"><summary>Planejar os próximos meses</summary><p class="family-table-note">Cada previsão acumula o saldo de hoje e os vencimentos até aquele mês.</p><div class="table-scroll"><table class="family-forecast-table"><thead><tr><th scope="col">Mês</th><th scope="col" class="text-right">Sua parte a vencer</th><th scope="col">Acerto previsto</th></tr></thead><tbody>${upcoming.map(month => {
      const row = (month.forecast_rows || month.families || []).find(item => String(item.family_id) === familyId);
      const settlements = (month.forecast_payable_settlements || month.payable_settlements || []).filter(item => [item.from_id || item.from_family_id, item.to_id || item.to_family_id].map(String).includes(familyId));
      return `<tr class="month-${month.month === currentMonth ? 'current' : 'future'}"><th scope="row"><button class="table-title" data-action="family-forecast-month" data-month="${esc(month.month)}" data-family="${esc(familyId)}">${esc(monthLabel(month.month))}</button></th><td class="text-right amount">${knownMoney(row?.share_cents)}</td><td>${!row ? 'A calcular' : settlements.length ? settlements.map(item => {
        const sent = String(item.from_id || item.from_family_id) === familyId, other = sent ? item.to_id || item.to_family_id : item.from_id || item.from_family_id;
        return `<span class="family-forecast-route">${sent ? 'Pagar a' : 'Receber de'} ${esc(familyName(other))} <strong class="amount">${money(item.amount_cents)}</strong></span>`;
      }).join('') : Number(row.advance_cents) > 0 ? money(row.advance_cents) + ' adiantados' : partial ? 'Previsão parcial' : 'Em dia'}</td></tr>`;
    }).join('')}</tbody></table></div></details>`;
  }
  function renderMyFamily() {
    const id = myFamilyId();
    const picker = assignedFamilyId() ? '' : `<div class="field family-picker"><label for="my-family-select">Escolha sua família</label><select id="my-family-select"><option value="">Selecionar</option>${familyOptions(id)}</select></div>`;
    if (!id) return `${pageHeading('', 'Minha família', '')}<section class="panel">${picker}</section>`;
    const asOf = (state.data.as_of || today()).slice(0,10), currentMonth = asOf.slice(0,7);
    const months = state.data.reconciliation?.months || [];
    const actualMonth = months.find(month => month.month === currentMonth) || [...months].reverse().find(month => month.month < currentMonth);
    const row = (actualMonth?.as_of_rows || actualMonth?.families || []).find(item => String(item.family_id) === id);
    const expenses = state.data.expenses || [];
    const shares = expenses.filter(expense => expense.status !== 'cancelled' && (expense.allocations || []).some(item => String(item.family_id) === id && (item.amount_cents > 0 || item.amount_cents == null)));
    const own = expenses.filter(expense => String(expensePayerId(expense)) === id);
    const transfers = (state.data.transfers || []).filter(transfer => !transfer.voided_at && (!transfer.paid_on || transfer.paid_on <= asOf) && [transfer.from_id, transfer.to_id].map(String).includes(id)).sort((a,b) => (b.paid_on || '').localeCompare(a.paid_on || ''));
    const total = knownSum(shares.map(expense => familyExpenseShare(expense,id).total_cents));
    const undatedCommitments = (state.data.reconciliation?.undated_commitments || []).filter(item => expenses.some(expense => expense.id === item.expense_id && (String(expensePayerId(expense)) === id || (expense.allocations || []).some(share => String(share.family_id) === id && share.amount_cents > 0))));
    const undatedTransfers = transfers.filter(transfer => !transfer.paid_on);
    const partial = undatedCommitments.length > 0 || undatedTransfers.length > 0 || [...shares,...own].some(expense => !expense.verified || supplierUnknown(expense));
    const settlements = (actualMonth?.as_of_payable_settlements || actualMonth?.payable_settlements || []).filter(item => [item.from_id || item.from_family_id, item.to_id || item.to_family_id].map(String).includes(id));
    return `${pageHeading('', 'Minha família', esc(familyName(id)) + ' · Até ' + date(asOf), newExpenseButton() + (editable() ? '<button class="button" data-action="family-new-transfer">Novo pagamento</button>' : ''))}
      ${picker}
      <dl class="family-summary"><div><dt>Sua parte na viagem</dt><dd class="amount">${knownMoney(total)}</dd></div><div><dt>Saldo entre famílias</dt><dd>${myFamilyBalance(row,partial)}</dd></div></dl>
      ${partial ? `<div class="notice"><div class="notice-text">Complete as datas e os dados pendentes para fechar o saldo.${undatedTransfers.length ? ' Transferências sem data entram no saldo após informar a data.' : ''} <button class="text-link" data-action="my-family-purchases">Revisar compras</button>${undatedTransfers.length ? ' · <button class="text-link" data-page="transfers">Revisar pagamentos</button>' : ''}</div></div>` : ''}
      ${settlements.length ? `<section class="family-current-settlement"><h2>Acerto de hoje</h2>${settlements.map(item => reconciliationSettlement(item,false,true)).join('')}</section>` : ''}
      <section class="table-panel family-section"><div class="family-section-heading"><h2>Sua parte nas despesas</h2><button class="text-link" data-action="my-family-purchases">Ver em Compras</button></div>${myFamilyExpenseTable(shares,id)}<p class="family-table-note">A vencer considera as parcelas futuras de cada compra. As transferências ajustam o saldo entre famílias.</p></section>
      <section class="table-panel family-section"><div class="family-section-heading"><h2>Compras feitas pela família</h2><span>${own.length} ${own.length === 1 ? 'compra' : 'compras'}</span></div>${myFamilyExpenseTable(own,id,true)}</section>
      <section class="table-panel family-section"><div class="family-section-heading"><h2>Transferências</h2><span>${transfers.length} ${transfers.length === 1 ? 'pagamento' : 'pagamentos'}</span></div>${myFamilyTransfers(transfers,id)}</section>
      ${myFamilyForecast(months,id,currentMonth,partial)}
      <button class="text-link family-monthly-link" data-action="family-monthly" data-family="${esc(id)}">Ver encontro de contas mensal →</button>`;
  }
  function renderReconciliation() {
    const reconciliation = state.data.reconciliation || {}, months = reconciliation.months || [];
    const asOf = (state.data.as_of || today()).slice(0,10), currentMonth = asOf.slice(0,7);
    if (!months.length) return `${pageHeading('CONTAS DAS FAMÍLIAS', 'Encontro de contas', 'O que vence, o que já foi pago entre famílias e o que falta acertar.', newExpenseButton() + newTransferButton())}<section class="panel">${empty('O acerto mensal está sendo preparado', 'As compras e os pagamentos registrados continuam disponíveis nas outras abas.')}</section>`;
    const selected = months.find(month => month.month === state.reconciliationMonth) || months.find(month => month.month === currentMonth) || months[0];
    state.reconciliationMonth = selected.month;
    const current = selected.month === currentMonth, future = selected.month > currentMonth;
    const nextMonth = consecutiveMonths(selected.month,2)[1], nextMonthLabel = monthLabel(nextMonth);
    const rows = current && selected.as_of_rows ? selected.as_of_rows : future ? selected.forecast_rows || selected.families || [] : selected.families || [];
    const due = current ? selected.as_of_total_due_cents ?? selected.total_due_cents : selected.total_due_cents;
    const transferred = future ? 0 : current ? selected.as_of_total_transferred_cents ?? selected.total_transferred_cents : selected.total_transferred_cents;
    const settlements = current ? selected.as_of_payable_settlements || selected.payable_settlements || [] : future ? selected.forecast_payable_settlements || selected.payable_settlements || [] : selected.payable_settlements || [];
    const closingDate = new Date(Date.UTC(Number(selected.month.slice(0,4)),Number(selected.month.slice(5,7)),0)).toISOString().slice(0,10);
    const caption = current ? `Até ${date(asOf)}.` : future ? 'Projeção com o saldo anterior.' : `Fechamento em ${date(closingDate)}.`;
    const advances = rows.filter(row => Number(row.advance_cents) > 0);
    const undatedCount = (reconciliation.undated_commitments || []).length + (reconciliation.undated_transfers || []).length;
    const laterThisMonth = current ? (selected.commitments || []).filter(commitment => commitment.date && commitment.date > asOf) : [];
    const settlementHeading = future ? 'Encontro de contas até ' + monthLabel(selected.month) : current ? 'Quem paga a quem agora' : 'Saldo levado para ' + nextMonthLabel;
    const entries = current && selected.as_of_ledger_entries ? selected.as_of_ledger_entries : future ? selected.forecast_ledger_entries || selected.ledger_entries || [] : selected.ledger_entries || [];
    return renderReconciliationMatrix({months,selected,rows,entries,asOf,currentMonth,current,future,due,transferred,caption,advances,undatedCount,laterThisMonth,nextMonthLabel,settlements,settlementHeading});
  }
  function renderReconciliationMatrix(context) {
    const { months,selected,rows,entries,asOf,currentMonth,current,future,due,transferred,caption,advances,undatedCount,laterThisMonth,nextMonthLabel,settlements,settlementHeading } = context;
    const focus = families().some(family => family.id === state.reconciliationFamily) ? state.reconciliationFamily : '';
    const columns = families().filter(family => !focus || family.id === focus), byFamily = new Map(rows.map(row => [String(row.family_id),row]));
    const visibleEntries = entries.filter(entry => !focus || Number(entry.family_impacts_cents?.[focus] || 0) !== 0);
    const visibleSettlements = settlements.filter(settlement => !focus || [settlement.from_id || settlement.from_family_id,settlement.to_id || settlement.to_family_id].includes(focus));
    const visibleAdvances = advances.filter(row => !focus || row.family_id === focus), focusedRow = byFamily.get(focus);
    const phase = selected.month < currentMonth ? 'past' : future ? 'future' : 'current';
    return `${pageHeading('', 'Encontro de contas', '', newExpenseButton() + newTransferButton())}
      ${undatedCount ? `<div class="notice"><div class="notice-text">${undatedCount} registros sem data. Complete em Compras ou Pagamentos.</div></div>` : ''}
      <nav class="month-rail" aria-label="Mês do acerto">${months.map(month => reconciliationMonthChip(month,selected.month,currentMonth)).join('')}</nav>
      <div class="reconciliation-toolbar"><div class="reconciliation-heading"><h2>${esc(monthLabel(selected.month))}</h2><p>${esc(caption)}</p></div><div class="reconciliation-controls"><div class="mobile-month-control month-${phase}"><label for="reconciliation-month">Mês</label><select id="reconciliation-month">${months.map(month => `<option value="${esc(month.month)}" ${month.month === selected.month ? 'selected' : ''}>${esc(monthLabel(month.month))} · ${month.month < currentMonth ? 'Passado' : month.month === currentMonth ? 'Atual' : 'Futuro'}</option>`).join('')}</select></div><div class="family-focus-control"><label for="ledger-family">Família</label><select id="ledger-family"><option value="">Todas as famílias</option>${familyOptions(focus)}</select></div></div></div>
      <section class="panel reconciliation-section ledger-panel"><div class="section-heading"><div><h2>Movimentações</h2><p class="ledger-summary"><span>${focus ? 'Parte de ' + esc(familyName(focus)) : current ? 'Vence até hoje' : 'Vence no mês'}: <strong class="amount">${money(focus ? focusedRow?.share_cents : due)}</strong></span><span>${future ? 'Projeção acumulada.' : focus ? 'Enviou: <strong class="amount">' + money(focusedRow?.sent_cents) + '</strong> · Recebeu: <strong class="amount">' + money(focusedRow?.received_cents) + '</strong>' : 'Transferido: <strong class="amount">' + money(transferred) + '</strong>'}</span></p></div></div>
        <div class="table-scroll ledger-scroll" tabindex="0" role="region" aria-label="Movimentações e saldos${focus ? ' de ' + esc(familyName(focus)) : ' das famílias'}"><table class="ledger-matrix${focus ? ' ledger-focused' : ''}"><thead><tr><th scope="col" class="ledger-date-cell">Data</th><th scope="col" class="ledger-movement">Movimentação</th><th scope="col" class="text-right ledger-value-cell">Valor</th>${columns.map(family => `<th scope="col" class="text-right ledger-family">${esc(family.name)}</th>`).join('')}</tr></thead><tbody><tr class="ledger-opening"><td class="ledger-date-cell">—</td><th scope="row" class="ledger-movement">Saldo anterior</th><td class="ledger-value-cell">—</td>${columns.map(family => `<td class="text-right amount">${ledgerImpact(byFamily.get(String(family.id))?.opening_cents)}</td>`).join('')}</tr>${visibleEntries.map(entry => ledgerEntryRow(entry,columns,future)).join('')}${!visibleEntries.length ? `<tr><td class="ledger-date-cell"></td><td class="ledger-movement"><span class="cell-meta">${focus ? 'Sem alterações no saldo desta família.' : 'Sem movimentações no período.'}</span></td><td class="ledger-value-cell"></td>${columns.map(() => '<td>—</td>').join('')}</tr>` : ''}</tbody><tfoot><tr><td class="ledger-date-cell"></td><th scope="row" class="ledger-movement">Saldo acumulado</th><td class="ledger-value-cell"></td>${columns.map(family => `<td class="text-right">${ledgerClosingBalance(byFamily.get(String(family.id)) || {},nextMonthLabel)}</td>`).join('')}</tr></tfoot></table></div>
        <details class="ledger-help"><summary>Como ler o saldo</summary><p>Some o que a família adiantou e transferiu. Desconte a parte dela nas compras e o que recebeu. + soma; − desconta.${future ? ' Cada mês inclui o saldo anterior e os vencimentos futuros. Use o saldo do mês escolhido para planejar o acerto.' : ''}</p></details>
        <div class="net-settlements"><h3>${!current && !future || visibleSettlements.length ? esc(settlementHeading) : future ? 'Nenhum pagamento previsto' : 'Sem acerto pendente'}</h3>${!visibleSettlements.length && visibleAdvances.length ? '<p class="reconciliation-note">Adiantamentos abatem as próximas compras.</p>' : ''}${visibleSettlements.slice(0,3).map(settlement => reconciliationSettlement(settlement,future,current)).join('')}${visibleAdvances.map(row => reconciliationAdvance(row,nextMonthLabel)).join('')}</div>
        ${laterThisMonth.length ? `<details class="reconciliation-details"><summary>Ainda vence neste mês (${laterThisMonth.length})</summary>${reconciliationCommitments(laterThisMonth)}</details>` : ''}
      </section>${reconciliationChart(rows.filter(row => !focus || row.family_id === focus))}<div class="reconciliation-secondary">${visibleQuestions().length ? '<button class="text-link" data-page="review">Dúvidas (' + visibleQuestions().length + ')</button>' : ''}<button class="text-link" data-page="history">Histórico</button></div>`;
  }
  function reconciliationMonthChip(month,selectedMonth,currentMonth) {
    const phase = month.month < currentMonth ? 'past' : month.month > currentMonth ? 'future' : 'current';
    const label = {past:'Mês passado',current:'Mês atual',future:'Mês futuro'}[phase];
    const name = monthLabel(month.month).replace(' de ',' ');
    const title = name.charAt(0).toLocaleUpperCase('pt-BR') + name.slice(1);
    const selected = month.month === selectedMonth;
    return `<button class="month-chip month-${phase}${selected ? ' selected' : ''}" data-action="select-reconciliation-month" data-month="${esc(month.month)}" aria-pressed="${selected}"${phase === 'current' ? ' aria-current="date"' : ''}><span class="month-chip-title">${esc(title)}</span><strong class="amount">${money(month.total_due_cents)}</strong><small class="month-chip-status">${label}</small></button>`;
  }
  function ledgerImpact(cents) {
    const value = Number(cents || 0);
    return value === 0 ? '<span class="subtle">—</span>' : (value > 0 ? '+ ' : '− ') + money(Math.abs(value));
  }
  function ledgerEntryRow(entry,columns,future) {
    const payment = entry.kind === 'transfer', expense = (state.data.expenses || []).find(expense => expense.id === entry.expense_id);
    const meta = payment ? `${familyName(entry.from_id)} → ${familyName(entry.to_id)}` : `Responsável: ${familyName(entry.payer_family_id)}`;
    const estimate = !payment && expense && onSiteExpense(expense) && !priceEvidence(expense).documented;
    return `<tr><td class="nowrap ledger-date-cell">${dueLabel(entry)}</td><td class="ledger-movement">${!payment && entry.expense_id ? `<button class="table-title" data-action="expense-detail" data-id="${esc(entry.expense_id)}">${esc(entry.title)}</button>` : `<strong>${payment ? 'Pagamento entre famílias' : esc(entry.title)}</strong>`}<span class="cell-meta">${esc(meta)}</span><span class="cell-meta ledger-mobile-context">${dueLabel(entry)} · ${money(entry.amount_cents)}</span>${estimate ? '<span class="cell-meta">Estimativa · na hospedagem</span>' : ''}</td><td class="text-right amount ledger-value-cell">${money(entry.amount_cents)}</td>${columns.map(family => `<td class="text-right amount">${ledgerImpact(entry.family_impacts_cents?.[family.id])}</td>`).join('')}</tr>`;
  }
  function ledgerClosingBalance(row,nextMonthLabel) {
    const closing = Number(row.closing_cents || 0), due = Number(row.due_balance_cents ?? closing), advance = Number(row.advance_cents || 0), held = Number(row.advance_held_cents || 0);
    const anticipated = due === 0 && held > 0 && closing < 0, prepaid = due === 0 && advance > 0 && closing > 0;
    const label = anticipated ? 'Recebido antecipadamente' : prepaid ? 'Crédito adiantado' : closing > 0 ? 'Crédito' : closing < 0 ? 'Saldo devedor' : 'Saldo zerado';
    return `<strong class="amount ${anticipated ? '' : closing > 0 ? 'positive' : closing < 0 ? 'negative' : ''}">${closing === 0 ? money(0) : ledgerImpact(closing)}</strong><span class="cell-meta">${label}</span>${anticipated || prepaid ? `<span class="cell-meta">Para ${esc(nextMonthLabel)}</span>` : ''}`;
  }
  function reconciliationFamilyBalance(row,nextMonthLabel) {
    const balance = Number(row.due_balance_cents ?? row.closing_cents ?? 0), advance = Number(row.advance_cents || 0), held = Number(row.advance_held_cents || 0);
    const creditedAdvance = balance === 0 && advance > 0;
    const label = creditedAdvance ? 'Crédito ' + money(advance) : balance === 0 ? held > 0 ? 'Sem acerto pendente' : 'Em dia' : (balance > 0 ? 'Crédito ' : 'Deve ') + money(Math.abs(balance));
    return `<strong class="amount ${balance < 0 ? 'negative' : balance > 0 || creditedAdvance ? 'positive' : ''}">${label}</strong>${advance > 0 ? `<span class="cell-meta">Adiantado para ${esc(nextMonthLabel)}</span>` : balance === 0 && held > 0 ? `<span class="cell-meta">${money(held)} recebidos antecipadamente</span>` : ''}`;
  }
  function reconciliationAdvance(row,nextMonthLabel) {
    return `<div class="reconciliation-settlement"><div><strong>${esc(row.name || familyName(row.family_id))}</strong><span class="cell-meta">Crédito adiantado para ${esc(nextMonthLabel)}</span></div><strong class="amount positive">${money(row.advance_cents)}</strong></div>`;
  }
  function reconciliationChart(rows) {
    const values = rows.map(row => Number(row.closing_cents || 0));
    const extent = Math.max(1,...values.map(value => Math.abs(value)));
    return `<details class="audit-details reconciliation-section"><summary>Ver gráfico dos saldos</summary><div class="reconciliation-bars">${rows.map((row,index) => {
      const value = values[index], width = Math.abs(value) / extent * 48;
      const anticipated = value < 0 && Number(row.advance_held_cents) > 0 && Number(row.due_balance_cents) === 0;
      const prepaid = value > 0 && Number(row.advance_cents) > 0 && Number(row.due_balance_cents) === 0;
      const label = anticipated ? 'Recebido antecipadamente' : prepaid ? 'Crédito adiantado' : value < 0 ? 'Deve' : value > 0 ? 'Crédito' : 'Saldo zerado';
      return `<div class="family-balance-bar"><strong>${esc(row.name || familyName(row.family_id))}</strong><div class="balance-bar-track" role="img" aria-label="${esc((row.name || familyName(row.family_id)) + ': ' + label + ' ' + money(Math.abs(value)))}"><span class="${anticipated ? 'bar-advance-held' : value < 0 ? 'bar-debt' : 'bar-credit'}" style="left:${value < 0 ? 50-width : 50}%;width:${width}%"></span></div><span class="amount"><strong>${money(Math.abs(value))}</strong><small>${label}</small></span></div>`;
    }).join('')}</div></details>`;
  }
  function reconciliationCommitments(commitments) {
    if (!commitments.length) return '<p class="reconciliation-note">Nenhuma compra vence neste período.</p>';
    return `<div class="table-scroll"><table><thead><tr><th>Compra</th><th>Responsável</th><th>Vencimento</th><th class="text-right">Valor</th></tr></thead><tbody>${commitments.map(commitment => `<tr><td><button class="table-title" data-action="expense-detail" data-id="${esc(commitment.expense_id)}">${esc(commitment.title)}</button></td><td>${esc(familyName(commitment.payer_family_id))}</td><td class="nowrap">${dueLabel(commitment)}</td><td class="text-right amount">${money(commitment.amount_cents)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function reconciliationSettlement(settlement,future,allowRegister = false) {
    const from = settlement.from_id || settlement.from_family_id, to = settlement.to_id || settlement.to_family_id;
    return `<div class="reconciliation-settlement"><div><strong>${esc(settlement.from || familyName(from))}</strong><span aria-hidden="true"> → </span><strong>${esc(settlement.to || familyName(to))}</strong></div><strong class="amount">${money(settlement.amount_cents)}</strong>${editable() && allowRegister ? `<button class="button small" data-action="suggest-transfer" data-from="${esc(from)}" data-to="${esc(to)}" data-amount="${Number(settlement.amount_cents)}">Registrar pagamento</button>` : ''}</div>`;
  }
  function renderOverview() {
    const data = state.data, summary = data.summary || {}, questions = data.questions || [];
    const purchases = (data.expenses || []).filter(expense => expense.status !== 'cancelled');
    const historical = (data.financial_timeline || []).filter(event => event.scope !== 'future').sort(sortFinancialEvents).slice(0,5);
    return `${pageHeading('JAPÃO 2027 · ÁREA DAS FAMÍLIAS', 'Contas da viagem', 'Veja as compras, os pagamentos e a posição de cada família.', newExpenseButton() + newTransferButton())}
      <div class="metrics"><div class="metric"><div class="metric-label">Total da viagem registrado</div><div class="metric-value amount">${money(summary.committed_cents)}</div><span class="metric-caption">${purchases.length} compras · valores registrados em reais</span></div><div class="metric"><div class="metric-label">Pago até agora</div><div class="metric-value amount">${money(summary.paid_cents)}</div><span class="metric-caption">Vencimentos até hoje e pagamentos diretos, pela regra combinada</span></div><div class="metric accent"><div class="metric-label">Ainda falta pagar</div><div class="metric-value amount">${money(summary.pending_cents)}</div><span class="metric-caption">Parcelas futuras do cartão e pagamentos na hospedagem</span></div></div>
      ${summary.unknown_payment_cents ? `<div class="notice"><div class="notice-text"><strong>${money(summary.unknown_payment_cents)} com situação de pagamento a esclarecer.</strong> O responsável consta na planilha. Falta confirmar a cobrança nos extratos.</div><button class="button small" data-page="review">Ver dúvidas</button></div>` : ''}
      <div class="section-heading"><div><h2>Créditos e saldos de cada família</h2><p>Pagamentos até agora, parte de cada família e reembolsos já registrados.</p></div><button class="text-link" data-page="transfers">Ver reembolsos →</button></div>
      <div class="families">${(data.balances || []).map((balance,index) => familyPositionCard(balance,index)).join('')}</div>
      <p class="explanation">Use os créditos adiantados para abater as próximas parcelas. Consulte os valores a acertar em Encontro de contas.</p>
      <section class="section-space"><div class="section-heading"><div><h2>Compras e reservas da viagem</h2><p>O que foi comprado, quem assumiu o pagamento e o que ainda falta.</p></div><button class="text-link" data-page="expenses">Ver e editar compras →</button></div>${purchaseTable(purchases)}</section>
      <div class="overview-lower section-space"><section class="panel"><div class="section-heading"><div><h2>Últimas movimentações</h2><p>Compras e reembolsos, na ordem em que aconteceram.</p></div><button class="text-link" data-page="timeline">Linha do tempo →</button></div>${financialEventList(historical, { compact: true })}</section><section class="panel"><div class="section-heading"><div><h2>Próximos pagamentos</h2><p>Contas de fornecedores e parcelas combinadas.</p></div><button class="text-link" data-page="monthly">Ver mês a mês →</button></div>${renderUpcoming()}${questions.length ? `<div class="panel-note"><strong>${questions.length} ${questions.length === 1 ? 'informação precisa' : 'informações precisam'} de resposta.</strong> <button class="text-link" data-page="review">Resolver dúvidas pontuais →</button></div>` : ''}</section></div>
      <div class="only-mobile section-space"><button class="button small" data-action="change-password">Trocar senha</button><button class="button small" data-action="logout">Sair</button></div>`;
  }
  function familyPositionCard(balance,index) {
    const value = Number(balance.balance_cents || 0), known = balance.balance_cents !== null;
    return `<article class="family-card"><div class="family-head"><span class="family-avatar" style="background:${['#edf1f4','#f8efea','#edf1e8','#f5eff6'][index % 4]}">${esc(balance.name?.slice(0,1) || 'F')}</span>${esc(balance.name)}</div><div class="family-result"><small>${known ? 'Saldo atual entre famílias' : 'Saldo a esclarecer'}</small><strong class="amount ${value > 0 ? 'positive' : value < 0 ? 'negative' : ''}">${known ? money(Math.abs(value)) : 'Desconhecido'}</strong><span class="balance-tag ${value > 0 ? 'positive' : value < 0 ? 'negative' : 'subtle'}">${known ? value > 0 ? 'Tem crédito' : value < 0 ? 'Saldo devedor' : 'Sem diferença registrada' : 'Falta identificar pagamentos'}</span></div><dl class="family-breakdown"><div><dt>Pagou até agora</dt><dd>${money(balance.paid_cents)}</dd></div><div><dt>Sua parte nos pagamentos</dt><dd>${money(balance.share_paid_cents)}</dd></div><div><dt>Reembolsou às famílias</dt><dd>${money(balance.sent_cents)}</dd></div><div><dt>Recebeu das famílias</dt><dd>${money(balance.received_cents)}</dd></div></dl><div class="family-foot"><span>Sua parte futura: <strong class="amount">${balance.future_cents === null ? 'A definir' : money(balance.future_cents)}</strong></span><button class="text-link" data-action="family-monthly" data-family="${esc(balance.family_id)}">Ver mês a mês →</button></div></article>`;
  }
  function purchaseTable(expenses) {
    if (!expenses.length) return `<div class="table-panel">${(state.data.expenses || []).length ? empty('Nenhuma compra encontrada', 'Altere a busca ou os filtros.') : empty('Nenhuma compra registrada', '', newExpenseButton())}</div>`;
    const selectedFamily = families().find(family => String(family.id) === String(state.filters.family));
    const shareTotal = selectedFamily ? knownSum(expenses.filter(expense => expense.status !== 'cancelled').map(expense => familyExpenseShare(expense, selectedFamily.id).total_cents)) : null;
    return `<div class="table-panel purchase-table-panel"><div class="table-scroll purchase-table-scroll"><table class="purchase-table"><thead><tr><th scope="col" class="purchase-name-cell">Compra</th><th scope="col" class="purchase-payer-cell">Responsável</th><th scope="col" class="purchase-date-cell">Data</th><th scope="col" class="text-right purchase-total-cell">${selectedFamily ? 'Parte de ' + esc(selectedFamily.name) : 'Valor total'}</th><th scope="col" class="purchase-status-cell">Vencimentos</th><th scope="col" class="purchase-actions-cell">Detalhes</th></tr></thead><tbody>${expenses.map(expense => {
      const status = expenseStatus(expense), payer = expensePayerId(expense), payerLabel = payer ? familyName(payer) : 'A definir';
      const share = selectedFamily ? familyExpenseShare(expense, selectedFamily.id) : null;
      const total = selectedFamily ? share.total_cents : expense.total_cents;
      const totalKnown = Number.isSafeInteger(total) && total >= 0;
      const pricing = totalKnown && !priceEvidence(expense).documented ? onSiteExpense(expense) ? 'Estimativa' : 'A confirmar' : '';
      const pendingKnown = !supplierUnknown(expense) && Number.isSafeInteger(expense.pending_cents);
      const schedule = expense.status === 'cancelled' ? 'Cancelada' : !pendingKnown ? 'A esclarecer' : onSiteExpense(expense) ? `Na hospedagem${expense.due_on ? ' · '+date(expense.due_on,{day:'2-digit',month:'2-digit',year:'2-digit'}) : ''}` : compositeCardExpense(expense) && expense.installment_plan ? `${Number(expense.installment_plan.count)} faturas` : esc(status.label);
      const payment = expense.status === 'cancelled' ? '' : selectedFamily ? Number.isSafeInteger(share.future_cents) ? share.future_cents > 0 ? `${money(share.future_cents)} da sua parte a vencer` : '' : 'Parte a vencer: a esclarecer' : pendingKnown && expense.pending_cents > 0 ? `${money(expense.pending_cents)} a pagar` : '';
      return `<tr><th scope="row" class="purchase-name-cell"><button class="table-title" data-action="expense-detail" data-id="${esc(expense.id)}" title="${esc(expense.title)}"><span class="purchase-title-text">${esc(expense.title)}</span></button></th><td class="purchase-payer-cell">${esc(payerLabel)}</td><td class="purchase-date-cell">${expense.incurred_on ? date(expense.incurred_on) : 'A definir'}</td><td class="text-right purchase-total-cell">${totalKnown ? `<strong class="amount">${money(total)}</strong>` : `<strong class="subtle">${selectedFamily ? 'A esclarecer' : 'A definir'}</strong>`}${pricing ? `<span class="cell-meta purchase-value-note">${pricing}</span>` : ''}<span class="cell-meta purchase-mobile-owner" title="${esc(payerLabel)}${pricing ? ' · '+pricing : ''}">${esc(payerLabel)}${pricing ? ` · <abbr title="${pricing}" aria-label="${pricing}">${onSiteExpense(expense) ? 'Est.' : 'A conf.'}</abbr>` : ''}</span></td><td class="purchase-status-cell"><span class="purchase-schedule ${status.color === 'green' ? 'positive' : status.color === 'red' ? 'negative' : status.color === 'amber' ? 'amber' : ''}" title="${schedule}">${schedule}</span>${payment ? `<span class="cell-meta purchase-pending">${payment}</span>` : ''}</td><td class="purchase-actions-cell"><button class="text-link purchase-details" data-action="expense-detail" data-id="${esc(expense.id)}">Abrir →</button></td></tr>`;
    }).join('')}</tbody></table></div><div class="table-footer">${expenses.length} ${expenses.length === 1 ? 'compra' : 'compras'}${selectedFamily ? ` · Total das cotas ativas: <strong class="amount">${Number.isSafeInteger(shareTotal) ? money(shareTotal) : 'A esclarecer'}</strong>` : ''}</div></div>`;
  }
  function renderOverviewLegacy() {
    const data = state.data, s = data.summary || {};
    return `${pageHeading('', 'Encontro de contas', '', newExpenseButton())}
      ${reviewNotice()}
      <div class="metrics"><div class="metric"><div class="metric-label">Compromissos confirmados <span class="metric-symbol" aria-hidden="true">▤</span></div><div class="metric-value amount">${money(s.committed_cents)}</div><span class="metric-caption">Apenas despesas conferidas; veja referências abaixo</span></div><div class="metric"><div class="metric-label">Pago ou lançado no cartão <span class="metric-symbol positive" aria-hidden="true">↗</span></div><div class="metric-value amount">${money(s.paid_cents)}</div><span class="metric-caption">Não indica quitação da fatura</span></div><div class="metric accent"><div class="metric-label">Ainda falta pagar <span class="metric-symbol" aria-hidden="true">◷</span></div><div class="metric-value amount">${money(s.pending_cents)}</div><span class="metric-caption">Somente compromissos conferidos</span></div></div>
      <div class="section-heading"><div><h2>Como está cada família</h2><p>Acerto de agora separado dos compromissos futuros.</p></div>${tag('Somente registros conferidos')}</div>
      <div class="families">${(data.balances || []).map((b, index) => `<article class="family-card"><div class="family-head"><span class="family-avatar" style="background:${['#edf1f4','#f8efea','#edf1e8','#f5eff6'][index % 4]}">${esc(b.name?.slice(0, 1) || 'F')}</span>${esc(b.name)}</div><div class="family-result"><small>Saldo para acerto agora</small><strong class="amount ${b.balance_cents > 0 ? 'positive' : b.balance_cents < 0 ? 'negative' : ''}">${money(Math.abs(b.balance_cents))}</strong><span class="balance-tag ${b.balance_cents > 0 ? 'positive' : b.balance_cents < 0 ? 'negative' : 'subtle'}">${b.balance_cents > 0 ? '↙ A receber' : b.balance_cents < 0 ? '↗ A reembolsar' : state.data.summary?.unverified_count > 0 ? 'Sem saldo confirmado' : '✓ Em dia'}</span></div><div class="family-foot"><span>Sua parte a pagar ao fornecedor</span><strong class="amount">${money(b.future_cents)}</strong></div></article>`).join('')}</div>
      ${!(data.balances || []).length ? `<div class="panel">${empty('As famílias ainda não foram configuradas', 'As posições aparecerão aqui depois da configuração das famílias e da conferência das despesas.')}</div>` : ''}
      <div class="explanation">Confira o saldo pelas compras vencidas e pelas transferências registradas.</div>
      ${renderLegacy(true)}
      <div class="overview-lower"><section class="panel"><div class="section-heading"><div><h2>Para acertar as contas</h2><p>Considera os pagamentos até agora; consulte Mês a mês para os futuros.</p></div><span class="subtle" aria-hidden="true">⇄</span></div>${renderSettlements()}<div class="panel-note">Registre a transferência para ajustar o saldo das famílias.</div></section><section class="panel"><div class="section-heading"><div><h2>Próximos pagamentos</h2><p>Compromissos que ainda precisam ser pagos.</p></div><button class="text-link" data-page="expenses">Ver todos →</button></div>${renderUpcoming()}</section></div>
      ${renderCardInstallments()}<div class="only-mobile section-space">${window.JP27_CONFIG?.supabaseUrl ? '<button class="button small" data-action="change-password">Trocar senha</button>' : ''}<button class="button small" data-action="logout">Sair da conta</button><a class="button small" href="/api/export" download>Exportar registros</a></div>`;
  }
  function renderSettlements() {
    const items = state.data.settlements || [];
    if (!items.length) return empty('Nenhum acerto sugerido', state.data.summary?.unverified_count ? 'Conclua a conferência das despesas e dos pagamentos para obter sugestões confiáveis.' : 'Os registros confirmados não indicam transferências pendentes entre as famílias.');
    return items.map(t => `<div class="settlement"><div><div class="settlement-route"><strong>${esc(t.from || familyName(t.from_id))}</strong><span class="route-arrow" aria-hidden="true">→</span><strong>${esc(t.to || familyName(t.to_id))}</strong></div><span class="settlement-meta">${esc(t.from || familyName(t.from_id))} reembolsa ${esc(t.to || familyName(t.to_id))}</span></div><div class="settlement-right"><strong class="amount">${money(t.amount_cents)}</strong>${editable() ? `<button class="button small" data-action="suggest-transfer" data-from="${esc(t.from_id)}" data-to="${esc(t.to_id)}" data-amount="${Number(t.amount_cents)}">Registrar</button>` : ''}</div></div>`).join('');
  }
  function renderUpcoming() {
    const movements = (state.data.monthly_cashflow || []).flatMap(month => month.movements || []).filter(movement => movement.scope !== 'historical' && (movement.date || movement.month)).sort((a,b) => (a.date || a.month).localeCompare(b.date || b.month)).slice(0,4);
    const undated = (state.data.unscheduled_cashflow || []).length;
    return `${movements.length ? movements.map(movement => `<div class="upcoming"><div class="date-tile"><strong>${movement.date ? date(movement.date,{day:'2-digit'}) : '—'}</strong><span>${movement.date ? date(movement.date,{month:'short'}).replace('.','') : esc(monthLabel(movement.month).slice(0,3))}</span></div><div class="upcoming-title"><strong>${esc(movement.title)}</strong><span>${esc(movement.from_name || familyName(movement.from_family_id))} → ${esc(movement.to_name || 'Fornecedor')}</span></div><span class="amount">${money(movement.amount_cents)}</span></div>`).join('') : '<p class="form-help">Os vencimentos ainda precisam ser programados. Os valores já conhecidos aparecem em Mês a mês.</p>'}${undated ? `<div class="panel-note"><strong>${undated} parcelas ou pagamentos sem mês definido.</strong><br><button class="text-link" data-page="monthly">Programar com o primeiro vencimento →</button></div>` : ''}`;
  }
  function renderUpcomingLegacy() {
    const upcoming = (state.data.expenses || []).filter(e => e.status !== 'cancelled' && e.pending_cents > 0 && e.verified).sort((a, b) => (a.due_on || '9999').localeCompare(b.due_on || '9999')).slice(0, 5);
    if (!upcoming.length) return empty('Sem pagamentos confirmados em aberto', 'Compras e hospedagens a conferir aparecem na aba Conferência.');
    return upcoming.map(e => `<div class="upcoming"><div class="date-tile">${e.due_on ? `<strong>${date(e.due_on, { day: '2-digit' })}</strong><span>${date(e.due_on, { month: 'short' }).replace('.', '')}</span>` : '<strong>—</strong><span>sem data</span>'}</div><div class="upcoming-title"><button class="table-title" data-action="expense-detail" data-id="${esc(e.id)}">${esc(e.title)}</button><span>${esc(e.category || 'Sem categoria')} · ${e.due_on && e.due_on < today() ? 'vencido' : e.due_on ? date(e.due_on) : 'definir vencimento'}</span></div><span class="amount">${money(e.pending_cents)}</span></div>`).join('');
  }
  function filteredExpenses({ reviewOnly = false } = {}) {
    const f = state.filters;
    const selectedFamily = families().find(family => String(family.id) === String(f.family));
    return (state.data.expenses || []).filter(e => {
      if (reviewOnly && e.verified) return false;
      if (f.search && !`${e.title} ${e.notes || ''} ${e.category || ''}`.toLocaleLowerCase('pt-BR').includes(f.search.toLocaleLowerCase('pt-BR'))) return false;
      if (f.category && e.category !== f.category) return false;
      if (selectedFamily && !(e.allocations || []).some(a => String(a.family_id) === String(selectedFamily.id) && Number.isSafeInteger(a.amount_cents) && a.amount_cents > 0)) return false;
      if (f.status === 'review' && !supplierUnknown(e)) return false;
      if (f.status === 'paid' && !(!supplierUnknown(e) && e.pending_cents <= 0 && e.status !== 'cancelled')) return false;
      if (f.status === 'pending' && !(!supplierUnknown(e) && e.pending_cents > 0 && e.status !== 'cancelled')) return false;
      if (f.status === 'overdue' && !(!supplierUnknown(e) && e.pending_cents > 0 && e.due_on && e.due_on < today() && e.status !== 'cancelled')) return false;
      if (f.status === 'cancelled' && e.status !== 'cancelled') return false;
      return true;
    });
  }
  function expenseFilters() {
    const cats = [...new Set((state.data.expenses || []).map(e => e.category).filter(Boolean))].sort();
    return `<div class="filters"><input aria-label="Buscar despesas" type="search" id="filter-search" placeholder="Buscar compra…" value="${esc(state.filters.search)}"><select aria-label="Filtrar categoria" id="filter-category"><option value="">Todas as categorias</option>${cats.map(c => `<option ${state.filters.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select><select aria-label="Filtrar situação" id="filter-status">${[['','Todas as situações'],['review','Situação a esclarecer'],['pending','Em aberto'],['paid','Assumidas / pagas'],['overdue','Vencidas'],['cancelled','Canceladas']].map(([v,l]) => `<option value="${v}" ${state.filters.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select><select aria-label="Filtrar família" id="filter-family"><option value="">Todas as famílias</option>${familyOptions(state.filters.family)}</select></div>`;
  }
  function renderExpenses() {
    const items = filteredExpenses();
    return `${pageHeading('', 'Compras', '', newExpenseButton())}${expenseFilters()}<div id="expenses-table">${purchaseTable(items)}</div>`;
  }
  function expenseTable(items) {
    if (!items.length) return `<div class="table-panel">${empty('Nenhuma despesa encontrada', (state.data.expenses || []).length ? 'Tente mudar a busca ou os filtros.' : 'Registre a primeira compra ou revise os dados da planilha antes de começar.', !(state.data.expenses || []).length ? newExpenseButton() : '')}</div>`;
    return `<div class="table-panel"><div class="table-scroll"><table><thead><tr><th>Despesa / compra</th><th>Situação</th><th>Vencimento</th><th class="text-right">Valor total</th><th class="text-right">Já pago</th><th class="text-right">Em aberto</th><th></th></tr></thead><tbody>${items.map(e => { const status = expenseStatus(e); return `<tr><td><button class="table-title" data-action="expense-detail" data-id="${esc(e.id)}">${esc(e.title)}</button><span class="cell-meta">${esc(e.category || 'Sem categoria')} · ${e.incurred_on ? `Compra em ${date(e.incurred_on)}` : 'Data da compra a confirmar'}</span>${e.source ? `<span class="cell-meta">${esc(sourceLabel(e.source))}</span>` : ''}</td><td>${tag(status.label, status.color)}</td><td class="nowrap ${e.due_on && e.due_on < today() && e.pending_cents > 0 && e.verified ? 'negative' : ''}">${e.due_on ? date(e.due_on) : '<span class="subtle">A definir</span>'}</td><td class="text-right amount">${money(e.total_cents)}<span class="cell-meta">${priceEvidence(e).documented ? 'Valor documentado' : 'Estimativa / referência'}</span>${e.installment_plan ? '<div class="cell-tags">' + tag(Number(e.installment_plan.count) + 'x ' + (e.installment_plan.kind === 'card' ? 'no cartão' : 'a conferir')) + '</div>' : ''}</td><td class="text-right amount">${e.verified ? money(e.paid_cents) : '<span class="subtle">A conciliar</span>'}</td><td class="text-right amount">${e.verified ? money(e.pending_cents) : '<span class="subtle">Em conferência</span>'}</td><td>${editable() && e.status !== 'cancelled' ? `<button class="button small" data-action="new-payment" data-id="${esc(e.id)}">Pagamento</button>` : `<button class="text-link" data-action="expense-detail" data-id="${esc(e.id)}">Detalhes</button>`}</td></tr>`; }).join('')}</tbody></table></div><div class="table-footer">${items.length} ${items.length === 1 ? 'despesa' : 'despesas'} · Registros a conferir não entram nos saldos confirmados.</div></div>`;
  }
  function renderTransfers() {
    const transfers = [...(state.data.transfers || [])].sort((a,b) => !a.paid_on ? 1 : !b.paid_on ? -1 : b.paid_on.localeCompare(a.paid_on));
    const total = transfers.filter(transfer => !transfer.voided_at).reduce((sum,transfer) => sum + Number(transfer.amount_cents || 0),0);
    return `${pageHeading('', 'Pagamentos', '', newTransferButton())}<div class="transfer-summary"><strong class="amount">${money(total)}</strong><span>· ${transfers.filter(transfer => !transfer.voided_at).length} transferências</span></div><div class="table-panel">${transfers.length ? `<div class="table-scroll"><table class="transfers-table"><thead><tr><th scope="col" class="transfer-date-cell">Data</th><th scope="col">Quem enviou → recebeu</th><th scope="col" class="text-right">Valor</th><th scope="col" class="transfer-source-cell">Comprovante</th><th scope="col" class="transfer-observation-cell">Observação</th>${editable() ? '<th scope="col" class="transfer-actions-cell">Ações</th>' : ''}</tr></thead><tbody>${transfers.map(transfer => {
      const receiptId = transfer.receipt_id || transfer.source?.receipt_id;
      const proof = `${tag(evidenceLabel(transfer.evidence || transfer.source?.evidence || (transfer.source?.sheet ? 'spreadsheet' : 'manual')))}${receiptId ? '<div class="cell-meta">'+receiptLink(receiptId,'Ver comprovante')+'</div>' : ''}`;
      const actions = editable() && !transfer.voided_at ? `<button class="button small" data-action="edit-transfer" data-id="${esc(transfer.id)}">Editar</button><button class="text-link negative row-secondary" data-action="cancel-transfer" data-id="${esc(transfer.id)}">Estornar</button>` : '';
      return `<tr><td class="nowrap transfer-date-cell">${transfer.paid_on ? `<time datetime="${esc(transfer.paid_on)}"><span class="wide-date">${date(transfer.paid_on)}</span><span class="compact-date">${date(transfer.paid_on,{day:'2-digit',month:'2-digit'})}<small>${date(transfer.paid_on,{year:'numeric'})}</small></span></time>` : '<span class="amber">Sem data</span>'}</td><td class="transfer-route-cell"><strong>${esc(familyName(transfer.from_id))}</strong><span class="cell-meta">→ ${esc(familyName(transfer.to_id))}</span><button class="text-link transfer-mobile-details" data-action="transfer-detail" data-id="${esc(transfer.id)}" aria-label="Detalhes do pagamento de ${esc(familyName(transfer.from_id))} para ${esc(familyName(transfer.to_id))}">Detalhes</button></td><td class="text-right amount">${money(transfer.amount_cents)}${transfer.voided_at ? '<span class="cell-meta">Estornado</span>' : ''}</td><td class="transfer-source-cell">${proof}</td><td class="transfer-observation-cell">${transferObservation(transfer)}</td>${editable() ? `<td class="transfer-actions-cell">${actions}</td>` : ''}</tr>`;
    }).join('')}</tbody></table></div>` : empty('Nenhum pagamento registrado', '', newTransferButton())}</div>`;
  }
  function transferObservation(transfer) {
    const notes = String(transfer.notes || '').trim();
    const characters = Array.from(notes.replace(/\s+/g,' '));
    const preview = characters.length > 90 ? characters.slice(0,90).join('').trimEnd() + '…' : characters.join('');
    return `<span class="transfer-note-preview">${esc(preview || 'Acerto de saldo')}</span>${notes ? `<details class="transfer-note-details"><summary>Ver observação</summary><div class="transfer-note-full"><p>${esc(notes)}</p></div></details>` : ''}`;
  }
  function transferDetail(id) {
    const transfer = (state.data.transfers || []).find(item => String(item.id) === String(id));
    if (!transfer) return;
    const receiptId = transfer.receipt_id || transfer.source?.receipt_id;
    modal('Pagamento entre famílias', `<div class="transfer-detail-route"><strong>${esc(familyName(transfer.from_id))}</strong> → <strong>${esc(familyName(transfer.to_id))}</strong></div><div class="detail-list"><div class="detail-row"><span>Valor</span><strong class="amount">${money(transfer.amount_cents)}</strong></div><div class="detail-row"><span>Data</span><strong>${transfer.paid_on ? date(transfer.paid_on) : 'Não informada'}</strong></div></div>${receiptId ? `<div class="detail-section">${receiptLink(receiptId,'Ver comprovante')}</div>` : ''}${transfer.notes ? `<div class="detail-notes">${esc(transfer.notes)}</div>` : ''}${transfer.voided_at ? tag('Estornado') : ''}`, {eyebrow:'',actions:`<button class="button" type="button" data-action="close-modal">Fechar</button>${editable() && !transfer.voided_at ? `<button class="button" type="button" data-action="edit-transfer" data-id="${esc(transfer.id)}">Editar</button><button class="button danger" type="button" data-action="cancel-transfer" data-id="${esc(transfer.id)}">Estornar</button>` : ''}`});
  }
  function renderTransfersLegacy() {
    const transfers = [...(state.data.transfers || [])].sort((a, b) => (b.paid_on || '').localeCompare(a.paid_on || ''));
    return `${pageHeading('', 'Pagamentos', '', newTransferButton())}<section class="panel"><div class="section-heading"><div><h2>Simular quitação do saldo atual</h2><p>O cálculo usa os pagamentos e rateios confirmados.</p></div></div>${renderSettlements()}</section><div class="section-heading section-space"><div><h2>Reembolsos registrados</h2><p>Quem transferiu, quem recebeu, quanto e quando.</p></div></div><div class="table-panel">${transfers.length ? `<div class="table-scroll"><table><thead><tr><th>Data</th><th>Quem reembolsou</th><th>Quem recebeu</th><th class="text-right">Valor</th><th>Observação</th>${editable() ? '<th></th>' : ''}</tr></thead><tbody>${transfers.map(t => `<tr><td class="nowrap">${date(t.paid_on)}</td><td>${esc(familyName(t.from_id))}</td><td>${esc(familyName(t.to_id))}</td><td class="text-right amount">${money(t.amount_cents)}</td><td><span class="cell-meta">${esc(t.notes || '—')}</span></td>${editable() ? `<td>${t.voided_at ? tag('Estornado') : `<button class="text-link negative" data-action="cancel-transfer" data-id="${esc(t.id)}">Estornar</button>`}</td>` : ''}</tr>`).join('')}</tbody></table></div><div class="table-footer">O pagamento ajusta o saldo das famílias.</div>` : empty('Nenhum reembolso registrado', 'Quando uma família transferir para outra, registre aqui a data e o valor.', newTransferButton() + documentReviewLink())}</div>`;
  }
  function renderLegacy(compact = false) {
    const legacy = state.data.legacy;
    if (!legacy) return '';
    const list = legacy.balances || [];
    return `<section class="panel ${compact ? 'section-space' : ''}" style="margin-bottom:24px"><div class="section-heading"><div><span class="eyebrow amber" style="font-size:8px;margin-bottom:8px">REFERÊNCIA IMPORTADA PROVISÓRIA</span><h2>Saldos da planilha anterior</h2><p>${legacy.as_of ? `Referência de ${date(legacy.as_of)}. ` : ''}Confira os valores das fórmulas com os comprovantes.</p></div>${tag('Referência a conferir', 'amber')}</div>${list.length ? `<div class="table-scroll"><table><thead><tr><th>Família</th><th class="text-right">Saldo da referência</th><th>Interpretação provisória</th></tr></thead><tbody>${list.map(b => `<tr><td>${esc(b.name || familyName(b.family_id))}</td><td class="text-right amount">${money(b.balance_cents)}</td><td><span class="subtle">${b.balance_cents > 0 ? 'A receber' : b.balance_cents < 0 ? 'A reembolsar' : 'Em dia'} · a confirmar</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="review-source">Não há saldos legados disponíveis.</p>'}${legacy.warnings?.length ? `<details class="audit-details section-space"><summary>Observações originais da importação</summary>${legacy.warnings.map(w => `<div class="panel-note">${esc(typeof w === 'string' ? w : w.detail || w.message)}</div>`).join('')}</details>` : ''}${compact ? '<div class="panel-note">Consulte esta referência para conferir o controle anterior. Use Encontro de contas para acertar os saldos.</div>' : ''}</section>`;
  }
  function receiptLink(id, label = 'Abrir comprovante') {
    return id ? '<a class="text-link" href="/api/receipts/' + encodeURIComponent(id) + '" target="_blank" rel="noopener">' + esc(label) + '</a>' : '<span class="subtle">Sem comprovante</span>';
  }
  function renderDocumentTransfers() {
    const items = [...(state.data.legacy?.receipt_transfers || [])].sort((a,b) => (b.paid_on || '').localeCompare(a.paid_on || ''));
    if (!items.length) return '';
    return '<section class="section-space"><div class="section-heading"><div><h2>Reembolsos encontrados nos documentos</h2><p>Histórico documental a conciliar com as fórmulas da planilha.</p></div>' + tag(items.length + ' registros', 'amber') + '</div><div class="table-panel"><div class="table-scroll"><table><thead><tr><th>Data / horário</th><th>Remetente</th><th>Destinatário</th><th class="text-right">Valor</th><th>Conferência</th><th>Prova e observação</th></tr></thead><tbody>' + items.map(item => '<tr><td class="nowrap">' + date(item.paid_on) + (item.time ? '<span class="cell-meta">' + esc(item.time) + '</span>' : '') + '</td><td>' + esc(item.from_name || familyName(item.from_id)) + '</td><td>' + esc(item.to_name || (item.recipient_confirmed ? familyName(item.to_id) : 'Destinatário a confirmar')) + (!item.recipient_confirmed ? '<span class="cell-meta amber">Identidade do destinatário não comprovada</span>' : '') + '</td><td class="text-right amount">' + money(item.amount_cents) + '</td><td>' + tag(item.document_verified ? 'Comprovante conferido' : 'Conferência parcial', item.document_verified ? 'green' : 'amber') + '<div class="cell-tags">' + tag(item.recipient_confirmed ? 'Destinatário confirmado' : 'Destinatário a confirmar', item.recipient_confirmed ? '' : 'amber') + '</div></td><td>' + receiptLink(item.receipt_id) + (item.note ? '<span class="cell-meta">' + esc(item.note) + '</span>' : '') + '</td></tr>').join('') + '</tbody></table></div><div class="table-footer">Consulte os comprovantes para conferir os pagamentos importados. Os pagamentos registrados entram no encontro de contas.</div></div></section>';
  }
  function renderDocumentInstallments() {
    const items = state.data.credit_card_schedule || [];
    if (!items.length) return '';
    return '<section class="section-space"><div class="section-heading"><div><h2>Parcelas identificadas na fatura</h2><p>Lançamentos identificados nos extratos enviados.</p></div>' + tag(items.length + ' lançamentos', 'amber') + '</div><div class="table-panel"><div class="table-scroll"><table><thead><tr><th>Descritor / reserva</th><th>Titular</th><th>Parcela</th><th class="text-right">Valor da parcela</th><th>Data original de referência</th><th>Vencimento / quitação</th><th>Prova</th></tr></thead><tbody>' + items.map(item => {
      const expense = (state.data.expenses || []).find(e => String(e.id) === String(item.expense_id || item.expense_id_proposal));
      return '<tr><td><strong>' + esc(item.merchant || 'Lançamento da fatura') + '</strong>' + (expense ? '<span class="cell-meta"><button class="text-link" data-action="expense-detail" data-id="' + esc(expense.id) + '">' + esc(expense.title) + '</button></span>' : '') + '<div class="cell-tags">' + tag(item.mapping_confirmed ? 'Reserva identificada' : 'Identificação a conferir', item.mapping_confirmed ? '' : 'amber') + '</div>' + (item.note ? '<span class="cell-meta">' + esc(item.note) + '</span>' : '') + '</td><td>' + esc(item.holder_family_id ? familyName(item.holder_family_id) : 'A confirmar') + '</td><td class="nowrap">' + (item.number ? Number(item.number) : '—') + ' / ' + (item.total ? Number(item.total) : '—') + '</td><td class="text-right amount">' + money(item.installment_amount_cents) + '</td><td class="nowrap">' + (item.purchase_date_reference ? date(item.purchase_date_reference) : 'Não informada') + '<span class="cell-meta">Referência de compra</span></td><td>' + (item.due_on ? date(item.due_on) : '<span class="amber">Vencimento não confirmado</span>') + '<span class="cell-meta">Quitação não comprovada</span></td><td>' + receiptLink(item.receipt_id, 'Ver fatura') + (item.reservation_receipt_id ? '<div class="cell-meta">' + receiptLink(item.reservation_receipt_id, 'Ver reserva') + '</div>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div><div class="table-footer">Os documentos abaixo registram as cobranças do cartão. Confira os vencimentos em Compras.</div></div></section>';
  }
  function documentReviewLink() {
    return state.data.legacy?.receipt_transfers?.length ? '<button class="button" data-page="review" style="margin-left:8px">Conferir histórico importado →</button>' : '';
  }
  function renderReview() {
    const unverified = (state.data.expenses || []).filter(e => !e.verified && e.status !== 'cancelled');
    const checks = state.data.review_items || [];
    const receipts = state.data.receipts || [];
    const warnings = state.data.warnings || [];
    return `${pageHeading('PRIMEIRO CONFERIR, DEPOIS ACERTAR', 'Um controle em que dá para confiar.', 'A planilha é o ponto de partida. Comprovantes e datas transformam referências em registros confirmados.')}
      <div class="notice blue"><span aria-hidden="true">ⓘ</span><div class="notice-text">Confira os dados importados antes de confirmar a compra. Para parcelas do cartão, usamos o vencimento para considerar o pagamento.</div></div>
      <div class="review-grid"><section class="panel"><div class="section-heading"><div><h2>O que precisa ser resolvido</h2><p>${checks.length} ${checks.length === 1 ? 'ponto' : 'pontos'} de conciliação</p></div>${tag('Revisão', 'amber')}</div>${checks.length ? checks.map(item => `<div class="check-row"><span class="check-icon warn" aria-hidden="true">◷</span><div><strong>${esc(item.title)}</strong><p>${esc(item.detail || item.description || '')}</p></div></div>`).join('') : empty('Nenhuma dúvida registrada', 'Novas dúvidas de conciliação podem ser registradas nas observações de cada despesa.')} ${warnings.map(w => `<div class="panel-note">${esc(typeof w === 'string' ? w : w.detail || w.message)}</div>`).join('')}</section><section class="panel"><div class="section-heading"><div><h2>Comprovantes disponíveis</h2><p>Documentos protegidos pelo mesmo acesso do painel.</p></div></div>${receipts.length ? receipts.map(r => `<div class="check-row"><span class="check-icon" aria-hidden="true">▤</span><div><a href="/api/receipts/${encodeURIComponent(r.id)}" target="_blank" rel="noopener">${esc(r.label || r.filename || 'Abrir comprovante')}</a><p>${esc(r.filename || '')}</p></div></div>`).join('') : empty('Nenhum comprovante disponível', 'Os comprovantes serão exibidos aqui quando estiverem disponíveis.')}</section></div>
      ${renderLegacy()}
      ${renderDocumentTransfers()}
      ${renderDocumentInstallments()}
      <div class="section-heading section-space"><div><h2>Despesas que aguardam conferência</h2><p>Abra cada registro, revise o rateio e confirme os dados com a documentação.</p></div><span class="tag amber">${unverified.length} pendentes</span></div>${expenseTable(unverified)}
      <section class="panel section-space"><div class="section-heading"><div><h2>Como o saldo é calculado</h2><p>Confira como calcular o saldo.</p></div></div><div class="reconcile-lines"><div><span>Pagamentos adiantados pela família</span><span>Somam ao saldo</span></div><div><span>Parte da família nas despesas já pagas</span><span>Subtrai do saldo</span></div><div><span>Reembolsos que a família enviou</span><span>Somam ao saldo</span></div><div><span>Reembolsos que a família recebeu</span><span>Subtraem do saldo</span></div><div><span>Saldo positivo: a receber · negativo: a reembolsar</span><span>Saldo do grupo = R$ 0,00</span></div></div><div class="panel-note">Confira a parte da família nas compras futuras pelos vencimentos das parcelas.</div></section>`;
  }
  function sortFinancialEvents(a,b) {
    const first = a.date || a.month, second = b.date || b.month;
    if (!first && !second) return String(a.id || '').localeCompare(String(b.id || ''));
    if (!first) return 1;
    if (!second) return -1;
    return second.localeCompare(first);
  }
  function financialEventList(events, { compact = false } = {}) {
    if (!events.length) return empty('Nenhuma movimentação neste período', 'Mude os filtros para ver outras compras e reembolsos.');
    const labels = { purchase:'Compra ou reserva', installment_matured:'Parcela vencida considerada paga', card_payment:'Parcela vencida', transfer:'Reembolso entre famílias', supplier_payment:'Pagamento ao fornecedor', supplier_refund:'Devolução do fornecedor', installment_due:'Parcela prevista' };
    return `<ol class="financial-timeline ${compact ? 'compact-timeline' : ''}">${events.map(event => `<li class="financial-event ${event.scope === 'future' ? 'future-event' : ''}"><div class="event-date">${event.date ? `<time datetime="${esc(event.date)}">${date(event.date)}</time>` : event.month ? '<span>' + esc(monthLabel(event.month)) + '<br><small>' + (event.scope === 'historical' ? 'Dia não informado' : 'Dia a definir') + '</small></span>' : '<span class="amber">Data não informada</span>'}</div><div class="event-body"><div class="event-heading"><div><span class="event-type">${esc(labels[event.type] || 'Movimentação')}</span><strong>${esc(event.title)}</strong></div><strong class="amount">${event.amount_cents === null || event.amount_cents === undefined ? 'Valor a esclarecer' : money(event.amount_cents)}</strong></div>${event.description ? `<p>${esc(event.description)}</p>` : ''}${event.from_id || event.to_id ? `<p class="event-route">${event.from_id ? esc(familyName(event.from_id)) : 'Fornecedor'}${event.to_id ? ' → ' + esc(familyName(event.to_id)) : ' → fornecedor'}</p>` : ''}<div class="event-actions">${tag(evidenceLabel(event.evidence), event.evidence === 'pending' ? 'amber' : '')}${event.type !== 'transfer' && event.expense_id ? `<button class="text-link" data-action="expense-detail" data-id="${esc(event.expense_id)}">Ver compra</button>` : ''}${event.receipt_id ? receiptLink(event.receipt_id,'Ver comprovante') : ''}</div></div></li>`).join('')}</ol>`;
  }
  function filteredFinancialEvents(future = false) {
    const filters = state.timelineFilters || {};
    const events = (state.data.financial_timeline || []).filter(event => {
      if (future ? event.scope !== 'future' : event.scope === 'future') return false;
      if (filters.family && event.from_id !== filters.family && event.to_id !== filters.family && event.family_id !== filters.family) return false;
      if (filters.expense && event.expense_id !== filters.expense) return false;
      const month = event.month || event.due_month;
      const start = event.date || (month ? month + '-01' : null);
      const end = event.date || (month ? new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10) : null);
      if (filters.from && (!end || end < filters.from)) return false;
      if (filters.to && (!start || start > filters.to)) return false;
      return true;
    });
    return events.sort(future ? (a,b) => !(a.date || a.month) ? 1 : !(b.date || b.month) ? -1 : (a.date || a.month).localeCompare(b.date || b.month) : sortFinancialEvents);
  }
  function timelineFilters() {
    const filters = state.timelineFilters || {};
    return `<div class="timeline-filters"><div class="field"><label for="timeline-family">Família</label><select id="timeline-family"><option value="">Todas as famílias</option>${familyOptions(filters.family)}</select></div><div class="field"><label for="timeline-expense">Compra</label><select id="timeline-expense"><option value="">Todas as compras</option>${(state.data.expenses || []).map(expense => `<option value="${esc(expense.id)}" ${filters.expense === expense.id ? 'selected' : ''}>${esc(expense.title)}</option>`).join('')}</select></div><div class="field"><label for="timeline-from">A partir de</label><input id="timeline-from" type="date" value="${esc(filters.from || '')}"></div><div class="field"><label for="timeline-to">Até</label><input id="timeline-to" type="date" value="${esc(filters.to || '')}"></div><button class="button small" data-action="clear-timeline-filters">Limpar filtros</button></div>`;
  }
  function renderTimeline() {
    return `${pageHeading('COMPRAS, PAGAMENTOS E REEMBOLSOS', 'Linha do tempo', 'O que aconteceu com o dinheiro e os próximos vencimentos conhecidos.')}${timelineFilters()}<div id="timeline-results">${renderTimelineResults()}</div><div class="explanation">Compromissos sem mês ficam agrupados abaixo. <button class="text-link" data-page="history">Ver histórico de edições</button></div>`;
  }
  function renderTimelineResults() {
    const historical = filteredFinancialEvents(false), future = filteredFinancialEvents(true);
    const dated = event => Boolean(event.date || event.month);
    const history = historical.filter(dated), upcoming = future.filter(dated);
    const undated = [...historical.filter(event => !dated(event)),...future.filter(event => !dated(event))];
    const grouped = new Map();
    undated.forEach(event => {
      const key = [event.expense_id,event.from_id,event.to_id,event.type,event.scope].join('|');
      const group = grouped.get(key) || { ...event, count:0, amount_cents:0 };
      group.count++; group.amount_cents += Number(event.amount_cents || 0); grouped.set(key,group);
    });
    return `<section class="panel"><div class="section-heading"><div><h2>Movimentações registradas</h2><p>Mais recentes primeiro.</p></div></div>${financialEventList(history)}</section>${upcoming.length ? `<section class="panel section-space"><div class="section-heading"><div><h2>Próximos vencimentos conhecidos</h2><p>Datas ou meses já informados. Parcelas vencidas do comprador são consideradas pagas.</p></div></div>${financialEventList(upcoming)}</section>` : ''}${undated.length ? `<details class="audit-details section-space"><summary>${undated.length} registros sem mês definido · ${grouped.size} grupos</summary><div class="table-scroll section-space"><table><thead><tr><th>Compra / movimentação</th><th>Famílias</th><th>Registros</th><th class="text-right">Valor</th><th>Completar</th></tr></thead><tbody>${[...grouped.values()].map(group => `<tr><td>${esc((state.data.expenses || []).find(expense => expense.id === group.expense_id)?.title || group.title)}<span class="cell-meta">${group.scope === 'future' ? 'Vencimento a definir' : 'Data não informada'}</span></td><td>${group.from_id ? esc(familyName(group.from_id)) : 'Fornecedor'}${group.to_id ? ' → '+esc(familyName(group.to_id)) : ''}</td><td>${group.count}</td><td class="text-right amount">${money(group.amount_cents)}</td><td>${group.expense_id && editable() ? `<button class="text-link" data-action="edit-expense" data-id="${esc(group.expense_id)}">Informar vencimentos</button>` : '<button class="text-link" data-page="transfers">Ver reembolsos</button>'}</td></tr>`).join('')}</tbody></table></div></details>` : ''}`;
  }
  function renderFuturePayments() {
    return `${pageHeading('O QUE AINDA VEM PELA FRENTE', 'Próximos pagamentos', 'Pagamentos aos fornecedores, parcelas do cartão e reembolsos combinados.')}${timelineFilters()}<section class="panel" id="timeline-results">${financialEventList(filteredFinancialEvents(true))}</section>${renderCardInstallments()}`;
  }
  function monthLabel(month) {
    if (!/^\d{4}-\d{2}$/.test(month || '')) return 'Mês a definir';
    return new Intl.DateTimeFormat('pt-BR', { month:'long', year:'numeric', timeZone:'UTC' }).format(new Date(month+'-15T12:00:00Z'));
  }
  function dueLabel(item) {
    return item.due_on || item.date ? date(item.due_on || item.date) : item.due_month || item.month ? monthLabel(item.due_month || item.month) + (item.payment_state === 'paid' ? ' · dia não informado' : ' · dia a definir') : 'A definir';
  }
  function cardDueStatus(item) {
    const asOf = state.data?.as_of?.slice(0,10) || today();
    if (!item.due_on && !item.due_month && !item.date && !item.month) return 'Definir vencimento';
    const due = item.due_on || item.date, month = item.due_month || item.month;
    return (due ? due <= asOf : month <= asOf.slice(0,7)) ? 'Vencida: considerada paga pelo responsável' : 'A vencer';
  }
  function updateCardDueStatuses() {
    if (!$('#expense-form')) return;
    $$('.installment-row', $('#expense-form')).forEach(row => {
      $('.installment-auto-status',row).textContent = cardDueStatus({ due_on:$('.installment-due',row).value || null, due_month:$('.installment-month',row).value || null });
    });
  }
  function consecutiveMonths(firstMonth,count) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(firstMonth || '')) throw new Error('Informe o primeiro mês.');
    const [year,month] = firstMonth.split('-').map(Number);
    return Array.from({ length:count },(_,index) => new Date(Date.UTC(year,month-1+index,1)).toISOString().slice(0,7));
  }
  function renderMonthlyCashflow() {
    const filters = state.monthlyFilters || {}, allMonths = state.data.monthly_cashflow || [];
    const months = allMonths.filter(month => !filters.month || month.month === filters.month);
    const unscheduled = (state.data.unscheduled_cashflow || []).filter(movement => !filters.family || movement.from_family_id === filters.family || movement.to_family_id === filters.family);
    const grouped = new Map();
    unscheduled.forEach(movement => {
      const key = [movement.expense_id,movement.kind,movement.from_family_id,movement.to_family_id].join('|');
      const group = grouped.get(key) || { ...movement, amount_cents:0, count:0 };
      group.amount_cents += Number(movement.amount_cents || 0); group.count++; grouped.set(key,group);
    });
    return `${pageHeading('QUANTO SEPARAR A CADA MÊS', 'Mês a mês', 'Planeje a reserva de cada família e veja quem paga a quem. Compras futuras entram no mesmo calendário.')}<div class="monthly-filters"><div class="field"><label for="monthly-family">Família</label><select id="monthly-family"><option value="">Todas as famílias</option>${familyOptions(filters.family)}</select></div><div class="field"><label for="monthly-month">Mês</label><select id="monthly-month"><option value="">Todos os meses</option>${allMonths.map(month => `<option value="${esc(month.month)}" ${filters.month === month.month ? 'selected' : ''}>${esc(monthLabel(month.month))}</option>`).join('')}</select></div></div><div class="notice blue"><div class="notice-text">Reserve o valor da coluna <strong>Antes dos reembolsos</strong>. Recebimentos previstos podem reduzir o desembolso, mas ainda precisam acontecer. Parcelas vencidas são consideradas pagas pelo responsável.${state.data.planning_rule?.description ? '<br>' + esc(state.data.planning_rule.description) : ''}</div></div>${months.length ? months.map(month => `<section class="panel month-panel"><div class="section-heading"><div><h2>${esc(monthLabel(month.month))}</h2><p>Fatura do cartão, reembolsos e contas dos fornecedores.</p></div></div><div class="table-scroll"><table class="monthly-budget"><thead><tr><th>Família</th><th class="text-right">Antes dos reembolsos</th><th class="text-right">A receber previsto</th><th class="text-right">Após os reembolsos</th></tr></thead><tbody>${(month.families || []).filter(family => !filters.family || family.family_id === filters.family).map(family => `<tr><th scope="row">${esc(family.name || familyName(family.family_id))}</th><td class="text-right amount budget-gross">${money(family.outgoing_cents)}</td><td class="text-right amount">${money(family.incoming_cents)}</td><td class="text-right amount ${family.net_cents < 0 ? 'positive' : ''}">${family.net_cents < 0 ? money(Math.abs(family.net_cents))+' a receber' : money(family.net_cents)}</td></tr>`).join('')}</tbody></table></div><h3 class="monthly-movements-heading">Quem paga a quem</h3>${cashflowTable((month.movements || []).filter(movement => !filters.family || movement.from_family_id === filters.family || movement.to_family_id === filters.family))}</section>`).join('') : `<section class="panel">${empty('Os meses ainda precisam ser programados', 'Os valores conhecidos estão abaixo. Informe o primeiro vencimento de cada compra para distribuir as parcelas automaticamente.')}</section>`}${unscheduled.length ? `<section class="panel section-space"><div class="section-heading"><div><h2>Valores ainda sem mês definido</h2><p>O custo já está registrado. Falta dizer em quais meses o dinheiro sairá.</p></div>${tag(unscheduled.length+' parcelas / pagamentos','amber')}</div><div class="table-scroll"><table><thead><tr><th>Compra / compromisso</th><th>Quem paga → quem recebe</th><th class="text-right">Valor sem data</th><th>Programar</th></tr></thead><tbody>${[...grouped.values()].map(group => `<tr><td><strong>${esc(group.title)}</strong><span class="cell-meta">${group.kind === 'card' ? 'Fatura do cartão' : group.kind === 'reimbursement' ? 'Reembolso entre famílias' : 'Fornecedor'} · ${group.count} ${group.count === 1 ? 'pagamento' : 'parcelas'}</span></td><td>${esc(group.from_name || familyName(group.from_family_id))} → ${esc(group.to_name || (group.to_family_id ? familyName(group.to_family_id) : 'Fornecedor'))}</td><td class="text-right amount">${money(group.amount_cents)}</td><td>${group.expense_id && editable() ? `<button class="button small" data-action="edit-expense" data-id="${esc(group.expense_id)}">Informar 1º vencimento</button>` : 'Data a definir'}</td></tr>`).join('')}</tbody></table></div></section>` : ''}<div class="explanation">Consulte os vencimentos para planejar os pagamentos.</div>`;
  }
  function cashflowTable(movements) {
    if (!movements.length) return '<p class="subtle">Nenhum pagamento previsto para esta família no mês.</p>';
    return `<div class="table-scroll"><table><thead><tr><th>Vencimento</th><th>Quem paga → quem recebe</th><th>Compra / parcela</th><th class="text-right">Valor</th></tr></thead><tbody>${movements.map(movement => `<tr><td class="nowrap">${dueLabel(movement)}</td><td>${esc(movement.from_name || familyName(movement.from_family_id))} → ${esc(movement.to_name || (movement.to_family_id ? familyName(movement.to_family_id) : movement.kind === 'card' ? 'Cartão' : 'Fornecedor'))}</td><td>${movement.expense_id ? `<button class="text-link" data-action="expense-detail" data-id="${esc(movement.expense_id)}">${esc(movement.title)}</button>` : esc(movement.title)}${movement.kind === 'card' ? '<span class="cell-meta">' + esc(cardDueStatus(movement)) + '</span>' : movement.overdue ? '<span class="cell-meta amber">Vencimento passado · combinar acerto</span>' : !movement.confirmed ? '<span class="cell-meta amber">Planejamento a conferir</span>' : ''}</td><td class="text-right amount">${money(movement.amount_cents)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function monthlyDates(firstDate, count) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDate || '')) throw new Error('Informe o primeiro vencimento.');
    const [year,month,day] = firstDate.split('-').map(Number), first = new Date(Date.UTC(year,month-1,day));
    if (first.getUTCFullYear() !== year || first.getUTCMonth() !== month-1 || first.getUTCDate() !== day) throw new Error('Revise o primeiro vencimento.');
    return Array.from({ length:count },(_,index) => {
      const target = new Date(Date.UTC(year,month-1+index,1));
      const lastDay = new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
      target.setUTCDate(Math.min(day,lastDay)); return target.toISOString().slice(0,10);
    });
  }
  function scheduleCardDates() {
    try {
      if (!$$('.installment-row').length) generateInstallments();
      const fields = $$('.installment-due', $('#expense-form')), dates = monthlyDates($('#installment-first-due').value,fields.length);
      fields.forEach((input,index) => { input.value = dates[index]; $('.installment-month',input.closest('.installment-row')).value = dates[index].slice(0,7); });
      updateCardDueStatuses();
    } catch (error) { formError(error.message); }
  }
  function scheduleReimbursementDates() {
    try {
      if (!$$('.reimbursement-plan-card').length) generateReimbursementPlans();
      const first = $('#reimbursement-first-due').value;
      $$('.reimbursement-plan-card', $('#expense-form')).forEach(card => {
        if (!$('.reimbursement-include',card).checked) return;
        const fields = $$('.reimbursement-due',card), dates = monthlyDates(first,fields.length);
        fields.forEach((input,index) => { input.value = dates[index]; $('.reimbursement-month',input.closest('.reimbursement-item')).value = dates[index].slice(0,7); }); $('.reimbursement-confirmed',card).checked = false;
      });
    } catch (error) { formError(error.message); }
  }
  function scheduleCardMonths() {
    try {
      if (!$$('.installment-row').length) generateInstallments();
      const rows = $$('.installment-row', $('#expense-form')), months = consecutiveMonths($('#installment-first-month').value,rows.length);
      rows.forEach((row,index) => { $('.installment-month',row).value = months[index]; $('.installment-due',row).value = ''; });
      updateCardDueStatuses();
    } catch (error) { formError(error.message); }
  }
  function scheduleReimbursementMonths() {
    try {
      if (!$$('.reimbursement-plan-card').length) generateReimbursementPlans();
      const first = $('#reimbursement-first-month').value;
      $$('.reimbursement-plan-card', $('#expense-form')).forEach(card => {
        if (!$('.reimbursement-include',card).checked) return;
        const rows = $$('.reimbursement-item',card), months = consecutiveMonths(first,rows.length);
        rows.forEach((row,index) => { $('.reimbursement-month',row).value = months[index]; $('.reimbursement-due',row).value = reimbursementDueDate(months[index]) || ''; });
        $('.reimbursement-confirmed',card).checked = false;
      });
    } catch (error) { formError(error.message); }
  }
  function renderQuestions() {
    const questions = visibleQuestions();
    return `${pageHeading('', 'Dúvidas', 'Confira as informações abaixo.')}<div class="question-list">${questions.length ? questions.map(question => `<article class="panel question-card"><div><span class="eyebrow">${question.severity === 'high' ? 'Afeta o encontro de contas' : 'Completar informação'}</span><h2>${esc(question.title)}</h2><p>${esc(question.detail || '')}</p></div><div class="question-actions">${question.transfer_id ? `<button class="button primary small" data-action="edit-transfer" data-id="${esc(question.transfer_id)}">Informar data do reembolso</button>` : ''}${question.expense_id ? `<button class="button primary small" data-action="edit-expense" data-id="${esc(question.expense_id)}">${question.field === 'installment_plan' ? 'Informar parcelas e datas' : 'Revisar esta compra'}</button><button class="text-link" data-action="expense-detail" data-id="${esc(question.expense_id)}">Ver dados e origem</button>` : question.transfer_id ? '' : '<button class="button small" data-page="timeline">Ver movimentações</button>'}${question.receipt_id ? receiptLink(question.receipt_id,'Abrir documento') : ''}</div></article>`).join('') : `<section class="panel">${empty('Nenhuma dúvida em aberto', 'Compras e pagamentos já informados continuam disponíveis nas outras abas.')}</section>`}</div><details class="audit-details section-space"><summary>Consultar documentos e referência da planilha anterior</summary><div class="section-space">${renderLegacy()}${renderDocumentTransfers()}${renderDocumentInstallments()}${renderReceipts()}</div></details>`;
  }
  function renderReceipts() {
    const receipts = state.data.receipts || [];
    return `<section class="panel section-space"><div class="section-heading"><div><h2>Documentos da viagem</h2><p>Comprovantes e reservas com acesso restrito.</p></div></div>${receipts.length ? receipts.map(receipt => `<div class="document-row">${receiptLink(receipt.id,receipt.label || receipt.filename || 'Abrir documento')}<span class="review-source">${esc(receipt.filename || '')}</span></div>`).join('') : '<p>Nenhum documento disponível.</p>'}</section>`;
  }
  function renderHistory() {
    const items = [...(state.data.audit || [])].sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    return `${pageHeading('', 'Histórico', '')}<div class="table-panel">${items.length ? `<div class="audit-list">${items.map(item => `<article class="audit-item"><div class="audit-date"><strong>${date(item.at, { day: '2-digit', month: 'short', year: 'numeric' })}</strong>${date(item.at, { hour: '2-digit', minute: '2-digit' })}</div><div><div class="audit-description">${esc(item.description || item.action)}</div><div class="audit-actor">Por ${esc(item.actor || 'Sistema')} · ${esc(item.action || '')}</div></div></article>`).join('')}</div>` : empty('O histórico começa aqui', 'As alterações feitas pelas famílias aparecerão nesta página.')}</div>`;
  }
  function render() {
    $$('#navigation [data-page]').forEach(button => { const selected = button.dataset.page === state.page || button.dataset.page === 'overview' && ['monthly','timeline','upcoming'].includes(state.page); button.classList.toggle('active', selected); if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    const views = { family: renderMyFamily, overview: renderReconciliation, expenses: renderExpenses, transfers: renderTransfers, timeline: renderReconciliation, upcoming: renderReconciliation, monthly: renderReconciliation, review: renderQuestions, history: renderHistory };
    $('#page-content').innerHTML = views[state.page]();
  }
  function familyOptions(selected = '', excluded = '') {
    return families().filter(f => String(f.id) !== String(excluded)).map(f => `<option value="${esc(f.id)}" ${String(f.id) === String(selected) ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
  }
  function modal(title, content, { eyebrow = 'CONTAS DA VIAGEM', actions = '', formId = '' } = {}) {
    $('#modal-content').innerHTML = `${formId ? `<form id="${esc(formId)}">` : ''}<div class="modal-header"><div><span class="eyebrow">${eyebrow}</span><h2 id="modal-title">${esc(title)}</h2></div><button class="modal-close" type="button" data-action="close-modal" aria-label="Fechar janela">×</button></div><div class="modal-body"><p class="form-error" id="modal-error" role="alert" hidden></p>${content}</div>${actions ? `<div class="modal-actions">${actions}</div>` : ''}${formId ? '</form>' : ''}`;
    if (!$('#modal').open) $('#modal').showModal();
  }
  const cancelButton = '<button class="button" type="button" data-action="close-modal">Cancelar</button>';
  function expenseForm(id) {
    if (!editable()) return;
    const e = (state.data.expenses || []).find(item => String(item.id) === String(id));
    const allocations = e?.allocations || [];
    modal(e ? 'Editar despesa' : 'Nova despesa', `<div class="form-grid"><div class="field full"><label for="expense-title">O que foi comprado ou reservado?</label><input id="expense-title" name="title" placeholder="Ex.: hospedagem em Tokyo" required maxlength="200" value="${esc(e?.title || '')}"></div><div class="field"><label for="expense-category">Categoria</label><input id="expense-category" name="category" list="categories" required maxlength="80" placeholder="Ex.: Hospedagem" value="${esc(e?.category || '')}"><datalist id="categories">${['Hospedagem','Transporte','Alimentação','Passeios','Compras','Seguro','Outros'].map(c => `<option>${c}</option>`).join('')}</datalist></div><div class="field"><label for="expense-estimate">Estimativa da reserva em reais (R$)</label><input id="expense-estimate" name="estimate" data-pricing inputmode="decimal" placeholder="0,00" required value="${e ? amountInput(e.pricing?.estimate_cents ?? e.total_cents) : ''}"><small>Valor previsto na reserva, antes da cobrança definitiva.</small></div><div class="field full"><label class="checkbox-label"><input id="pricing-final" type="checkbox" name="final_confirmed" ${e?.pricing?.final_confirmed ? 'checked' : ''}><span>Detalhar a cobrança do cartão.<br><small>Preencha a cobrança, o IOF e as taxas discriminados no documento. Consideramos cada parcela paga no vencimento da fatura.</small></span></label></div><div id="card-pricing-fields" class="field full" ${e?.pricing?.final_confirmed ? '' : 'hidden'}><div class="form-grid"><div class="field full"><label for="card-principal">Cobrança convertida em reais (R$)</label><input id="card-principal" name="card_principal" data-pricing inputmode="decimal" placeholder="0,00" value="${Number.isSafeInteger(e?.pricing?.card_principal_cents) ? amountInput(e.pricing.card_principal_cents) : ''}"><small>Informe a cobrança em reais antes do IOF.</small></div><div class="field"><label for="card-iof">IOF (R$)</label><input id="card-iof" name="iof" data-pricing inputmode="decimal" value="${Number.isSafeInteger(e?.pricing?.iof_cents) ? amountInput(e.pricing.iof_cents) : ''}" ${e?.pricing?.final_confirmed ? 'required' : ''}></div><div class="field"><label for="card-other">Outras taxas (R$)</label><input id="card-other" name="other_fees" data-pricing inputmode="decimal" value="${Number.isSafeInteger(e?.pricing?.other_fees_cents) ? amountInput(e.pricing.other_fees_cents) : ''}" ${e?.pricing?.final_confirmed ? 'required' : ''}></div></div></div><div class="field full"><label for="expense-total">Valor adotado no rateio (R$)</label><input id="expense-total" name="total" readonly inputmode="decimal" required value="${e ? amountInput(e.total_cents) : ''}"><small id="pricing-explanation">${e?.pricing?.final_confirmed ? 'Cobrança convertida + IOF + outras taxas.' : priceEvidence(e).documented ? 'O valor documentado será usado no rateio.' : 'A estimativa será usada até a confirmação do custo final.'}</small></div><div class="field"><label for="expense-incurred">Data da compra <small>se conhecida</small></label><input id="expense-incurred" name="incurred_on" type="date" value="${esc(e?.incurred_on || '')}"></div><div class="field"><label for="expense-payment-status">Situação da cobrança</label><select id="expense-payment-status" name="payment_status"><option value="unknown" ${!e?.payment_status || e.payment_status === 'unknown' ? 'selected' : ''}>Cobrança a esclarecer</option><option value="card_charged" ${e?.payment_status === 'card_charged' ? 'selected' : ''}>Cobrado no cartão</option><option value="on_site" ${['on_site','pay_at_property'].includes(e?.payment_status) ? 'selected' : ''}>Será pago na hospedagem</option><option value="paid" ${e?.payment_status === 'paid' ? 'selected' : ''}>Pago ao fornecedor</option></select></div><div class="field"><label for="expense-payer">Família que assumiu a compra</label><select id="expense-payer" name="declared_payer_family_id"><option value="">A identificar</option>${familyOptions(e ? expensePayerId(e) : '')}</select></div><div class="field"><label for="expense-due">Vencimento <small>se definido</small></label><input id="expense-due" name="due_on" type="date" value="${esc(e?.due_on || '')}"><small>Para hotel, informe a data do pagamento combinado.</small></div><div class="field"><label for="expense-currency">Moeda original</label><select id="expense-currency" name="currency"><option value="BRL" ${!e?.currency || e?.currency === 'BRL' ? 'selected' : ''}>Real · BRL</option><option value="JPY" ${e?.currency === 'JPY' ? 'selected' : ''}>Iene · JPY</option><option value="USD" ${e?.currency === 'USD' ? 'selected' : ''}>Dólar · USD</option></select></div><div class="field"><label for="expense-original">Valor na moeda original <small>opcional</small></label><input id="expense-original" name="original_amount" inputmode="decimal" placeholder="Somente referência" value="${esc(e?.original_amount ?? '')}"><small>Informe o valor em reais nos campos acima.</small></div><div class="field full form-section"><div class="allocation-toolbar"><span>Quanto cabe a cada família?</span><button class="text-link" type="button" data-action="split-equal">Dividir igualmente</button></div><small>Ajuste a parte de cada família até a soma bater com o total. Ao mudar o custo, preservamos a proporção do rateio.</small><div id="allocations">${families().map(f => `<label class="allocation-row" for="allocation-${esc(f.id)}"><span>${esc(f.name)}</span><input id="allocation-${esc(f.id)}" data-family="${esc(f.id)}" class="allocation-input" aria-label="Parte de ${esc(f.name)} em reais" inputmode="decimal" value="${amountInput(allocations.find(a => String(a.family_id) === String(f.id))?.amount_cents || 0)}" required></label>`).join('')}</div><div id="allocation-total" class="allocation-total"></div></div>${installmentFields(onSiteExpense(e) ? null : e?.installment_plan)}<div class="field full"><label for="expense-notes">Observações e origem <small>opcional</small></label><textarea id="expense-notes" name="notes" maxlength="5000" placeholder="Número da reserva, regras de cancelamento, câmbio, IOF ou dúvidas a confirmar…">${esc(e?.notes || '')}</textarea></div><div class="field"><label for="expense-status">Registro</label><select id="expense-status" name="status"><option value="confirmed" ${e?.status !== 'cancelled' && e?.status !== 'planned' ? 'selected' : ''}>Compra ou reserva</option><option value="planned" ${e?.status === 'planned' ? 'selected' : ''}>Planejada</option><option value="cancelled" ${e?.status === 'cancelled' ? 'selected' : ''}>Cancelada</option></select></div><div class="field full"><p class="form-help">Registre as transferências entre famílias em Pagamentos.</p></div></div>`, { formId: 'expense-form', eyebrow: 'COMPRA', actions: `${cancelButton}<button class="button primary" type="submit">${e ? 'Salvar alterações' : 'Registrar despesa'}</button>` });
    $('#expense-form').dataset.id = e?.id || '';
    $('#expense-form').dataset.version = e?.version ?? '';
    $('#expense-form').dataset.splitMode = e && allocations.length === families().length && Math.max(...allocations.map(a => a.amount_cents)) - Math.min(...allocations.map(a => a.amount_cents)) <= 1 ? 'equal' : e ? 'manual' : 'equal';
    if (!e) splitEqual(); else updateAllocationTotal();
    if (!onSiteExpense(e) && e?.installment_plan?.items) renderInstallmentRows(e.installment_plan.items);
  }
  function installmentFields(plan) {
    return '<div class="field full form-section"><label class="checkbox-label"><input id="installment-enabled" type="checkbox" ' + (plan ? 'checked' : '') + '><span>A compra no cartão será paga em parcelas.</span></label><small>Cada parcela da fatura entra no acerto no mês do vencimento.</small><div id="installment-settings" ' + (plan ? '' : 'hidden') + '><div class="form-grid"><div class="field full"><label for="installment-kind">O que está sendo parcelado?</label><select id="installment-kind"><option value="to_confirm" ' + (plan?.kind === 'to_confirm' ? 'selected' : '') + '>Ainda a confirmar</option><option value="card" ' + (!plan || plan.kind === 'card' ? 'selected' : '') + '>Fatura do cartão</option>' + (plan?.kind === 'family_reimbursement' ? '<option value="family_reimbursement" selected>Calendário anterior · revisar vencimentos</option>' : '') + '</select></div><div class="field"><label for="installment-count">Número de parcelas</label><input id="installment-count" type="number" min="1" max="36" step="1" value="' + Number(plan?.count || 4) + '"></div><div class="field"><label for="installment-payer">Titular ou família responsável</label><select id="installment-payer"><option value="">A confirmar</option>' + familyOptions(plan?.payer_family_id || '') + '</select></div><div class="field full"><div class="schedule-shortcut"><label for="installment-first-month">Primeiro mês do cartão <small>sem definir o dia</small></label><input id="installment-first-month" type="month"><button class="button small" type="button" data-action="schedule-card-months">Programar os meses</button><label for="installment-first-due">Primeiro vencimento do cartão <small>se souber o dia</small></label><input id="installment-first-due" type="date"><button class="button small" type="button" data-action="schedule-card-dates">Programar mensalmente</button><small>Use o mesmo dia nos meses seguintes e ajuste as datas se precisar.</small></div><button class="button small" type="button" data-action="generate-installments">Gerar parcelas iguais</button><small>Confira os valores e os vencimentos das parcelas.</small><div id="installment-rows" class="table-scroll"></div><div id="installment-total" class="allocation-total"></div></div><div class="field full"><p class="form-help">Consideramos a parcela paga pelo responsável no vencimento.</p></div></div></div></div>';
  }
  function reimbursementFields(expense) {
    const plans = expense?.reimbursement_plans || [];
    const receiver = plans[0]?.to_family_id || expense?.installment_plan?.payer_family_id || expense?.payments?.find(p => p.method === 'card_purchase' && !p.voided_at)?.family_id || '';
    return `<div class="field full form-section"><h3>Reembolso parcelado por família</h3><label class="checkbox-label"><input id="reimbursement-enabled" type="checkbox" ${plans.length ? 'checked' : ''}><span>As famílias combinaram reembolsar esta compra em parcelas.</span></label><small>Confira o calendário do cartão e os pagamentos entre famílias.</small><div id="reimbursement-settings" ${plans.length ? '' : 'hidden'}><div class="form-grid"><div class="field full"><label for="reimbursement-receiver">Quem receberá os reembolsos?</label><select id="reimbursement-receiver"><option value="">Selecionar família</option>${familyOptions(receiver)}</select><small>A família que comprou no cartão costuma ser a destinatária. A própria parte dela fica fora dos reembolsos.</small></div><div class="field full"><button class="button small" type="button" data-action="generate-reimbursement-plans">Gerar planos pelo rateio atual</button><small>Usa as parcelas e os meses da compra, com os vencimentos de reembolso combinados. Planos existentes para o mesmo destinatário são preservados.</small></div></div><div class="schedule-shortcut"><label for="reimbursement-first-month">Primeiro mês dos reembolsos <small>usa a regra de dias úteis</small></label><input id="reimbursement-first-month" type="month"><button class="button small" type="button" data-action="schedule-reimbursement-months">Programar os meses das famílias</button><label for="reimbursement-first-due">Primeiro vencimento dos reembolsos <small>se souber o dia</small></label><input id="reimbursement-first-due" type="date"><button class="button small" type="button" data-action="schedule-reimbursement-dates">Programar mensalmente para as famílias</button><small>Preenche cada plano a partir desta data. As datas individuais continuam editáveis.</small></div><div id="reimbursement-plan-cards"></div></div></div>`;
  }
  function readReimbursementDrafts() {
    return $$('.reimbursement-plan-card', $('#expense-form')).map(card => ({
      id: card.dataset.planId || undefined,
      from_family_id: card.dataset.from,
      to_family_id: card.dataset.to,
      included: $('.reimbursement-include', card).checked,
      count: Number($('.reimbursement-count', card).value),
      total_cents: parseMoney($('.reimbursement-total', card).value),
      confirmed: $('.reimbursement-confirmed', card).checked,
      items: $$('.reimbursement-item', card).map((row, index) => ({ number: index + 1, amount_cents: parseMoney($('.reimbursement-amount', row).value), due_on: $('.reimbursement-due', row).value || null, due_month: $('.reimbursement-due', row).value?.slice(0,7) || $('.reimbursement-month',row).value || null }))
    }));
  }
  function reimbursementRows(items, familyId) {
    return `<table><thead><tr><th>Parcela</th><th>Valor (R$)</th><th>Vencimento combinado</th></tr></thead><tbody>${items.map((item,index) => `<tr class="reimbursement-item"><td>${index + 1}/${items.length}</td><td><input class="reimbursement-amount" aria-label="Valor da parcela ${index + 1} de ${esc(familyName(familyId))}" inputmode="decimal" value="${amountInput(item.amount_cents)}"></td><td><input class="reimbursement-month" aria-label="Mês da parcela ${index + 1} de ${esc(familyName(familyId))}" type="month" value="${esc(item.due_month || item.due_on?.slice(0,7) || '')}"><input class="reimbursement-due" aria-label="Vencimento da parcela ${index + 1} de ${esc(familyName(familyId))}" type="date" value="${esc(item.due_on || '')}"></td></tr>`).join('')}</tbody></table>`;
  }
  function renderReimbursementPlanCards(plans) {
    const holder = $('#reimbursement-plan-cards');
    if (!holder) return;
    holder.innerHTML = plans.length ? plans.map((plan, index) => `<fieldset class="reimbursement-plan-card" data-plan-id="${esc(plan.id || '')}" data-from="${esc(plan.from_family_id)}" data-to="${esc(plan.to_family_id)}"><legend>${esc(familyName(plan.from_family_id))} → ${esc(familyName(plan.to_family_id))}</legend><label class="checkbox-label"><input class="reimbursement-include" type="checkbox" ${plan.included === false ? '' : 'checked'}><span>Incluir este plano de reembolso</span></label><div class="reimbursement-plan-fields" ${plan.included === false ? 'hidden' : ''}><div class="form-grid"><div class="field"><label for="reimbursement-total-${index}">Total a reembolsar (R$)</label><input id="reimbursement-total-${index}" class="reimbursement-total" inputmode="decimal" value="${amountInput(plan.total_cents)}"></div><div class="field"><label for="reimbursement-count-${index}">Número de parcelas</label><input id="reimbursement-count-${index}" class="reimbursement-count" type="number" min="1" max="36" step="1" value="${Number(plan.count || 4)}"></div><div class="field full"><button class="button small" type="button" data-action="generate-reimbursement-items">Dividir em parcelas iguais</button><small>Confira os vencimentos combinados com cada família.</small></div></div><div class="reimbursement-rows table-scroll">${reimbursementRows(plan.items || [], plan.from_family_id)}</div><div class="reimbursement-check allocation-total" aria-live="polite"></div><label class="checkbox-label"><input class="reimbursement-confirmed" type="checkbox" ${plan.confirmed ? 'checked' : ''}><span>Confirmei os valores e todos os vencimentos deste reembolso.<br><small>Deixe desmarcado enquanto houver datas a definir.</small></span></label></div></fieldset>`).join('') : '<p class="review-source">Selecione quem receberá e gere os planos a partir do rateio.</p>';
    updateReimbursementTotals();
  }
  function equalInstallmentItems(total, count, previous = []) {
    return Array.from({ length: count }, (_, index) => ({ number: index + 1, amount_cents: Math.floor(total / count) + (index < total % count ? 1 : 0), due_on: previous[index]?.due_on || null, due_month: previous[index]?.due_month || previous[index]?.due_on?.slice(0,7) || null }));
  }
  function reimbursementDueDate(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) return null;
    const calculate = window.jp27Cashflow?.reimbursementDue;
    const businessDay = Number(state.data?.planning_rule?.reimbursement_business_day || 5);
    return typeof calculate === 'function' ? calculate(month,businessDay) || null : null;
  }
  function reimbursementMonthsForPurchase() {
    const form = $('#expense-form');
    const cardEnabled = $('#installment-enabled')?.checked && !['on_site','pay_at_property'].includes($('#expense-payment-status')?.value);
    if (cardEnabled) {
      const rows = $$('.installment-row',form);
      if (rows.length) return rows.map(row => $('.installment-due',row).value?.slice(0,7) || $('.installment-month',row).value || null);
      const count = Number($('#installment-count')?.value || 1);
      return Array.from({length:Number.isInteger(count) && count > 0 && count <= 36 ? count : 1},() => null);
    }
    return [$('#expense-due')?.value?.slice(0,7) || null];
  }
  function generateReimbursementPlans() {
    const receiver = $('#reimbursement-receiver').value;
    if (!receiver) return formError('Escolha a família que receberá os reembolsos.');
    const previous = readReimbursementDrafts();
    const months = reimbursementMonthsForPurchase(), count = months.length;
    const plans = $$('.allocation-input', $('#expense-form')).filter(input => input.dataset.family !== receiver && parseMoney(input.value) > 0).map(input => {
      const existing = previous.find(plan => plan.from_family_id === input.dataset.family && plan.to_family_id === receiver);
      const total = parseMoney(input.value);
      return existing || { from_family_id: input.dataset.family, to_family_id: receiver, count, total_cents: total, items: equalInstallmentItems(total,count).map((item,index) => ({ ...item,due_month:months[index],due_on:reimbursementDueDate(months[index]) })), confirmed: false };
    });
    renderReimbursementPlanCards(plans);
  }
  function generateReimbursementItems(card) {
    const count = Number($('.reimbursement-count', card).value), total = parseMoney($('.reimbursement-total', card).value);
    if (!Number.isInteger(count) || count < 1 || count > 36 || !Number.isSafeInteger(total) || total < count) return formError('Informe um total válido e de 1 a 36 parcelas, com ao menos R$ 0,01 em cada.');
    const previous = $$('.reimbursement-item',card).map(row => ({ due_on: $('.reimbursement-due',row).value || null, due_month: $('.reimbursement-month',row).value || null }));
    $('.reimbursement-rows', card).innerHTML = reimbursementRows(equalInstallmentItems(total, count, previous), card.dataset.from);
    $('.reimbursement-confirmed', card).checked = false;
    updateReimbursementTotals();
  }
  function updateReimbursementTotals() {
    if (!$('#expense-form')) return;
    $$('.reimbursement-plan-card', $('#expense-form')).forEach(card => {
      const total = parseMoney($('.reimbursement-total', card).value);
      const sum = $$('.reimbursement-amount', card).reduce((sum, input) => sum + (parseMoney(input.value) || 0), 0);
      const allocation = parseMoney($$('.allocation-input', $('#expense-form')).find(input => input.dataset.family === card.dataset.from)?.value);
      const valid = sum === total && total > 0 && total <= allocation;
      $('.reimbursement-check', card).innerHTML = `<span>Parcelas: <strong>${money(sum)}</strong> · Parte da família: ${money(allocation)}</span><span class="${valid ? 'positive' : 'negative'}">${valid ? '✓ Valores conferem' : total > allocation ? 'O reembolso supera a parte desta família' : 'Revise o total e as parcelas'}</span>`;
    });
  }
  function collectReimbursementPlans(allocations) {
    if (!$('#reimbursement-enabled').checked) return [];
    const plans = readReimbursementDrafts().filter(plan => plan.included);
    if (!plans.length) throw new Error('Gere ao menos um plano de reembolso por família ou desmarque o reembolso parcelado.');
    const familyIds = new Set(families().map(family => String(family.id)));
    const usedFamilies = new Set();
    plans.forEach(plan => {
      const label = familyName(plan.from_family_id);
      const allocation = allocations.find(item => String(item.family_id) === plan.from_family_id)?.amount_cents || 0;
      if (!familyIds.has(plan.from_family_id) || !familyIds.has(plan.to_family_id) || plan.from_family_id === plan.to_family_id || usedFamilies.has(plan.from_family_id)) throw new Error('Cada família deve ter um único plano nesta despesa, para outra família.');
      usedFamilies.add(plan.from_family_id);
      if (!Number.isSafeInteger(plan.total_cents) || plan.total_cents <= 0 || plan.total_cents > allocation) throw new Error(`O reembolso de ${label} precisa ser maior que zero e não pode superar sua parte no rateio.`);
      if (!Number.isInteger(plan.count) || plan.count < 1 || plan.count > 36 || plan.items.length !== plan.count) throw new Error(`Gere as parcelas de ${label} com a quantidade informada.`);
      if (plan.items.some(item => !Number.isSafeInteger(item.amount_cents) || item.amount_cents <= 0) || plan.items.reduce((sum,item) => sum + item.amount_cents, 0) !== plan.total_cents) throw new Error(`As parcelas de ${label} precisam fechar com o total do seu reembolso.`);
      if (plan.confirmed && plan.items.some(item => !item.due_on && !item.due_month)) throw new Error(`Informe todos os vencimentos de ${label} ou deixe o plano a definir.`);
      delete plan.included;
    });
    return plans;
  }
  function reimbursementDetail(plans,expenseId) {
    if (!plans?.length) return '';
    return `<div class="detail-section"><h3>Reembolsos parcelados por família</h3><p class="review-source">Cronograma conforme as parcelas da compra; você pode ajustar. Os reembolsos já enviados abatem o saldo do comprador.</p>${plans.map(plan => `<div class="reimbursement-detail"><div class="detail-row"><strong>${esc(familyName(plan.from_family_id))} → ${esc(familyName(plan.to_family_id))}</strong>${tag(`${Number(plan.count)}x`)}</div><div class="detail-row"><span>Total previsto de reembolso</span><strong class="amount">${money(plan.total_cents)}</strong></div>${reimbursementProgressDetail(plan,expenseId)}<div class="table-scroll"><table><thead><tr><th>Parcela</th><th>Valor</th><th>Vencimento</th></tr></thead><tbody>${(plan.items || []).map(item => `<tr><td>${Number(item.number)}/${Number(plan.count)}</td><td class="amount">${money(item.amount_cents)}</td><td>${dueLabel(item)}</td></tr>`).join('')}</tbody></table></div><div class="status-line">${tag(plan.confirmed ? 'Calendário confirmado' : 'Valores propostos; conciliar pagamentos anteriores', plan.confirmed ? '' : 'amber')}</div></div>`).join('')}<div class="panel-note">Registre as transferências realizadas em Pagamentos para atualizar os saldos.</div></div>`;
  }
  function reimbursementProgressDetail(plan,expenseId) {
    const progress = (state.data.reimbursement_plan_totals || []).find(item => item.expense_id === expenseId && item.from_family_id === plan.from_family_id && item.to_family_id === plan.to_family_id);
    if (!progress) return '';
    return `<div class="detail-row"><span>Reembolsos já registrados</span><strong class="amount">${money(progress.covered_by_transfers_cents)}</strong></div><div class="detail-row"><span>Saldo deste plano</span><strong class="amount">${money(progress.remaining_cents)}</strong></div><p class="form-help">Pagamentos já enviados ao comprador abatem o total, sem redefinir a origem do comprovante. A distribuição entre parcelas é provisória.</p>`;
  }
  function renderReimbursementInstallments() {
    const all = (state.data.reimbursement_installments || []).filter(item => item.amount_cents > 0);
    if (!all.length) return '';
    const compact = state.page === 'overview';
    const sorted = [...all].sort((a,b) => (a.due_on || '9999').localeCompare(b.due_on || '9999') || String(a.from_family_id).localeCompare(String(b.from_family_id)) || Number(a.number) - Number(b.number));
    const items = compact ? sorted.slice(0,8) : sorted;
    return `<section class="panel section-space"><div class="section-heading"><div><h2>Reembolsos futuros combinados</h2><p>Calendário entre famílias. Consulte as transferências registradas para conferir o que já foi realizado.</p></div>${tag(all.length + ' parcelas')}</div>${all.some(item => !item.confirmed) ? '<div class="notice"><div class="notice-text"><strong>Valores propostos; conciliar pagamentos anteriores.</strong><br>Os reembolsos já registrados foram abatidos. A distribuição desse abatimento entre as parcelas é provisória; falta definir os vencimentos e conciliar as parcelas.</div></div>' : ''}<div class="table-scroll"><table><thead><tr><th>Despesa / parcela</th><th>Quem reembolsa → quem recebe</th><th>Vencimento</th><th class="text-right">Valor</th><th>Calendário</th></tr></thead><tbody>${items.map(item => `<tr><td><button class="table-title" data-action="expense-detail" data-id="${esc(item.expense_id)}">${esc(item.title || 'Reembolso da despesa')}</button><span class="cell-meta">${Number(item.number)}/${Number(item.count)} · ${Number(item.count)}x</span></td><td>${esc(item.from_name || familyName(item.from_family_id))} → ${esc(item.to_name || familyName(item.to_family_id))}</td><td class="nowrap">${dueLabel(item)}</td><td class="text-right amount">${money(item.amount_cents)}</td><td>${tag(item.confirmed ? 'Confirmado' : 'A conferir', item.confirmed ? '' : 'amber')}</td></tr>`).join('')}</tbody></table></div>${compact && all.length > items.length ? '<div class="panel-note"><button class="text-link" data-page="transfers">Ver todas as parcelas de reembolso →</button></div>' : ''}<div class="panel-note">Registre cada transferência realizada em Pagamentos. Consulte os comprovantes para conferir os valores.</div></section>`;
  }
  function renderInstallmentRows(items) {
    $('#installment-rows').innerHTML = '<table><thead><tr><th>Parcela</th><th>Valor (R$)</th><th>Vencimento</th><th>Situação automática</th></tr></thead><tbody>' + items.map((item,index) => {
      return '<tr class="installment-row" data-number="' + (index + 1) + '"><td>' + (index + 1) + '/' + items.length + '</td><td><input class="installment-amount" aria-label="Valor da parcela ' + (index + 1) + '" inputmode="decimal" value="' + amountInput(item.amount_cents) + '"></td><td><input class="installment-month" aria-label="Mês da parcela ' + (index + 1) + '" type="month" value="' + esc(item.due_month || item.due_on?.slice(0,7) || '') + '"><input class="installment-due" aria-label="Vencimento da parcela ' + (index + 1) + '" type="date" value="' + esc(item.due_on || '') + '"></td><td class="installment-auto-status">' + esc(cardDueStatus(item)) + '</td></tr>';
    }).join('') + '</tbody></table>';
    updateInstallmentTotal();
  }
  function generateInstallments() {
    const count = Number($('#installment-count').value);
    const total = parseMoney($('#expense-total').value);
    if (!Number.isInteger(count) || count < 1 || count > 36 || !Number.isFinite(total) || total <= 0) return formError('Informe o valor da despesa e de 1 a 36 parcelas.');
    const previous = $$('.installment-row').map(row => ({due_on:$('.installment-due',row).value,due_month:$('.installment-month',row).value}));
    renderInstallmentRows(Array.from({length:count},(_,i) => ({number:i+1,amount_cents:Math.floor(total/count)+(i<total%count?1:0),due_on:previous[i]?.due_on || null,due_month:previous[i]?.due_month || null})));
  }
  function updateInstallmentTotal() {
    if (!$('#installment-total')) return;
    const values = $$('.installment-amount', $('#modal')).map(input => parseMoney(input.value));
    const total = parseMoney($('#expense-total').value);
    const sum = values.reduce((a,b) => a + (Number.isFinite(b) ? b : 0),0);
    $('#installment-total').innerHTML = '<span>Total das parcelas: <strong>' + money(sum) + '</strong></span><span class="' + (sum===total?'positive':'negative') + '">' + (sum===total?'✓ Total confere':'Diferença: '+money(total-sum)) + '</span>';
  }
  function cardComponentsDetail(expense) {
    const components = expense.source?.card_components || [];
    if (!compositeCardExpense(expense) || !components.length) return '';
    return `<div class="detail-section"><h3>Composição da compra</h3><div class="table-scroll"><table><thead><tr><th>Compra / crédito</th><th>Cobrança</th><th class="text-right">Valor</th></tr></thead><tbody>${components.map(component => {
      const refund = component.kind === 'refund', count = Number(component.installment_count || component.count || 1);
      const month = component.due_month || component.due_on?.slice(0,7);
      return `<tr><td>${esc(component.title || (refund ? 'Crédito recebido' : 'Compra'))}</td><td>${refund ? 'Crédito na fatura' : count > 1 ? `${count}x` : '1x'}${month ? ' · '+esc(monthLabel(month)) : ''}</td><td class="text-right amount">${refund ? '− ' : ''}${money(Math.abs(Number(component.amount_cents || 0)))}</td></tr>`;
    }).join('')}</tbody><tfoot><tr><th colspan="2">Custo líquido</th><th class="text-right amount">${money(expense.total_cents)}</th></tr></tfoot></table></div></div>`;
  }
  function installmentDetail(plan,expense = null) {
    if (!plan) return '';
    const composite = compositeCardExpense(expense);
    const labels={card:composite ? 'Vencimentos por fatura' : 'Fatura do cartão',family_reimbursement:'Reembolso entre famílias',to_confirm:'Tipo a confirmar'};
    return '<div class="detail-section"><h3>' + (composite ? 'Vencimentos no cartão' : 'Parcelamento · ' + Number(plan.count) + 'x') + '</h3><p class="review-source">' + esc(labels[plan.kind] || 'A confirmar') + ' · ' + esc(plan.payer_family_id ? familyName(plan.payer_family_id) : 'Titular a confirmar') + ' · ' + (plan.confirmed?'Vencimentos confirmados':'Vencimentos a conferir') + '</p><div class="table-scroll"><table><thead><tr><th>' + (composite ? 'Fatura/mês' : 'Parcela') + '</th><th>Valor</th><th>Vencimento</th><th>Situação automática</th></tr></thead><tbody>' + (plan.items || []).map(item => '<tr><td>' + (composite ? item.due_month || item.due_on ? monthLabel(item.due_month || item.due_on?.slice(0,7)) : 'Fatura ' + Number(item.number) : Number(item.number) + '/' + Number(plan.count)) + '</td><td class="amount">' + money(item.amount_cents) + '</td><td>' + (dueLabel(item)) + '</td><td>' + (cardDueStatus(item)) + '</td></tr>').join('') + '</tbody></table></div><div class="panel-note">Consideramos cada parcela paga pelo responsável no vencimento. Registre as transferências entre famílias em Pagamentos.</div></div>';
  }
  function renderCardInstallments() {
    const all = state.data.card_installments || [];
    if (!all.length) return '';
    const items = [...all].filter(item => cardDueStatus(item) !== 'Vencida: considerada paga pelo responsável').sort((a,b) => (a.due_on || '9999').localeCompare(b.due_on || '9999')).slice(0,8);
    return '<section class="panel section-space"><div class="section-heading"><div><h2>Parcelas da compra no cartão</h2><p>Calendário da fatura, separado dos reembolsos entre famílias e dos pagamentos aos fornecedores.</p></div>' + tag(all.length + ' parcelas') + '</div>' + (items.length ? '<div class="table-scroll"><table><thead><tr><th>Despesa / parcela</th><th>Responsável</th><th>Vencimento</th><th class="text-right">Valor</th><th>Situação</th></tr></thead><tbody>' + items.map(item => '<tr><td>' + esc(item.title || item.expense_title || 'Despesa parcelada') + '<span class="cell-meta">' + Number(item.number || 1) + '/' + Number(item.count || 1) + ' · ' + esc(item.kind === 'card' ? 'Fatura do cartão' : item.kind === 'family_reimbursement' ? 'Reembolso entre famílias' : 'Tipo a confirmar') + '</span></td><td>' + esc(item.payer_family_id ? familyName(item.payer_family_id) : 'A confirmar') + '</td><td class="nowrap">' + (dueLabel(item)) + '</td><td class="text-right amount">' + money(item.amount_cents) + '</td><td>' + tag(cardDueStatus(item)) + '</td></tr>').join('') + '</tbody></table></div>' : empty('Parcelas quitadas ou sem saldo futuro','Os registros de quitação permanecem nos detalhes das despesas.')) + '<div class="panel-note">Confira os vencimentos em branco. Cada parcela compõe o valor da compra.</div></section>';
  }
  function syncPricing() {
    if (!$('#expense-form')) return;
    const previous = parseMoney($('#expense-total').value);
    const final = $('#pricing-final').checked;
    $('#card-pricing-fields').hidden = !final;
    $('#card-principal').required = final;
    $('#card-iof').required = final;
    $('#card-other').required = final;
    const estimate = parseMoney($('#expense-estimate').value);
    const principal = parseMoney($('#card-principal').value);
    const iof = parseMoney($('#card-iof').value);
    const other = parseMoney($('#card-other').value);
    const adopted = final ? principal + iof + other : estimate;
    $('#expense-total').value = Number.isFinite(adopted) ? amountInput(adopted) : '';
    const previousExpense = (state.data.expenses || []).find(expense => String(expense.id) === String($('#expense-form').dataset.id));
    $('#pricing-explanation').textContent = final ? 'Cobrança convertida + IOF + outras taxas.' : priceEvidence({ ...previousExpense, total_cents: adopted }).documented ? 'O valor documentado será usado no rateio.' : 'A estimativa será usada até a confirmação do custo final.';
    if ($('#expense-form').dataset.splitMode === 'equal') splitEqual(); else {
      const fields = $$('.allocation-input', $('#modal'));
      const weights = fields.map(input => parseMoney(input.value));
      const sum = weights.reduce((a,b) => a + b, 0);
      if (Number.isFinite(adopted) && adopted > 0 && previous > 0 && sum === previous && weights.every(n => Number.isSafeInteger(n) && n >= 0)) {
        const shares = weights.map((weight,index) => ({ index, cents: Math.floor(weight * adopted / sum), remainder: weight * adopted / sum % 1 }));
        const missing = adopted - shares.reduce((a,b) => a + b.cents, 0);
        [...shares].sort((a,b) => b.remainder - a.remainder || a.index - b.index).slice(0,missing).forEach(share => share.cents++);
        shares.forEach(share => { fields[share.index].value = amountInput(share.cents); });
      }
      updateAllocationTotal();
    }
  }
  function splitEqual() {
    const total = parseMoney($('#expense-total')?.value), fields = $$('.allocation-input', $('#modal'));
    if (!fields.length) return;
    const value = Number.isFinite(total) ? total : 0;
    fields.forEach((input, i) => { input.value = amountInput(Math.floor(value / fields.length) + (i < value % fields.length ? 1 : 0)); });
    updateAllocationTotal();
  }
  function updateAllocationTotal() {
    if (!$('#allocation-total')) return;
    const total = parseMoney($('#expense-total').value);
    const values = $$('.allocation-input', $('#modal')).map(i => parseMoney(i.value));
    const sum = values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    const equal = Number.isFinite(total) && sum === total && values.every(Number.isFinite);
    $('#allocation-total').innerHTML = `<span>Soma do rateio: <strong>${money(sum)}</strong></span><span class="${equal ? 'positive' : 'negative'}">${equal ? '✓ Rateio fecha com o total' : Number.isFinite(total) ? `Diferença: ${money(total - sum)}` : 'Informe o valor total'}</span>`;
  }
  function paymentForm(id) {
    if (!editable()) return;
    const expense = (state.data.expenses || []).find(e => String(e.id) === String(id));
    if (!expense) return;
    modal('Registrar pagamento', `<div class="notice blue"><div class="notice-text"><strong>${esc(expense.title)}</strong><br>Total de referência: ${money(expense.total_cents)} · ${expense.verified ? `Em aberto: ${money(expense.pending_cents)}` : 'Pagamento ainda a conciliar'}.<br>Use esta janela para pagamento ao fornecedor ou devolução recebida dele.</div></div><div class="form-grid"><div class="field full"><label for="payment-kind">Tipo de movimentação</label><select id="payment-kind" name="kind"><option value="payment">Pagamento ao fornecedor</option><option value="refund">Devolução do fornecedor</option></select></div><div class="field"><label for="payment-family">Família que pagou ou recebeu a devolução</label><select id="payment-family" name="family_id" required><option value="">Selecionar família</option>${familyOptions()}</select></div><div class="field"><label for="payment-amount">Valor (R$)</label><input id="payment-amount" name="amount" inputmode="decimal" required value="${expense.verified && expense.pending_cents > 0 ? amountInput(expense.pending_cents) : ''}"></div><div class="field"><label for="payment-date">Data da movimentação</label><input id="payment-date" name="paid_on" type="date" required max="${today()}" value="${today()}"></div><div class="field full"><label for="payment-notes">Observação <small>opcional</small></label><textarea id="payment-notes" name="notes" maxlength="5000" placeholder="Ex.: transferência ao hotel ou parcela efetivamente paga. Uma compra no cartão não comprova quitação da fatura."></textarea></div></div>`, { eyebrow: 'PAGAMENTO DA DESPESA', formId: 'payment-form', actions: `${cancelButton}<button class="button primary" type="submit">Salvar pagamento</button>` });
    $('#payment-form').dataset.expense = expense.id;
  }
  function transferForm(defaults = {}) {
    if (!editable()) return;
    const existing = defaults.id ? (state.data.transfers || []).find(transfer => transfer.id === defaults.id) : null;
    const from = existing?.from_id || defaults.from, to = existing?.to_id || defaults.to;
    const amount = existing?.amount_cents || defaults.amount, unknownDate = Boolean(existing && !existing.paid_on);
    modal(existing ? 'Corrigir transferência' : 'Registrar transferência', `<div class="notice blue"><div class="notice-text">${existing ? 'Corrija os dados do pagamento. A alteração ficará no histórico.' : 'Registre o pagamento realizado para ajustar os saldos das famílias.'}</div></div><div class="form-grid"><div class="field"><label for="transfer-from">Quem enviou?</label><select id="transfer-from" name="from_id" required><option value="">Selecionar família</option>${familyOptions(from)}</select></div><div class="field"><label for="transfer-to">Quem recebeu?</label><select id="transfer-to" name="to_id" required><option value="">Selecionar família</option>${familyOptions(to)}</select></div><div class="field"><label for="transfer-amount">Valor transferido (R$)</label><input id="transfer-amount" name="amount" inputmode="decimal" required placeholder="0,00" value="${amount ? amountInput(amount) : ''}"></div><div class="field"><label for="transfer-date">Data da transferência</label><input id="transfer-date" name="paid_on" type="date" ${unknownDate ? 'disabled' : 'required'} max="${today()}" value="${esc(existing ? existing.paid_on || '' : today())}"></div><div class="field full"><label class="checkbox-label"><input id="transfer-date-unknown" type="checkbox" name="date_unknown" ${unknownDate ? 'checked' : ''}><span>Pagamento realizado com data a confirmar</span></label></div><div class="field full"><label for="transfer-notes">Observação <small>opcional</small></label><textarea id="transfer-notes" name="notes" maxlength="5000" placeholder="Ex.: Pix para acerto do saldo entre famílias">${esc(existing?.notes || '')}</textarea></div></div>`, { eyebrow: 'ACERTO ENTRE FAMÍLIAS', formId: 'transfer-form', actions: `${cancelButton}<button class="button primary" type="submit">${existing ? 'Salvar correção' : 'Registrar transferência'}</button>` });
    $('#transfer-form').dataset.id = existing?.id || '';
  }
  function transferFormLegacy(defaults = {}) {
    if (!editable()) return;
    modal('Registrar reembolso', `<div class="notice blue"><div class="notice-text">A família que envia o dinheiro reduz o que deve. A família que recebe reduz o que tem a receber. O custo da viagem continua igual.</div></div><div class="form-grid"><div class="field"><label for="transfer-from">Quem fez o reembolso?</label><select id="transfer-from" name="from_id" required><option value="">Selecionar família</option>${familyOptions(defaults.from)}</select></div><div class="field"><label for="transfer-to">Quem recebeu?</label><select id="transfer-to" name="to_id" required><option value="">Selecionar família</option>${familyOptions(defaults.to)}</select></div><div class="field"><label for="transfer-amount">Valor transferido (R$)</label><input id="transfer-amount" name="amount" inputmode="decimal" required placeholder="0,00" value="${defaults.amount ? amountInput(defaults.amount) : ''}"></div><div class="field"><label for="transfer-date">Data do reembolso</label><input id="transfer-date" name="paid_on" type="date" required max="${today()}" value="${today()}"></div><div class="field full"><label for="transfer-notes">Observação <small>opcional</small></label><textarea id="transfer-notes" name="notes" maxlength="5000" placeholder="Ex.: Pix referente ao acerto das hospedagens"></textarea></div></div>`, { eyebrow: 'ENTRE AS FAMÍLIAS', formId: 'transfer-form', actions: `${cancelButton}<button class="button primary" type="submit">Registrar reembolso</button>` });
  }
  function pricingDetail(expense) {
    const evidence = priceEvidence(expense);
    const pricing = evidence.pricing || expense.pricing || expense.source?.pricing;
    if (!pricing && !evidence.documented) return '';
    const row = (label, amount, missing = 'Não discriminados no documento') => `<div class="detail-row"><span>${label}</span><strong${Number.isSafeInteger(amount) ? ' class="amount"' : ''}>${Number.isSafeInteger(amount) ? money(amount) : missing}</strong></div>`;
    const estimateKnown = Number.isSafeInteger(pricing?.estimate_cents) && pricing.estimate_cents >= 0;
    const composition = pricing?.final_confirmed === true ? row('Cobrança convertida em reais', pricing.card_principal_cents) + row('IOF', pricing.iof_cents) + row('Outras taxas', pricing.other_fees_cents) : evidence.documented ? '<div class="detail-row"><span>Cobrança, IOF e outras taxas</span><strong>Não discriminados no documento</strong></div>' : '';
    return `<div class="detail-section"><h3>Valor da compra</h3>${estimateKnown ? row('Estimativa da reserva', pricing.estimate_cents) : ''}${evidence.documented ? row('Valor documentado', evidence.document_total_cents) : ''}${!evidence.documented || evidence.difference_cents !== 0 ? row('Valor usado no rateio', expense.total_cents, 'A esclarecer') : ''}${evidence.difference_cents ? `<div class="panel-note">Diferença de ${money(Math.abs(evidence.difference_cents))} entre o documento e o rateio preservado da planilha.</div>` : ''}${composition}${evidence.documented && estimateKnown && expense.total_cents !== pricing.estimate_cents ? row('Diferença em relação à estimativa', expense.total_cents - pricing.estimate_cents) : ''}${!evidence.documented ? `<div class="panel-note">${onSiteExpense(expense) ? 'Estimativa em reais. O custo pode mudar com o câmbio e as taxas aplicáveis.' : 'Valor em reais a confirmar com o documento da cobrança.'}</div>` : ''}</div>`;
  }
  function expenseDetail(id) {
    const e = (state.data.expenses || []).find(item => String(item.id) === String(id));
    if (!e) return;
    const status = expenseStatus(e);
    const payments = e.payments || [];
    modal(e.title, `<div class="detail-hero"><div><span class="metric-value amount">${money(e.total_cents)}</span><span class="cell-meta">${esc(e.category || 'Sem categoria')}${e.currency && e.currency !== 'BRL' && e.original_amount ? ` · Referência original: ${esc(e.original_amount)} ${esc(e.currency)}` : ''}</span></div><div>${tag(status.label, status.color)}<div class="status-line">${tag(evidenceLabel(expenseEvidence(e)))}</div></div></div>${Number(e.assumed_due_cents) > 0 ? '<div class="notice blue"><div class="notice-text">Pela regra do grupo, consideramos ' + money(e.assumed_due_cents) + ' pagos pelo responsável nos vencimentos.</div></div>' : ''}<div class="detail-list"><div class="detail-row"><span>Data da compra</span><strong>${date(e.incurred_on)}</strong></div><div class="detail-row"><span>Vencimento</span><strong>${e.due_on ? date(e.due_on) : 'A definir'}</strong></div><div class="detail-row"><span>Pago até agora</span><strong class="amount">${supplierUnknown(e) ? 'Cobrança a esclarecer' : money(e.paid_cents)}</strong></div><div class="detail-row"><span>Ainda falta pagar</span><strong class="amount">${supplierUnknown(e) ? 'Desconhecido' : money(e.pending_cents)}</strong></div><div class="detail-row"><span>Família que assumiu a compra</span><strong>${expensePayerId(e) ? esc(familyName(expensePayerId(e))) : 'A identificar'}</strong></div><div class="detail-row"><span>Origem</span><strong>${esc(sourceLabel(e.source))}</strong></div></div>${cardComponentsDetail(e)}${pricingDetail(e)}<div class="detail-section"><h3>Rateio da despesa</h3>${(e.allocations || []).map(a => `<div class="detail-row"><span>${esc(familyName(a.family_id))}</span><strong class="amount">${money(a.amount_cents)}</strong></div>`).join('') || '<p class="review-source">Rateio ainda não informado.</p>'}</div>${!onSiteExpense(e) && e.installment_plan ? `<details class="audit-details detail-section"><summary>Ver parcelamento e regras</summary>${onSiteExpense(e) ? '' : installmentDetail(e.installment_plan,e)}</details>` : ''}${e.notes ? `<div class="detail-notes">${esc(e.notes)}</div>` : ''}<div class="detail-section"><h3>Pagamentos ao fornecedor e devoluções</h3>${payments.length ? payments.map(p => `<div class="payment-item"><div><strong>${esc(familyName(p.family_id))}</strong><small>${paymentLabel(p)} · ${date(p.paid_on)}</small>${p.notes ? `<small>${esc(p.notes)}</small>` : ''}</div><strong class="amount ${p.kind === 'refund' ? 'negative' : ''}">${p.kind === 'refund' ? '− ' : ''}${money(p.amount_cents)}</strong>${p.voided_at ? tag('Estornado') : editable() && !p.initial_assumption && !p.purchase_entry && p.method !== 'purchase_entry' ? `<button class="text-link negative" data-action="cancel-payment" data-id="${esc(p.id)}">Estornar</button>` : ''}</div>`).join('') : '<p class="review-source">Nenhuma cobrança ou devolução do fornecedor registrada.</p>'}</div>`, { eyebrow: 'DETALHES DA DESPESA', actions: `<button class="button" type="button" data-action="close-modal">Fechar</button>${editable() ? `<button class="button" type="button" data-action="edit-expense" data-id="${esc(e.id)}">Editar</button>` : ''}` });
  }
  function cancelForm(type, id) {
    if (!editable()) return;
    modal('Estornar movimentação', `<div class="notice"><div class="notice-text">O estorno retira o valor dos saldos. Você poderá consultar o registro original e o motivo no histórico.</div></div><div class="field"><label for="cancel-reason">Qual é o motivo do estorno?</label><textarea id="cancel-reason" name="reason" required minlength="5" maxlength="1000" placeholder="Ex.: valor registrado em duplicidade"></textarea></div>`, { eyebrow: type === 'transfer' ? 'REEMBOLSO ENTRE FAMÍLIAS' : 'PAGAMENTO DA DESPESA', formId: 'cancel-form', actions: `${cancelButton}<button class="button danger" type="submit">Confirmar estorno</button>` });
    $('#cancel-form').dataset.type = type; $('#cancel-form').dataset.id = id;
  }
  function passwordForm() {
    if (!window.JP27_CONFIG?.supabaseUrl) return;
    modal('Trocar minha senha', '<div class="form-grid"><div class="field full"><label for="new-password">Nova senha</label><input id="new-password" name="password" type="password" autocomplete="new-password" required minlength="12"><small>Use pelo menos doze caracteres.</small></div><div class="field full"><label for="confirm-password">Repita a nova senha</label><input id="confirm-password" name="confirm" type="password" autocomplete="new-password" required minlength="12"></div></div>', {formId:'password-form',eyebrow:'SEU ACESSO PRIVADO',actions:cancelButton + '<button class="button primary" type="submit">Salvar nova senha</button>'});
  }
  async function logout() {
    try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch (e) { return toast(e.message); }
    state.session = null; state.data = null; state.myFamily = ''; state.filters = { search: '', category: '', status: '', family: '' }; state.reconciliationFamily = ''; state.reconciliationMonth = ''; $('#modal').close(); showGate('login');
  }
  function formError(message) { $('#modal-error').textContent = message; $('#modal-error').hidden = false; $('.modal-body', $('#modal')).scrollTop = 0; }
  async function submitForm(event) {
    const form = event.target;
    if (!['expense-form', 'transfer-form', 'payment-form', 'cancel-form', 'password-form'].includes(form.id)) return;
    event.preventDefault(); if ((!editable() && form.id !== 'password-form') || !form.reportValidity()) return;
    const data = new FormData(form), value = key => String(data.get(key) || '').trim();
    let path, method = 'POST', body;
    try {
      if (form.id === 'password-form') {
        if (String(data.get('password')) !== String(data.get('confirm'))) throw new Error('As duas senhas precisam ser iguais.');
        path='/api/password'; body={password:String(data.get('password'))};
      } else if (form.id === 'expense-form') {
        const total = parseMoney(value('total'));
        const previousExpense = (state.data.expenses || []).find(expense => String(expense.id) === String(form.dataset.id));
        const previousPricing = { ...previousExpense?.source?.pricing, ...previousExpense?.pricing };
        const finalConfirmed = data.get('final_confirmed') === 'on';
        const pricing = { ...previousPricing, estimate_cents: parseMoney(value('estimate')), card_principal_cents: finalConfirmed ? parseMoney(value('card_principal')) : null, iof_cents: finalConfirmed ? parseMoney(value('iof')) : null, other_fees_cents: finalConfirmed ? parseMoney(value('other_fees')) : null, final_confirmed: finalConfirmed };
        if (!Number.isSafeInteger(pricing.estimate_cents) || pricing.estimate_cents <= 0) throw new Error('Informe a estimativa da reserva em reais.');
        if (pricing.final_confirmed && total !== pricing.card_principal_cents + pricing.iof_cents + pricing.other_fees_cents) throw new Error('O valor adotado precisa ser a soma da cobrança, do IOF e das taxas.');
        if (pricing.final_confirmed && [pricing.card_principal_cents, pricing.iof_cents, pricing.other_fees_cents].some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('Revise a cobrança em reais, o IOF e as outras taxas.');
        if (!Number.isSafeInteger(total) || total <= 0) throw new Error('Informe um valor total em reais maior que zero, com até duas casas decimais.');
        const allocations = $$('.allocation-input', form).map(input => ({ family_id: input.dataset.family, amount_cents: parseMoney(input.value) }));
        if (!allocations.length || allocations.some(a => !Number.isSafeInteger(a.amount_cents) || a.amount_cents < 0) || allocations.reduce((a,b) => a + b.amount_cents,0) !== total) throw new Error('A soma das partes de cada família precisa ser igual ao valor total da despesa.');
        const original = value('original_amount');
        if (original && (!Number.isFinite(parseMoney(original)) || parseMoney(original) <= 0)) throw new Error('Informe o valor original usando apenas números e até duas casas decimais.');
        let installment_plan = null;
        if ($('#installment-enabled').checked) {
          const count=Number($('#installment-count').value);
          const items=$$('.installment-row',form).map((row,index)=>({number:index+1,amount_cents:parseMoney($('.installment-amount',row).value),due_on:$('.installment-due',row).value||null,due_month:$('.installment-due',row).value?.slice(0,7)||$('.installment-month',row).value||null}));
          const kind=$('#installment-kind').value, payer_family_id=$('#installment-payer').value||null, confirmed=kind!=='to_confirm' && !!payer_family_id && items.every(item=>item.due_on||item.due_month);
          if (!Number.isInteger(count)||count<1||count>36||items.length!==count) throw new Error('Gere a lista com o número informado de parcelas.');
          if (items.some(item=>!Number.isSafeInteger(item.amount_cents)||item.amount_cents<=0)||items.reduce((sum,item)=>sum+item.amount_cents,0)!==total) throw new Error('A soma das parcelas precisa fechar com o custo da despesa. Gere novamente ou ajuste os valores.');
          if (confirmed && (kind==='to_confirm'||!payer_family_id||items.some(item=>!item.due_on&&!item.due_month))) throw new Error('Para confirmar o parcelamento, informe tipo, responsável e todos os vencimentos.');
          installment_plan={kind,count,payer_family_id,items,confirmed};
        }
        body = { installment_plan, pricing, payment_status: value('payment_status'), declared_payer_family_id: value('declared_payer_family_id') || null, title: value('title'), category: value('category'), total_cents: total, currency: value('currency'), original_amount: original || null, incurred_on: value('incurred_on') || null, due_on: value('due_on') || null, notes: value('notes'), allocations, verified: true, status: value('status') };
        path = form.dataset.id ? `/api/expenses/${encodeURIComponent(form.dataset.id)}` : '/api/expenses';
        method = form.dataset.id ? 'PUT' : 'POST';
        if (form.dataset.id) {
          body.version = Number(form.dataset.version);
          // Retain historical planning metadata unless a changed family share
          // makes it invalid. These plans are no longer part of the interface.
          const previousPlans = (state.data.expenses || []).find(expense => expense.id === form.dataset.id)?.reimbursement_plans || [];
          const compatiblePlans = previousPlans.filter(plan => Number(plan.total_cents) <= (allocations.find(allocation => allocation.family_id === plan.from_family_id)?.amount_cents || 0));
          if (compatiblePlans.length !== previousPlans.length) body.reimbursement_plans = compatiblePlans;
        }
      } else if (form.id === 'cancel-form') {
        path = `/api/${form.dataset.type === 'transfer' ? 'transfers' : 'payments'}/${encodeURIComponent(form.dataset.id)}`;
        method = 'DELETE'; body = { reason: value('reason') };
        if (body.reason.length < 5) throw new Error('Descreva o motivo do estorno com pelo menos cinco caracteres.');
      } else {
        const amount = parseMoney(value('amount'));
        if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Informe um valor maior que zero, com até duas casas decimais.');
        if (value('paid_on') > today()) throw new Error('Informe uma data até hoje para registrar um pagamento realizado.');
        if (form.id === 'transfer-form') {
          if (value('from_id') === value('to_id')) throw new Error('Escolha famílias diferentes para quem enviou e quem recebeu.');
          const date_unknown = data.get('date_unknown') === 'on';
          path = form.dataset.id ? '/api/transfers/' + encodeURIComponent(form.dataset.id) : '/api/transfers';
          method = form.dataset.id ? 'PUT' : 'POST';
          body = { from_id: value('from_id'), to_id: value('to_id'), amount_cents: amount, paid_on: date_unknown ? null : value('paid_on'), date_unknown, notes: value('notes') };
        } else { path = '/api/payments'; body = { expense_id: form.dataset.expense, family_id: value('family_id'), amount_cents: amount, paid_on: value('paid_on'), kind: value('kind'), notes: value('notes') }; }
      }
      const submit = $('button[type="submit"]', form); submit.disabled = true;
      try { await api(path, { method, body: JSON.stringify(body) }); }
      finally { submit.disabled = false; }
      $('#modal').close();
      try { await loadDashboard(); toast(form.id === 'password-form' ? 'Senha alterada.' : form.id === 'cancel-form' ? 'Estorno registrado. O histórico foi preservado.' : 'Registro salvo. Os saldos foram atualizados.'); }
      catch (refreshError) { if (refreshError.status === 401) { state.session = null; showGate('login'); } toast('Registro salvo. Recarregue o painel para consultar os saldos atualizados.'); }
    } catch (error) {
      if (error.status === 401) { $('#modal').close(); state.session = null; showGate('login'); toast('Sua sessão terminou. Entre novamente.'); }
      else formError(error.message);
    }
  }

  document.addEventListener('click', event => {
    if (!event.target.closest('#account-menu')) $('#account-menu')?.removeAttribute('open');
    const target = event.target.closest('[data-action], [data-page]');
    if (!target) return;
    if (target.dataset.page || target.dataset.action) $('#account-menu')?.removeAttribute('open');
    if (target.dataset.page) return setPage(target.dataset.page);
    const action = target.dataset.action, id = target.dataset.id;
    if (action === 'close-modal') $('#modal').close();
    else if (action === 'new-expense') expenseForm();
    else if (action === 'select-reconciliation-month') {
      const railPosition = $('.month-rail')?.scrollLeft || 0;
      state.reconciliationMonth = target.dataset.month; render();
      const rail = $('.month-rail');
      if (rail) { rail.scrollLeft = railPosition; rail.querySelector('[aria-pressed="true"]')?.focus({preventScroll:true}); }
    }
    else if (action === 'edit-expense') expenseForm(id);
    else if (action === 'expense-detail') expenseDetail(id);
    else if (action === 'new-payment') paymentForm(id);
    else if (action === 'new-transfer') transferForm();
    else if (action === 'family-new-transfer') transferForm({ from: myFamilyId() });
    else if (action === 'my-family-purchases') { state.filters = { search:'', category:'', status:'', family:myFamilyId() }; setPage('expenses'); }
    else if (action === 'family-forecast-month') { state.reconciliationFamily = target.dataset.family; state.reconciliationMonth = target.dataset.month; setPage('monthly'); }
    else if (action === 'edit-transfer') transferForm({ id });
    else if (action === 'transfer-detail') transferDetail(id);
    else if (action === 'family-monthly') { state.reconciliationFamily = target.dataset.family; setPage('monthly'); }
    else if (action === 'schedule-card-dates') scheduleCardDates();
    else if (action === 'schedule-card-months') scheduleCardMonths();
    else if (action === 'suggest-transfer') transferForm({ from: target.dataset.from, to: target.dataset.to, amount: Number(target.dataset.amount) });
    else if (action === 'split-equal') splitEqual();
    else if (action === 'generate-installments') generateInstallments();
    else if (action === 'clear-timeline-filters') { state.timelineFilters = {}; render(); }
    else if (action === 'cancel-transfer') cancelForm('transfer', id);
    else if (action === 'cancel-payment') cancelForm('payment', id);
    else if (action === 'logout') logout();
    else if (action === 'change-password') passwordForm();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('#account-menu')?.open) { $('#account-menu').removeAttribute('open'); $('#account-menu > summary')?.focus(); }
  });
  document.addEventListener('submit', submitForm);
  document.addEventListener('input', event => {
    if (event.target.matches('[data-pricing]')) syncPricing();
    if (event.target.matches('.installment-amount')) updateInstallmentTotal();
    if (event.target.id === 'expense-total') { if ($('#expense-form')?.dataset.splitMode === 'equal') splitEqual(); else updateAllocationTotal(); }
    if (event.target.matches('.allocation-input')) { $('#expense-form').dataset.splitMode = 'manual'; updateAllocationTotal(); }
    if (event.target.id === 'filter-search') { state.filters.search = event.target.value; $('#expenses-table').innerHTML = purchaseTable(filteredExpenses()); }
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'my-family-select' && !assignedFamilyId()) { state.myFamily = event.target.value; render(); }
    if (event.target.id === 'reconciliation-month') { state.reconciliationMonth = event.target.value; render(); $('#reconciliation-month')?.focus({preventScroll:true}); }
    if (event.target.id === 'ledger-family') { state.reconciliationFamily = event.target.value; render(); $('#ledger-family')?.focus({preventScroll:true}); }
    if (event.target.id === 'pricing-final') { syncPricing(); updateInstallmentTotal(); }
    if (event.target.id === 'installment-enabled') { $('#installment-settings').hidden = !event.target.checked; if(event.target.checked && !$$('.installment-row').length) generateInstallments(); }
    if (event.target.matches('.installment-due') && event.target.value) { const row = event.target.closest('.installment-row'); $('.installment-month',row).value = event.target.value.slice(0,7); }
    if (event.target.matches('.installment-month')) { const row = event.target.closest('.installment-row'), day = $('.installment-due',row); if (day.value && day.value.slice(0,7) !== event.target.value) day.value = ''; }
    if (event.target.matches('.installment-due, .installment-month')) updateCardDueStatuses();
    if (event.target.id === 'transfer-date-unknown') { $('#transfer-date').disabled = event.target.checked; $('#transfer-date').required = !event.target.checked; }
    const monthlyMapping = { 'monthly-family': 'family', 'monthly-month': 'month' };
    if (monthlyMapping[event.target.id]) { state.monthlyFilters ||= {}; state.monthlyFilters[monthlyMapping[event.target.id]] = event.target.value; render(); }
    const timelineMapping = { 'timeline-family': 'family', 'timeline-expense': 'expense', 'timeline-from': 'from', 'timeline-to': 'to' };
    if (timelineMapping[event.target.id]) { state.timelineFilters ||= {}; state.timelineFilters[timelineMapping[event.target.id]] = event.target.value; $('#timeline-results').innerHTML = state.page === 'timeline' ? renderTimelineResults() : financialEventList(filteredFinancialEvents(state.page === 'upcoming')); }
    const mapping = { 'filter-category': 'category', 'filter-status': 'status', 'filter-family': 'family' };
    if (mapping[event.target.id]) { state.filters[mapping[event.target.id]] = event.target.value; $('#expenses-table').innerHTML = purchaseTable(filteredExpenses()); }
  });
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.target, button = $('button', form); button.disabled = true; $('#login-error').hidden = true;
    try {
      await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('#username').value.trim(), password: $('#password').value }) });
      $('#password').value = ''; state.session = await api('/api/session'); await loadDashboard({ preservePage: false });
    } catch (error) { $('#login-error').textContent = error.message; $('#login-error').hidden = false; $('#password').value = ''; }
    finally { button.disabled = false; }
  });
  $('#logout').addEventListener('click', logout);
  $('#modal').addEventListener('click', event => { if (event.target === $('#modal')) { const r = $('#modal').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('#modal').close(); } });
  init();
})();
