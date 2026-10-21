'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { session: null, data: null, page: 'overview', filters: { search: '', category: '', status: '', family: '' }, toastTimer: null };
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
    if (!e.verified) return { label: 'A conferir', color: 'amber' };
    if (e.pending_cents <= 0) return { label: 'Paga', color: 'green' };
    if (e.due_on && e.due_on < today()) return { label: 'Vencida', color: 'red' };
    if (e.paid_cents > 0) return { label: 'Pagamento parcial', color: 'amber' };
    if (!e.due_on) return { label: 'Sem vencimento', color: '' };
    return { label: 'A vencer', color: '' };
  };
  const paymentLabel = p => p.kind === 'refund' ? 'Devolução do fornecedor' : p.method === 'card_purchase' ? 'Compra no cartão' : 'Pagamento ao fornecedor';

  async function api(path, options = {}) {
    if (window.jp27Cloud && window.JP27_CONFIG?.supabaseUrl) return window.jp27Cloud.request(path, options);
    const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.method && options.method !== 'GET' && state.session?.csrf ? { 'X-CSRF-Token': state.session.csrf } : {}), ...(options.headers || {}) };
    let response;
    try { response = await fetch(path, { ...options, headers, credentials: 'same-origin', cache: 'no-store' }); }
    catch { const error = new Error('Não foi possível conectar ao serviço privado. Verifique sua conexão e tente novamente.'); error.connection = true; throw error; }
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
    const count = Number(state.data.summary?.unverified_count || 0);
    $('#review-count').textContent = count; $('#review-count').hidden = count === 0;
    $('#updated-at').textContent = `Atualizado em ${date(state.data.as_of || new Date().toISOString(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
    if (!preservePage) state.page = 'overview'; render();
  }
  function toast(message) {
    clearTimeout(state.toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
    state.toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000);
  }
  function setPage(page) {
    if (!['overview', 'expenses', 'transfers', 'review', 'history'].includes(page)) return;
    state.page = page; render(); window.scrollTo({ top: 0, behavior: 'instant' });
  }
  const pageHeading = (eyebrow, title, subtitle, actions = '') => `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${subtitle}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
  const newExpenseButton = () => editable() ? '<button class="button primary" data-action="new-expense"><span class="button-icon" aria-hidden="true">＋</span> Nova despesa</button>' : '';
  const newTransferButton = () => editable() ? '<button class="button" data-action="new-transfer"><span class="button-icon" aria-hidden="true">⇄</span> Registrar reembolso</button>' : '';
  const empty = (title, message, action = '') => `<div class="empty"><div class="empty-symbol" aria-hidden="true">◌</div><h3>${esc(title)}</h3><p>${esc(message)}</p>${action}</div>`;
  function reviewNotice() {
    const count = Number(state.data.summary?.unverified_count || 0);
    if (!count && !(state.data.review_items || []).length) return '';
    return `<div class="notice"><span aria-hidden="true">ⓘ</span><div class="notice-text"><strong>A conferência ainda está em andamento.</strong><br>${count ? `${count} ${count === 1 ? 'despesa precisa' : 'despesas precisam'} de revisão${state.data.summary?.unverified_cents ? `, somando ${money(state.data.summary.unverified_cents)} em referências` : ''}. ` : ''}Os saldos confirmados podem representar apenas parte da viagem. Veja os registros importados e as dúvidas antes de fazer um acerto.</div><button class="button small" data-page="review">Conferir →</button></div>`;
  }
  function renderOverview() {
    const data = state.data, s = data.summary || {};
    return `${pageHeading('CADA COISA NO SEU LUGAR', 'Contas claras, viagem leve.', 'Quem pagou, quanto cabe a cada família e o que ainda vem pela frente.', newExpenseButton())}
      ${reviewNotice()}
      <div class="metrics"><div class="metric"><div class="metric-label">Compromissos confirmados <span class="metric-symbol" aria-hidden="true">▤</span></div><div class="metric-value amount">${money(s.committed_cents)}</div><span class="metric-caption">Apenas despesas conferidas; veja referências abaixo</span></div><div class="metric"><div class="metric-label">Pago ou lançado no cartão <span class="metric-symbol positive" aria-hidden="true">↗</span></div><div class="metric-value amount">${money(s.paid_cents)}</div><span class="metric-caption">Não indica quitação da fatura</span></div><div class="metric accent"><div class="metric-label">Ainda falta pagar <span class="metric-symbol" aria-hidden="true">◷</span></div><div class="metric-value amount">${money(s.pending_cents)}</div><span class="metric-caption">Somente compromissos conferidos</span></div></div>
      <div class="section-heading"><div><h2>Como está cada família</h2><p>Acerto de agora separado dos compromissos futuros.</p></div>${tag('Somente registros conferidos')}</div>
      <div class="families">${(data.balances || []).map((b, index) => `<article class="family-card"><div class="family-head"><span class="family-avatar" style="background:${['#edf1f4','#f8efea','#edf1e8','#f5eff6'][index % 4]}">${esc(b.name?.slice(0, 1) || 'F')}</span>${esc(b.name)}</div><div class="family-result"><small>Saldo para acerto agora</small><strong class="amount ${b.balance_cents > 0 ? 'positive' : b.balance_cents < 0 ? 'negative' : ''}">${money(Math.abs(b.balance_cents))}</strong><span class="balance-tag ${b.balance_cents > 0 ? 'positive' : b.balance_cents < 0 ? 'negative' : 'subtle'}">${b.balance_cents > 0 ? '↙ A receber' : b.balance_cents < 0 ? '↗ A reembolsar' : state.data.summary?.unverified_count > 0 ? 'Sem saldo confirmado' : '✓ Em dia'}</span></div><div class="family-foot"><span>Sua parte a pagar ao fornecedor</span><strong class="amount">${money(b.future_cents)}</strong></div></article>`).join('')}</div>
      ${!(data.balances || []).length ? `<div class="panel">${empty('As famílias ainda não foram configuradas', 'As posições aparecerão aqui depois da configuração das famílias e da conferência das despesas.')}</div>` : ''}
      <div class="explanation">O saldo considera o que cada família adiantou, sua parte nos pagamentos e os reembolsos já feitos. Despesas futuras não entram no acerto de agora.</div>
      ${renderLegacy(true)}
      <div class="overview-lower"><section class="panel"><div class="section-heading"><div><h2>Para acertar as contas</h2><p>Sugestões com base no saldo confirmado de hoje.</p></div><span class="subtle" aria-hidden="true">⇄</span></div>${renderSettlements()}<div class="panel-note">Registrar um reembolso muda apenas o saldo entre famílias. Não cria uma nova despesa nem paga o hotel novamente.</div></section><section class="panel"><div class="section-heading"><div><h2>Próximos pagamentos</h2><p>Compromissos que ainda precisam ser pagos.</p></div><button class="text-link" data-page="expenses">Ver todos →</button></div>${renderUpcoming()}</section></div>
      ${renderCardInstallments()}<div class="only-mobile section-space">${window.JP27_CONFIG?.supabaseUrl ? '<button class="button small" data-action="change-password">Trocar senha</button>' : ''}<button class="button small" data-action="logout">Sair da conta</button><a class="button small" href="/api/export" download>Exportar registros</a></div>`;
  }
  function renderSettlements() {
    const items = state.data.settlements || [];
    if (!items.length) return empty('Nenhum acerto sugerido', state.data.summary?.unverified_count ? 'Conclua a conferência das despesas e dos pagamentos para obter sugestões confiáveis.' : 'Os registros confirmados não indicam transferências pendentes entre as famílias.');
    return items.map(t => `<div class="settlement"><div><div class="settlement-route"><strong>${esc(t.from || familyName(t.from_id))}</strong><span class="route-arrow" aria-hidden="true">→</span><strong>${esc(t.to || familyName(t.to_id))}</strong></div><span class="settlement-meta">${esc(t.from || familyName(t.from_id))} reembolsa ${esc(t.to || familyName(t.to_id))}</span></div><div class="settlement-right"><strong class="amount">${money(t.amount_cents)}</strong>${editable() ? `<button class="button small" data-action="suggest-transfer" data-from="${esc(t.from_id)}" data-to="${esc(t.to_id)}" data-amount="${Number(t.amount_cents)}">Registrar</button>` : ''}</div></div>`).join('');
  }
  function renderUpcoming() {
    const upcoming = (state.data.expenses || []).filter(e => e.status !== 'cancelled' && e.pending_cents > 0 && e.verified).sort((a, b) => (a.due_on || '9999').localeCompare(b.due_on || '9999')).slice(0, 5);
    if (!upcoming.length) return empty('Sem pagamentos confirmados em aberto', 'Compras e hospedagens a conferir aparecem na aba Conferência.');
    return upcoming.map(e => `<div class="upcoming"><div class="date-tile">${e.due_on ? `<strong>${date(e.due_on, { day: '2-digit' })}</strong><span>${date(e.due_on, { month: 'short' }).replace('.', '')}</span>` : '<strong>—</strong><span>sem data</span>'}</div><div class="upcoming-title"><button class="table-title" data-action="expense-detail" data-id="${esc(e.id)}">${esc(e.title)}</button><span>${esc(e.category || 'Sem categoria')} · ${e.due_on && e.due_on < today() ? 'vencido' : e.due_on ? date(e.due_on) : 'definir vencimento'}</span></div><span class="amount">${money(e.pending_cents)}</span></div>`).join('');
  }
  function filteredExpenses({ reviewOnly = false } = {}) {
    const f = state.filters;
    return (state.data.expenses || []).filter(e => {
      if (reviewOnly && e.verified) return false;
      if (f.search && !`${e.title} ${e.notes || ''} ${e.category || ''}`.toLocaleLowerCase('pt-BR').includes(f.search.toLocaleLowerCase('pt-BR'))) return false;
      if (f.category && e.category !== f.category) return false;
      if (f.family && !(e.allocations || []).some(a => String(a.family_id) === f.family)) return false;
      if (f.status === 'review' && e.verified) return false;
      if (f.status === 'paid' && !(e.verified && e.pending_cents <= 0 && e.status !== 'cancelled')) return false;
      if (f.status === 'pending' && !(e.verified && e.pending_cents > 0 && e.status !== 'cancelled')) return false;
      if (f.status === 'overdue' && !(e.verified && e.pending_cents > 0 && e.due_on && e.due_on < today() && e.status !== 'cancelled')) return false;
      if (f.status === 'cancelled' && e.status !== 'cancelled') return false;
      return true;
    });
  }
  function expenseFilters() {
    const cats = [...new Set((state.data.expenses || []).map(e => e.category).filter(Boolean))].sort();
    return `<div class="filters"><input aria-label="Buscar despesas" type="search" id="filter-search" placeholder="Buscar despesa, hotel, observação…" value="${esc(state.filters.search)}"><select aria-label="Filtrar categoria" id="filter-category"><option value="">Todas as categorias</option>${cats.map(c => `<option ${state.filters.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select><select aria-label="Filtrar situação" id="filter-status">${[['','Todas as situações'],['review','A conferir'],['pending','Em aberto'],['paid','Pagas'],['overdue','Vencidas'],['cancelled','Canceladas']].map(([v,l]) => `<option value="${v}" ${state.filters.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select><select aria-label="Filtrar família" id="filter-family"><option value="">Todas as famílias</option>${familyOptions(state.filters.family)}</select></div>`;
  }
  function renderExpenses() {
    const items = filteredExpenses();
    return `${pageHeading('DA COMPRA AO PAGAMENTO', 'Despesas da viagem', 'Cada compra é registrada uma vez. Os pagamentos e o rateio ficam ligados a ela.', newExpenseButton())}${expenseFilters()}<div id="expenses-table">${expenseTable(items)}</div>`;
  }
  function expenseTable(items) {
    if (!items.length) return `<div class="table-panel">${empty('Nenhuma despesa encontrada', (state.data.expenses || []).length ? 'Tente mudar a busca ou os filtros.' : 'Registre a primeira compra ou revise os dados da planilha antes de começar.', !(state.data.expenses || []).length ? newExpenseButton() : '')}</div>`;
    return `<div class="table-panel"><div class="table-scroll"><table><thead><tr><th>Despesa / compra</th><th>Situação</th><th>Vencimento</th><th class="text-right">Valor total</th><th class="text-right">Já pago</th><th class="text-right">Em aberto</th><th></th></tr></thead><tbody>${items.map(e => { const status = expenseStatus(e); return `<tr><td><button class="table-title" data-action="expense-detail" data-id="${esc(e.id)}">${esc(e.title)}</button><span class="cell-meta">${esc(e.category || 'Sem categoria')} · ${e.incurred_on ? `Compra em ${date(e.incurred_on)}` : 'Data da compra a confirmar'}</span>${e.source ? `<span class="cell-meta">${esc(sourceLabel(e.source))}</span>` : ''}</td><td>${tag(status.label, status.color)}</td><td class="nowrap ${e.due_on && e.due_on < today() && e.pending_cents > 0 && e.verified ? 'negative' : ''}">${e.due_on ? date(e.due_on) : '<span class="subtle">A definir</span>'}</td><td class="text-right amount">${money(e.total_cents)}<span class="cell-meta">${e.pricing?.final_confirmed ? 'Custo efetivo' : 'Estimativa / referência'}</span></td><td class="text-right amount">${e.verified ? money(e.paid_cents) : '<span class="subtle">A conciliar</span>'}</td><td class="text-right amount">${e.verified ? money(e.pending_cents) : '<span class="subtle">Em conferência</span>'}</td><td>${editable() && e.status !== 'cancelled' ? `<button class="button small" data-action="new-payment" data-id="${esc(e.id)}">Pagamento</button>` : `<button class="text-link" data-action="expense-detail" data-id="${esc(e.id)}">Detalhes</button>`}</td></tr>`; }).join('')}</tbody></table></div><div class="table-footer">${items.length} ${items.length === 1 ? 'despesa' : 'despesas'} · Registros a conferir não entram nos saldos confirmados.</div></div>`;
  }
  function renderTransfers() {
    const transfers = [...(state.data.transfers || [])].sort((a, b) => (b.paid_on || '').localeCompare(a.paid_on || ''));
    return `${pageHeading('SEM DUPLICAR DESPESAS', 'Reembolsos entre famílias', 'Registre uma transferência uma única vez. Os dois saldos são atualizados automaticamente.', newTransferButton())}<section class="panel"><div class="section-heading"><div><h2>Acertos sugeridos</h2><p>O cálculo usa os pagamentos e rateios confirmados.</p></div></div>${renderSettlements()}</section><div class="section-heading section-space"><div><h2>Reembolsos registrados</h2><p>Quem transferiu, quem recebeu, quanto e quando.</p></div></div><div class="table-panel">${transfers.length ? `<div class="table-scroll"><table><thead><tr><th>Data</th><th>Quem reembolsou</th><th>Quem recebeu</th><th class="text-right">Valor</th><th>Observação</th>${editable() ? '<th></th>' : ''}</tr></thead><tbody>${transfers.map(t => `<tr><td class="nowrap">${date(t.paid_on)}</td><td>${esc(familyName(t.from_id))}</td><td>${esc(familyName(t.to_id))}</td><td class="text-right amount">${money(t.amount_cents)}</td><td><span class="cell-meta">${esc(t.notes || '—')}</span></td>${editable() ? `<td>${t.voided_at ? tag('Estornado') : `<button class="text-link negative" data-action="cancel-transfer" data-id="${esc(t.id)}">Estornar</button>`}</td>` : ''}</tr>`).join('')}</tbody></table></div><div class="table-footer">Um reembolso entre famílias não altera o custo total da viagem.</div>` : empty('Nenhum reembolso registrado', 'Quando uma família transferir para outra, registre aqui a data e o valor.', newTransferButton() + documentReviewLink())}</div>`;
  }
  function renderLegacy(compact = false) {
    const legacy = state.data.legacy;
    if (!legacy) return '';
    const list = legacy.balances || [];
    return `<section class="panel ${compact ? 'section-space' : ''}" style="margin-bottom:24px"><div class="section-heading"><div><span class="eyebrow amber" style="font-size:8px;margin-bottom:8px">REFERÊNCIA IMPORTADA PROVISÓRIA</span><h2>${esc(legacy.label || 'Saldos da planilha anterior')}</h2><p>${legacy.as_of ? `Referência de ${date(legacy.as_of)}. ` : ''}Valores herdados das fórmulas; precisam ser conciliados com os comprovantes.</p></div>${tag('Não é o acerto confirmado', 'amber')}</div>${list.length ? `<div class="table-scroll"><table><thead><tr><th>Família</th><th class="text-right">Saldo da referência</th><th>Interpretação provisória</th></tr></thead><tbody>${list.map(b => `<tr><td>${esc(b.name || familyName(b.family_id))}</td><td class="text-right amount">${money(b.balance_cents)}</td><td><span class="subtle">${b.balance_cents > 0 ? 'A receber' : b.balance_cents < 0 ? 'A reembolsar' : 'Em dia'} · a confirmar</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="review-source">Não há saldos legados disponíveis.</p>'}${(legacy.warnings || []).map(w => `<div class="panel-note">${esc(typeof w === 'string' ? w : w.detail || w.message)}</div>`).join('')}${compact ? '<div class="panel-note">Não some esta referência aos saldos confirmados acima. Ela preserva a leitura anterior enquanto os lançamentos são reconstruídos.</div>' : ''}</section>`;
  }
  function receiptLink(id, label = 'Abrir comprovante') {
    return id ? '<a class="text-link" href="/api/receipts/' + encodeURIComponent(id) + '" target="_blank" rel="noopener">' + esc(label) + '</a>' : '<span class="subtle">Sem documento vinculado</span>';
  }
  function renderDocumentTransfers() {
    const items = [...(state.data.legacy?.receipt_transfers || [])].sort((a,b) => (b.paid_on || '').localeCompare(a.paid_on || ''));
    if (!items.length) return '';
    return '<section class="section-space"><div class="section-heading"><div><h2>Reembolsos encontrados nos documentos</h2><p>Histórico documental a conciliar com as fórmulas da planilha.</p></div>' + tag(items.length + ' registros', 'amber') + '</div><div class="table-panel"><div class="table-scroll"><table><thead><tr><th>Data / horário</th><th>Remetente</th><th>Destinatário</th><th class="text-right">Valor</th><th>Conferência</th><th>Prova e observação</th></tr></thead><tbody>' + items.map(item => '<tr><td class="nowrap">' + date(item.paid_on) + (item.time ? '<span class="cell-meta">' + esc(item.time) + '</span>' : '') + '</td><td>' + esc(item.from_name || familyName(item.from_id)) + '</td><td>' + esc(item.to_name || (item.recipient_confirmed ? familyName(item.to_id) : 'Destinatário a confirmar')) + (!item.recipient_confirmed ? '<span class="cell-meta amber">Identidade do destinatário não comprovada</span>' : '') + '</td><td class="text-right amount">' + money(item.amount_cents) + '</td><td>' + tag(item.document_verified ? 'Comprovante conferido' : 'Conferência parcial', item.document_verified ? 'green' : 'amber') + '<div class="cell-tags">' + tag(item.recipient_confirmed ? 'Destinatário confirmado' : 'Destinatário a confirmar', item.recipient_confirmed ? '' : 'amber') + '</div></td><td>' + receiptLink(item.receipt_id) + (item.note ? '<span class="cell-meta">' + esc(item.note) + '</span>' : '') + '</td></tr>').join('') + '</tbody></table></div><div class="table-footer">Esta seção é documental e não altera os saldos. Os valores podem já estar embutidos nas fórmulas antigas; a conciliação evita contar o mesmo reembolso duas vezes.</div></div></section>';
  }
  function renderDocumentInstallments() {
    const items = state.data.credit_card_schedule || [];
    if (!items.length) return '';
    return '<section class="section-space"><div class="section-heading"><div><h2>Parcelas identificadas na fatura</h2><p>Somente os lançamentos visíveis no documento, sem reconstruir parcelas anteriores ou futuras.</p></div>' + tag(items.length + ' lançamentos', 'amber') + '</div><div class="table-panel"><div class="table-scroll"><table><thead><tr><th>Descritor / reserva</th><th>Titular</th><th>Parcela</th><th class="text-right">Valor da parcela</th><th>Data original de referência</th><th>Vencimento / quitação</th><th>Prova</th></tr></thead><tbody>' + items.map(item => {
      const expense = (state.data.expenses || []).find(e => String(e.id) === String(item.expense_id || item.expense_id_proposal));
      return '<tr><td><strong>' + esc(item.merchant || 'Lançamento da fatura') + '</strong>' + (expense ? '<span class="cell-meta"><button class="text-link" data-action="expense-detail" data-id="' + esc(expense.id) + '">' + esc(expense.title) + '</button></span>' : '') + '<div class="cell-tags">' + tag(item.mapping_confirmed ? 'Reserva vinculada' : 'Vínculo a confirmar', item.mapping_confirmed ? '' : 'amber') + '</div>' + (item.note ? '<span class="cell-meta">' + esc(item.note) + '</span>' : '') + '</td><td>' + esc(item.holder_family_id ? familyName(item.holder_family_id) : 'A confirmar') + '</td><td class="nowrap">' + (item.number ? Number(item.number) : '—') + ' / ' + (item.total ? Number(item.total) : '—') + '</td><td class="text-right amount">' + money(item.installment_amount_cents) + '</td><td class="nowrap">' + (item.purchase_date_reference ? date(item.purchase_date_reference) : 'Não informada') + '<span class="cell-meta">Referência de compra</span></td><td>' + (item.due_on ? date(item.due_on) : '<span class="amber">Vencimento não confirmado</span>') + '<span class="cell-meta">Quitação não comprovada</span></td><td>' + receiptLink(item.receipt_id, 'Ver fatura') + (item.reservation_receipt_id ? '<div class="cell-meta">' + receiptLink(item.reservation_receipt_id, 'Ver reserva') + '</div>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div><div class="table-footer">Fatura em aberto não comprova pagamento. Estes lançamentos não são somados novamente à despesa nem confirmam o calendário de vencimentos.</div></div></section>';
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
      <div class="notice blue"><span aria-hidden="true">ⓘ</span><div class="notice-text">Valores importados ficam fora dos saldos confirmados até a revisão. Confira o total em reais, o rateio, quem pagou e as datas. Um comprovante de compra no cartão não comprova que a fatura foi quitada.</div></div>
      <div class="review-grid"><section class="panel"><div class="section-heading"><div><h2>O que precisa ser resolvido</h2><p>${checks.length} ${checks.length === 1 ? 'ponto' : 'pontos'} de conciliação</p></div>${tag('Revisão', 'amber')}</div>${checks.length ? checks.map(item => `<div class="check-row"><span class="check-icon warn" aria-hidden="true">◷</span><div><strong>${esc(item.title)}</strong><p>${esc(item.detail || item.description || '')}</p></div></div>`).join('') : empty('Nenhuma dúvida registrada', 'Novas dúvidas de conciliação podem ser registradas nas observações de cada despesa.')} ${warnings.map(w => `<div class="panel-note">${esc(typeof w === 'string' ? w : w.detail || w.message)}</div>`).join('')}</section><section class="panel"><div class="section-heading"><div><h2>Comprovantes disponíveis</h2><p>Documentos protegidos pelo mesmo acesso do painel.</p></div></div>${receipts.length ? receipts.map(r => `<div class="check-row"><span class="check-icon" aria-hidden="true">▤</span><div><a href="/api/receipts/${encodeURIComponent(r.id)}" target="_blank" rel="noopener">${esc(r.label || r.filename || 'Abrir comprovante')}</a><p>${esc(r.filename || '')}</p></div></div>`).join('') : empty('Nenhum comprovante disponível', 'Os documentos vinculados serão exibidos aqui quando estiverem disponíveis no serviço privado.')}</section></div>
      ${renderLegacy()}
      ${renderDocumentTransfers()}
      ${renderDocumentInstallments()}
      <div class="section-heading section-space"><div><h2>Despesas que aguardam conferência</h2><p>Abra cada registro, revise o rateio e confirme os dados com a documentação.</p></div><span class="tag amber">${unverified.length} pendentes</span></div>${expenseTable(unverified)}
      <section class="panel section-space"><div class="section-heading"><div><h2>Como o saldo é calculado</h2><p>O mesmo lançamento alimenta os dois lados do encontro de contas.</p></div></div><div class="reconcile-lines"><div><span>Pagamentos adiantados pela família</span><span>Somam ao saldo</span></div><div><span>Parte da família nas despesas já pagas</span><span>Subtrai do saldo</span></div><div><span>Reembolsos que a família enviou</span><span>Somam ao saldo</span></div><div><span>Reembolsos que a família recebeu</span><span>Subtraem do saldo</span></div><div><span>Saldo positivo: a receber · negativo: a reembolsar</span><span>Saldo do grupo = R$ 0,00</span></div></div><div class="panel-note">A parte da família nas contas ainda não pagas aparece como compromisso futuro. Parcelas do cartão pertencem ao fluxo da fatura e não criam uma nova despesa de viagem.</div></section>`;
  }
  function renderHistory() {
    const items = [...(state.data.audit || [])].sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    return `${pageHeading('CADA ALTERAÇÃO TEM UMA HISTÓRIA', 'Histórico compartilhado', 'Quem registrou, o que mudou e quando. Estornos preservam o registro da movimentação anterior.')}<div class="table-panel">${items.length ? `<div class="audit-list">${items.map(item => `<article class="audit-item"><div class="audit-date"><strong>${date(item.at, { day: '2-digit', month: 'short', year: 'numeric' })}</strong>${date(item.at, { hour: '2-digit', minute: '2-digit' })}</div><div><div class="audit-description">${esc(item.description || item.action)}</div><div class="audit-actor">Por ${esc(item.actor || 'Sistema')} · ${esc(item.action || '')}</div></div></article>`).join('')}</div>` : empty('O histórico começa aqui', 'As alterações feitas pelas famílias aparecerão nesta página.')}</div>`;
  }
  function render() {
    $$('#navigation [data-page]').forEach(button => { const selected = button.dataset.page === state.page; button.classList.toggle('active', selected); if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    const views = { overview: renderOverview, expenses: renderExpenses, transfers: renderTransfers, review: renderReview, history: renderHistory };
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
    modal(e ? 'Editar despesa' : 'Nova despesa', `<div class="form-grid"><div class="field full"><label for="expense-title">O que foi comprado ou reservado?</label><input id="expense-title" name="title" placeholder="Ex.: hospedagem em Tokyo" required maxlength="200" value="${esc(e?.title || '')}"></div><div class="field"><label for="expense-category">Categoria</label><input id="expense-category" name="category" list="categories" required maxlength="80" placeholder="Ex.: Hospedagem" value="${esc(e?.category || '')}"><datalist id="categories">${['Hospedagem','Transporte','Alimentação','Passeios','Compras','Seguro','Outros'].map(c => `<option>${c}</option>`).join('')}</datalist></div><div class="field"><label for="expense-estimate">Estimativa da reserva em reais (R$)</label><input id="expense-estimate" name="estimate" data-pricing inputmode="decimal" placeholder="0,00" required value="${e ? amountInput(e.pricing?.estimate_cents ?? e.total_cents) : ''}"><small>Valor previsto na reserva, antes da cobrança definitiva.</small></div><div class="field full"><label class="checkbox-label"><input id="pricing-final" type="checkbox" name="final_confirmed" ${e?.pricing?.final_confirmed ? 'checked' : ''}><span>O valor final do cartão já foi confirmado.<br><small>Informe a conversão efetivamente cobrada, o IOF e as demais taxas. Isso não significa que a fatura foi quitada.</small></span></label></div><div id="card-pricing-fields" class="field full" ${e?.pricing?.final_confirmed ? '' : 'hidden'}><div class="form-grid"><div class="field full"><label for="card-principal">Cobrança convertida em reais (R$)</label><input id="card-principal" name="card_principal" data-pricing inputmode="decimal" placeholder="0,00" value="${e?.pricing?.card_principal_cents ? amountInput(e.pricing.card_principal_cents) : ''}"><small>Principal cobrado pelo cartão, sem somar o IOF duas vezes.</small></div><div class="field"><label for="card-iof">IOF (R$)</label><input id="card-iof" name="iof" data-pricing inputmode="decimal" value="${amountInput(e?.pricing?.iof_cents || 0)}"></div><div class="field"><label for="card-other">Outras taxas (R$)</label><input id="card-other" name="other_fees" data-pricing inputmode="decimal" value="${amountInput(e?.pricing?.other_fees_cents || 0)}"></div></div></div><div class="field full"><label for="expense-total">Valor adotado no rateio (R$)</label><input id="expense-total" name="total" readonly inputmode="decimal" required value="${e ? amountInput(e.total_cents) : ''}"><small id="pricing-explanation">${e?.pricing?.final_confirmed ? 'Cobrança convertida + IOF + outras taxas.' : 'A estimativa será usada até a confirmação do custo final.'}</small></div><div class="field"><label for="expense-incurred">Data da compra <small>se conhecida</small></label><input id="expense-incurred" name="incurred_on" type="date" value="${esc(e?.incurred_on || '')}"></div><div class="field"><label for="expense-due">Vencimento <small>se definido</small></label><input id="expense-due" name="due_on" type="date" value="${esc(e?.due_on || '')}"><small>Para hotel, informe a data do pagamento combinado.</small></div><div class="field"><label for="expense-currency">Moeda original</label><select id="expense-currency" name="currency"><option value="BRL" ${!e?.currency || e?.currency === 'BRL' ? 'selected' : ''}>Real · BRL</option><option value="JPY" ${e?.currency === 'JPY' ? 'selected' : ''}>Iene · JPY</option><option value="USD" ${e?.currency === 'USD' ? 'selected' : ''}>Dólar · USD</option></select></div><div class="field"><label for="expense-original">Valor na moeda original <small>opcional</small></label><input id="expense-original" name="original_amount" inputmode="decimal" placeholder="Somente referência" value="${esc(e?.original_amount ?? '')}"><small>Não há conversão automática de câmbio.</small></div><div class="field full form-section"><div class="allocation-toolbar"><span>Quanto cabe a cada família?</span><button class="text-link" type="button" data-action="split-equal">Dividir igualmente</button></div><small>Edite os valores para um rateio diferente. Mudanças no custo preservam a proporção do rateio; a soma precisa bater com o total.</small><div id="allocations">${families().map(f => `<label class="allocation-row" for="allocation-${esc(f.id)}"><span>${esc(f.name)}</span><input id="allocation-${esc(f.id)}" data-family="${esc(f.id)}" class="allocation-input" aria-label="Parte de ${esc(f.name)} em reais" inputmode="decimal" value="${amountInput(allocations.find(a => String(a.family_id) === String(f.id))?.amount_cents || 0)}" required></label>`).join('')}</div><div id="allocation-total" class="allocation-total"></div></div>${installmentFields(e?.installment_plan)}<div class="field full"><label for="expense-notes">Observações e origem <small>opcional</small></label><textarea id="expense-notes" name="notes" maxlength="5000" placeholder="Número da reserva, regras de cancelamento, câmbio, IOF ou dúvidas a confirmar…">${esc(e?.notes || '')}</textarea></div><div class="field"><label for="expense-status">Registro</label><select id="expense-status" name="status"><option value="confirmed" ${e?.status !== 'cancelled' && e?.status !== 'planned' ? 'selected' : ''}>Compra ou reserva</option><option value="planned" ${e?.status === 'planned' ? 'selected' : ''}>Planejada</option><option value="cancelled" ${e?.status === 'cancelled' ? 'selected' : ''}>Cancelada</option></select></div><div class="field full"><label class="checkbox-label"><input type="checkbox" name="verified" ${e?.verified ? 'checked' : ''}><span>Conferi o valor em reais e o rateio com os documentos.<br><small>Ao confirmar, a despesa passa a compor os compromissos do grupo. Os pagamentos são registrados separadamente.</small></span></label></div></div>`, { formId: 'expense-form', eyebrow: 'UM REGISTRO PARA CADA COMPRA', actions: `${cancelButton}<button class="button primary" type="submit">${e ? 'Salvar alterações' : 'Registrar despesa'}</button>` });
    $('#expense-form').dataset.id = e?.id || '';
    $('#expense-form').dataset.version = e?.version ?? '';
    $('#expense-form').dataset.splitMode = e && allocations.length === families().length && Math.max(...allocations.map(a => a.amount_cents)) - Math.min(...allocations.map(a => a.amount_cents)) <= 1 ? 'equal' : e ? 'manual' : 'equal';
    if (!e) splitEqual(); else updateAllocationTotal();
    if (e?.installment_plan?.items) renderInstallmentRows(e.installment_plan.items);
  }
  function installmentFields(plan) {
    return '<div class="field full form-section"><label class="checkbox-label"><input id="installment-enabled" type="checkbox" ' + (plan ? 'checked' : '') + '><span>Esta despesa tem parcelamento ou reembolso parcelado.</span></label><small>As parcelas organizam o fluxo de caixa. Elas não criam novas despesas nem comprovam um pagamento ao fornecedor.</small><div id="installment-settings" ' + (plan ? '' : 'hidden') + '><div class="form-grid"><div class="field full"><label for="installment-kind">O que está sendo parcelado?</label><select id="installment-kind"><option value="to_confirm" ' + (!plan || plan.kind === 'to_confirm' ? 'selected' : '') + '>Ainda a confirmar</option><option value="card" ' + (plan?.kind === 'card' ? 'selected' : '') + '>Fatura do cartão</option><option value="family_reimbursement" ' + (plan?.kind === 'family_reimbursement' ? 'selected' : '') + '>Reembolso entre famílias</option></select></div><div class="field"><label for="installment-count">Número de parcelas</label><input id="installment-count" type="number" min="1" max="36" step="1" value="' + Number(plan?.count || 4) + '"></div><div class="field"><label for="installment-payer">Titular ou família responsável</label><select id="installment-payer"><option value="">A confirmar</option>' + familyOptions(plan?.payer_family_id || '') + '</select></div><div class="field full"><button class="button small" type="button" data-action="generate-installments">Gerar parcelas iguais</button><small>Ajuste cada vencimento e data de quitação abaixo. Nenhuma data é presumida.</small><div id="installment-rows" class="table-scroll"></div><div id="installment-total" class="allocation-total"></div></div><div class="field full"><label class="checkbox-label"><input id="installment-confirmed" type="checkbox" ' + (plan?.confirmed ? 'checked' : '') + '><span>Confirmei o tipo, o titular e todos os vencimentos.<br><small>Datas de quitação são referências da fatura ou do reembolso. Registre o reembolso efetivo na aba Reembolsos para alterar os saldos.</small></span></label></div></div></div></div>';
  }
  function renderInstallmentRows(items) {
    $('#installment-rows').innerHTML = '<table><thead><tr><th>Parcela</th><th>Valor (R$)</th><th>Vencimento</th><th>Quitação</th></tr></thead><tbody>' + items.map((item,index) => '<tr class="installment-row" data-number="' + (index + 1) + '"><td>' + (index + 1) + '/' + items.length + '</td><td><input class="installment-amount" aria-label="Valor da parcela ' + (index + 1) + '" inputmode="decimal" value="' + amountInput(item.amount_cents) + '"></td><td><input class="installment-due" aria-label="Vencimento da parcela ' + (index + 1) + '" type="date" value="' + esc(item.due_on || '') + '"></td><td><input class="installment-paid" aria-label="Quitação da parcela ' + (index + 1) + '" type="date" max="' + today() + '" value="' + esc(item.paid_on || '') + '"></td></tr>').join('') + '</tbody></table>';
    updateInstallmentTotal();
  }
  function generateInstallments() {
    const count = Number($('#installment-count').value);
    const total = parseMoney($('#expense-total').value);
    if (!Number.isInteger(count) || count < 1 || count > 36 || !Number.isFinite(total) || total <= 0) return formError('Informe o valor da despesa e de 1 a 36 parcelas.');
    const previous = $$('.installment-row').map(row => ({due_on:$('.installment-due',row).value,paid_on:$('.installment-paid',row).value}));
    renderInstallmentRows(Array.from({length:count},(_,i) => ({number:i+1,amount_cents:Math.floor(total/count)+(i<total%count?1:0),due_on:previous[i]?.due_on || null,paid_on:previous[i]?.paid_on || null})));
  }
  function updateInstallmentTotal() {
    if (!$('#installment-total')) return;
    const values = $$('.installment-amount', $('#modal')).map(input => parseMoney(input.value));
    const total = parseMoney($('#expense-total').value);
    const sum = values.reduce((a,b) => a + (Number.isFinite(b) ? b : 0),0);
    $('#installment-total').innerHTML = '<span>Total das parcelas: <strong>' + money(sum) + '</strong></span><span class="' + (sum===total?'positive':'negative') + '">' + (sum===total?'✓ Total confere':'Diferença: '+money(total-sum)) + '</span>';
  }
  function installmentDetail(plan) {
    if (!plan) return '';
    const labels={card:'Fatura do cartão',family_reimbursement:'Reembolso entre famílias',to_confirm:'Tipo a confirmar'};
    return '<div class="detail-section"><h3>Parcelamento · ' + Number(plan.count) + 'x</h3><p class="review-source">' + esc(labels[plan.kind] || 'A confirmar') + ' · ' + esc(plan.payer_family_id ? familyName(plan.payer_family_id) : 'Titular a confirmar') + ' · ' + (plan.confirmed?'Vencimentos confirmados':'Vencimentos a conferir') + '</p><div class="table-scroll"><table><thead><tr><th>Parcela</th><th>Valor</th><th>Vencimento</th><th>Quitação</th></tr></thead><tbody>' + (plan.items || []).map(item => '<tr><td>' + Number(item.number) + '/' + Number(plan.count) + '</td><td class="amount">' + money(item.amount_cents) + '</td><td>' + (item.due_on ? date(item.due_on) : 'A definir') + '</td><td>' + (item.paid_on ? date(item.paid_on) : 'Não informada') + '</td></tr>').join('') + '</tbody></table></div><div class="panel-note">Parcelas não são somadas novamente ao custo da viagem. A quitação da fatura não é um novo pagamento ao fornecedor.</div></div>';
  }
  function renderCardInstallments() {
    const all = state.data.card_installments || [];
    if (!all.length) return '';
    const items = [...all].filter(item => !item.paid_on).sort((a,b) => (a.due_on || '9999').localeCompare(b.due_on || '9999')).slice(0,8);
    return '<section class="panel section-space"><div class="section-heading"><div><h2>Faturas e parcelas futuras</h2><p>Planejamento da fatura ou do reembolso parcelado, separado das contas dos fornecedores.</p></div>' + tag(all.length + ' parcelas') + '</div>' + (items.length ? '<div class="table-scroll"><table><thead><tr><th>Despesa / parcela</th><th>Responsável</th><th>Vencimento</th><th class="text-right">Valor</th><th>Situação</th></tr></thead><tbody>' + items.map(item => '<tr><td>' + esc(item.title || item.expense_title || 'Despesa parcelada') + '<span class="cell-meta">' + Number(item.number || 1) + '/' + Number(item.count || 1) + ' · ' + esc(item.kind === 'card' ? 'Fatura do cartão' : item.kind === 'family_reimbursement' ? 'Reembolso entre famílias' : 'Tipo a confirmar') + '</span></td><td>' + esc(item.payer_family_id ? familyName(item.payer_family_id) : 'A confirmar') + '</td><td class="nowrap">' + (item.due_on ? date(item.due_on) : 'A definir') + '</td><td class="text-right amount">' + money(item.amount_cents) + '</td><td>' + tag(item.confirmed ? 'Planejada' : 'A conferir',item.confirmed?'':'amber') + '</td></tr>').join('') + '</tbody></table></div>' : empty('Parcelas quitadas ou sem saldo futuro','Os registros de quitação permanecem nos detalhes das despesas.')) + '<div class="panel-note">Não some as parcelas aos compromissos dos fornecedores: são visões diferentes do mesmo dinheiro. Datas em branco precisam ser confirmadas.</div></section>';
  }
  function syncPricing() {
    if (!$('#expense-form')) return;
    const previous = parseMoney($('#expense-total').value);
    const final = $('#pricing-final').checked;
    $('#card-pricing-fields').hidden = !final;
    $('#card-principal').required = final;
    const estimate = parseMoney($('#expense-estimate').value);
    const principal = parseMoney($('#card-principal').value);
    const iof = parseMoney($('#card-iof').value || '0');
    const other = parseMoney($('#card-other').value || '0');
    const adopted = final ? principal + iof + other : estimate;
    $('#expense-total').value = Number.isFinite(adopted) ? amountInput(adopted) : '';
    $('#pricing-explanation').textContent = final ? 'Cobrança convertida + IOF + outras taxas. O pagamento da fatura é outro registro.' : 'A estimativa será usada até a confirmação do custo final.';
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
    modal('Registrar reembolso', `<div class="notice blue"><div class="notice-text">A família que envia o dinheiro reduz o que deve. A família que recebe reduz o que tem a receber. O custo da viagem continua igual.</div></div><div class="form-grid"><div class="field"><label for="transfer-from">Quem fez o reembolso?</label><select id="transfer-from" name="from_id" required><option value="">Selecionar família</option>${familyOptions(defaults.from)}</select></div><div class="field"><label for="transfer-to">Quem recebeu?</label><select id="transfer-to" name="to_id" required><option value="">Selecionar família</option>${familyOptions(defaults.to)}</select></div><div class="field"><label for="transfer-amount">Valor transferido (R$)</label><input id="transfer-amount" name="amount" inputmode="decimal" required placeholder="0,00" value="${defaults.amount ? amountInput(defaults.amount) : ''}"></div><div class="field"><label for="transfer-date">Data do reembolso</label><input id="transfer-date" name="paid_on" type="date" required max="${today()}" value="${today()}"></div><div class="field full"><label for="transfer-notes">Observação <small>opcional</small></label><textarea id="transfer-notes" name="notes" maxlength="5000" placeholder="Ex.: Pix referente ao acerto das hospedagens"></textarea></div></div>`, { eyebrow: 'ENTRE AS FAMÍLIAS', formId: 'transfer-form', actions: `${cancelButton}<button class="button primary" type="submit">Registrar reembolso</button>` });
  }
  function expenseDetail(id) {
    const e = (state.data.expenses || []).find(item => String(item.id) === String(id));
    if (!e) return;
    const status = expenseStatus(e);
    const payments = e.payments || [];
    modal(e.title, `<div class="detail-hero"><div><span class="metric-value amount">${money(e.total_cents)}</span><span class="cell-meta">${esc(e.category || 'Sem categoria')}${e.currency && e.currency !== 'BRL' && e.original_amount ? ` · Referência original: ${esc(e.original_amount)} ${esc(e.currency)}` : ''}</span></div><div>${tag(status.label, status.color)}<div class="status-line">${tag(e.verified ? 'Conferida' : 'Revisão pendente', e.verified ? 'green' : 'amber')}</div></div></div><div class="detail-list"><div class="detail-row"><span>Data da compra</span><strong>${date(e.incurred_on)}</strong></div><div class="detail-row"><span>Vencimento</span><strong>${e.due_on ? date(e.due_on) : 'A definir'}</strong></div><div class="detail-row"><span>Pagamentos líquidos</span><strong class="amount">${e.verified ? money(e.paid_cents) : 'Pagamento a conciliar'}</strong></div><div class="detail-row"><span>Ainda falta pagar</span><strong class="amount">${e.verified ? money(e.pending_cents) : 'Em conferência'}</strong></div><div class="detail-row"><span>Origem</span><strong>${esc(sourceLabel(e.source))}</strong></div></div>${e.pricing ? `<div class="detail-section"><h3>Da reserva ao custo efetivo</h3><div class="detail-row"><span>Estimativa da reserva</span><strong class="amount">${money(e.pricing.estimate_cents)}</strong></div>${e.pricing.final_confirmed ? `<div class="detail-row"><span>Cobrança convertida em reais</span><strong class="amount">${money(e.pricing.card_principal_cents)}</strong></div><div class="detail-row"><span>IOF</span><strong class="amount">${money(e.pricing.iof_cents)}</strong></div><div class="detail-row"><span>Outras taxas</span><strong class="amount">${money(e.pricing.other_fees_cents)}</strong></div><div class="detail-row"><span>Custo efetivo</span><strong class="amount">${money(e.total_cents)}</strong></div><div class="detail-row"><span>Diferença em relação à estimativa</span><strong class="amount">${money(e.total_cents - Number(e.pricing.estimate_cents || 0))}</strong></div>` : '<div class="panel-note">O custo final ainda não foi confirmado. O rateio usa a estimativa, que pode mudar com o câmbio, o IOF e outras taxas.</div>'}</div>` : ''}<div class="detail-section"><h3>Rateio da despesa</h3>${(e.allocations || []).map(a => `<div class="detail-row"><span>${esc(familyName(a.family_id))}</span><strong class="amount">${money(a.amount_cents)}</strong></div>`).join('') || '<p class="review-source">Rateio ainda não informado.</p>'}</div>${installmentDetail(e.installment_plan)}${e.notes ? `<div class="detail-notes">${esc(e.notes)}</div>` : ''}<div class="detail-section"><h3>Pagamentos e devoluções</h3>${payments.length ? payments.map(p => `<div class="payment-item"><div><strong>${esc(familyName(p.family_id))}</strong><small>${paymentLabel(p)} · ${date(p.paid_on)}</small>${p.notes ? `<small>${esc(p.notes)}</small>` : ''}</div><strong class="amount ${p.kind === 'refund' ? 'negative' : ''}">${p.kind === 'refund' ? '− ' : ''}${money(p.amount_cents)}</strong>${p.voided_at ? tag('Estornado') : editable() ? `<button class="text-link negative" data-action="cancel-payment" data-id="${esc(p.id)}">Estornar</button>` : ''}</div>`).join('') : '<p class="review-source">Nenhum pagamento vinculado. A reserva sozinha não comprova quem pagou.</p>'}</div>`, { eyebrow: 'DETALHES DA DESPESA', actions: `<button class="button" type="button" data-action="close-modal">Fechar</button>${editable() ? `<button class="button" type="button" data-action="edit-expense" data-id="${esc(e.id)}">Editar</button>${e.status !== 'cancelled' ? `<button class="button primary" type="button" data-action="new-payment" data-id="${esc(e.id)}">Pagamento</button>` : ''}` : ''}` });
  }
  function cancelForm(type, id) {
    if (!editable()) return;
    modal('Estornar movimentação', `<div class="notice"><div class="notice-text">O valor será retirado dos saldos. O lançamento original e o motivo ficarão preservados no histórico.</div></div><div class="field"><label for="cancel-reason">Qual é o motivo do estorno?</label><textarea id="cancel-reason" name="reason" required minlength="5" maxlength="1000" placeholder="Ex.: valor registrado em duplicidade"></textarea></div>`, { eyebrow: type === 'transfer' ? 'REEMBOLSO ENTRE FAMÍLIAS' : 'PAGAMENTO DA DESPESA', formId: 'cancel-form', actions: `${cancelButton}<button class="button danger" type="submit">Confirmar estorno</button>` });
    $('#cancel-form').dataset.type = type; $('#cancel-form').dataset.id = id;
  }
  function passwordForm() {
    if (!window.JP27_CONFIG?.supabaseUrl) return;
    modal('Trocar minha senha', '<div class="form-grid"><div class="field full"><label for="new-password">Nova senha</label><input id="new-password" name="password" type="password" autocomplete="new-password" required minlength="12"><small>Use pelo menos doze caracteres.</small></div><div class="field full"><label for="confirm-password">Repita a nova senha</label><input id="confirm-password" name="confirm" type="password" autocomplete="new-password" required minlength="12"></div></div>', {formId:'password-form',eyebrow:'SEU ACESSO PRIVADO',actions:cancelButton + '<button class="button primary" type="submit">Salvar nova senha</button>'});
  }
  async function logout() {
    try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch (e) { return toast(e.message); }
    state.session = null; state.data = null; $('#modal').close(); showGate('login');
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
        const pricing = { estimate_cents: parseMoney(value('estimate')), card_principal_cents: parseMoney(value('card_principal') || '0'), iof_cents: parseMoney(value('iof') || '0'), other_fees_cents: parseMoney(value('other_fees') || '0'), final_confirmed: data.get('final_confirmed') === 'on' };
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
          const items=$$('.installment-row',form).map((row,index)=>({number:index+1,amount_cents:parseMoney($('.installment-amount',row).value),due_on:$('.installment-due',row).value||null,paid_on:$('.installment-paid',row).value||null}));
          const confirmed=$('#installment-confirmed').checked, kind=$('#installment-kind').value, payer_family_id=$('#installment-payer').value||null;
          if (!Number.isInteger(count)||count<1||count>36||items.length!==count) throw new Error('Gere a lista com o número informado de parcelas.');
          if (items.some(item=>!Number.isSafeInteger(item.amount_cents)||item.amount_cents<=0)||items.reduce((sum,item)=>sum+item.amount_cents,0)!==total) throw new Error('A soma das parcelas precisa fechar com o custo da despesa. Gere novamente ou ajuste os valores.');
          if (items.some(item=>item.paid_on&&item.paid_on>today())) throw new Error('A data de quitação de uma parcela não pode ser futura.');
          if (confirmed && (kind==='to_confirm'||!payer_family_id||items.some(item=>!item.due_on))) throw new Error('Para confirmar o parcelamento, informe tipo, responsável e todos os vencimentos.');
          installment_plan={kind,count,payer_family_id,items,confirmed};
        }
        body = { installment_plan, pricing, title: value('title'), category: value('category'), total_cents: total, currency: value('currency'), original_amount: original || null, incurred_on: value('incurred_on') || null, due_on: value('due_on') || null, notes: value('notes'), allocations, verified: data.get('verified') === 'on', status: value('status') };
        path = form.dataset.id ? `/api/expenses/${encodeURIComponent(form.dataset.id)}` : '/api/expenses';
        method = form.dataset.id ? 'PUT' : 'POST';
        if (form.dataset.id) body.version = Number(form.dataset.version);
      } else if (form.id === 'cancel-form') {
        path = `/api/${form.dataset.type === 'transfer' ? 'transfers' : 'payments'}/${encodeURIComponent(form.dataset.id)}`;
        method = 'DELETE'; body = { reason: value('reason') };
        if (body.reason.length < 5) throw new Error('Descreva o motivo do estorno com pelo menos cinco caracteres.');
      } else {
        const amount = parseMoney(value('amount'));
        if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Informe um valor maior que zero, com até duas casas decimais.');
        if (value('paid_on') > today()) throw new Error('Uma movimentação já realizada não pode ter data futura.');
        if (form.id === 'transfer-form') {
          if (value('from_id') === value('to_id')) throw new Error('Escolha famílias diferentes para quem enviou e quem recebeu.');
          path = '/api/transfers'; body = { from_id: value('from_id'), to_id: value('to_id'), amount_cents: amount, paid_on: value('paid_on'), notes: value('notes') };
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
    const target = event.target.closest('[data-action], [data-page]');
    if (!target) return;
    if (target.dataset.page) return setPage(target.dataset.page);
    const action = target.dataset.action, id = target.dataset.id;
    if (action === 'close-modal') $('#modal').close();
    else if (action === 'new-expense') expenseForm();
    else if (action === 'edit-expense') expenseForm(id);
    else if (action === 'expense-detail') expenseDetail(id);
    else if (action === 'new-payment') paymentForm(id);
    else if (action === 'new-transfer') transferForm();
    else if (action === 'suggest-transfer') transferForm({ from: target.dataset.from, to: target.dataset.to, amount: Number(target.dataset.amount) });
    else if (action === 'split-equal') splitEqual();
    else if (action === 'generate-installments') generateInstallments();
    else if (action === 'cancel-transfer') cancelForm('transfer', id);
    else if (action === 'cancel-payment') cancelForm('payment', id);
    else if (action === 'logout') logout();
    else if (action === 'change-password') passwordForm();
  });
  document.addEventListener('submit', submitForm);
  document.addEventListener('input', event => {
    if (event.target.matches('[data-pricing]')) syncPricing();
    if (event.target.matches('.installment-amount')) updateInstallmentTotal();
    if (event.target.id === 'expense-total') { if ($('#expense-form')?.dataset.splitMode === 'equal') splitEqual(); else updateAllocationTotal(); }
    if (event.target.matches('.allocation-input')) { $('#expense-form').dataset.splitMode = 'manual'; updateAllocationTotal(); }
    if (event.target.id === 'filter-search') { state.filters.search = event.target.value; $('#expenses-table').innerHTML = expenseTable(filteredExpenses()); }
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'pricing-final') { syncPricing(); updateInstallmentTotal(); }
    if (event.target.id === 'installment-enabled') { $('#installment-settings').hidden = !event.target.checked; if(event.target.checked && !$$('.installment-row').length) generateInstallments(); }
    const mapping = { 'filter-category': 'category', 'filter-status': 'status', 'filter-family': 'family' };
    if (mapping[event.target.id]) { state.filters[mapping[event.target.id]] = event.target.value; $('#expenses-table').innerHTML = expenseTable(filteredExpenses()); }
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
