'use strict';

/* Same interface as the local private API; all writes are validated atomically in Postgres. */
(() => {
  const config = window.JP27_CONFIG;
  if (!config?.supabaseUrl || !config?.publishableKey) return;
  const root = config.supabaseUrl.replace(/\/$/, '');
  const sessionKey = 'jp27-auth-session';
  let session = null, snapshot = null, refreshPromise = null;
  try { session = JSON.parse(sessionStorage.getItem(sessionKey) || 'null'); } catch { sessionStorage.removeItem(sessionKey); }
  const error = (message, status = 400) => Object.assign(new Error(message), { status });
  const currentDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  function saveSession(value) {
    session = value; snapshot = null;
    if (value) sessionStorage.setItem(sessionKey, JSON.stringify(value));
    else sessionStorage.removeItem(sessionKey);
  }
  async function http(path, body, { method = 'POST', token = null } = {}) {
    let response;
    try {
      response = await fetch(root + path, {
        method, cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { apikey: config.publishableKey, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      });
    } catch { throw error('Falha ao conectar à área privada. Confira a conexão e tente novamente.', 503); }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      let message = payload.msg || payload.message || payload.error_description || payload.error || 'Não foi possível concluir a operação.';
      const match = String(message).match(/^(400|401|403|404|409):\s*([\s\S]*)$/);
      const status = match ? Number(match[1]) : response.status;
      if (match) message = match[2];
      if (message === 'Invalid login credentials') message = 'E-mail ou senha inválidos.';
      if (message === 'Email not confirmed') message = 'Este acesso ainda não foi confirmado.';
      throw error(String(message), status);
    }
    return payload;
  }
  async function accessToken() {
    if (!session?.access_token) throw error('Entre com o acesso da sua família.', 401);
    if (session.expires_at && session.expires_at * 1000 < Date.now() + 60_000) {
      if (!refreshPromise) refreshPromise = http('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token })
        .then(value => { saveSession({ ...value, expires_at: Math.floor(Date.now() / 1000) + value.expires_in }); return session.access_token; })
        .catch(cause => { saveSession(null); throw error('Sua sessão expirou. Entre novamente.', 401); })
        .finally(() => { refreshPromise = null; });
      return refreshPromise;
    }
    return session.access_token;
  }
  async function read() {
    const value = await http('/rest/v1/rpc/jp27_read', {}, { token: await accessToken() });
    if (!value?.data || !Number.isInteger(Number(value.version))) throw error('A base privada retornou um formato inesperado.', 503);
    snapshot = value;
    return value;
  }
  function allocate(paid, allocations) {
    const total = allocations.reduce((sum, a) => sum + a.amount_cents, 0);
    if (!total) return Object.fromEntries(allocations.map(a => [a.family_id, 0]));
    const denominator = BigInt(total), p = BigInt(paid);
    const shares = allocations.map(a => ({ id: a.family_id, amount: Number(p * BigInt(a.amount_cents) / denominator), remainder: p * BigInt(a.amount_cents) % denominator }));
    let missing = paid - shares.reduce((sum, a) => sum + a.amount, 0);
    shares.sort((a, b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1);
    for (const share of shares) { if (missing-- > 0) share.amount++; }
    return Object.fromEntries(shares.map(a => [a.id, a.amount]));
  }
  function dashboard(value, asOf = currentDay()) {
    if (!window.jp27Cashflow?.build || !window.jp27Reconciliation?.build) throw error('Atualize a página para carregar o encontro de contas.', 503);
    const data = value.data, settings = data.settings || {}, families = data.families || [];
    const balances = Object.fromEntries(families.map(f => [f.id, { family_id: f.id, name: f.name, paid_cents: 0, share_paid_cents: 0, sent_cents: 0, received_cents: 0, balance_cents: 0, future_cents: 0 }]));
    const summary = { committed_cents: 0, paid_cents: 0, pending_cents: 0, unverified_count: 0, unverified_cents: 0 };
    const warnings = [...(settings.warnings || [])];
    const transfers = (data.transfers || []).map(t => ({ ...t, from: balances[t.from_id]?.name || '', to: balances[t.to_id]?.name || '' }));
    const purchaseViews = (data.expenses || []).map(expense => {
      const payments = (data.payments || []).filter(p => p.expense_id === expense.id);
      const active = payments.filter(p => !p.voided_at && (!p.paid_on || p.paid_on <= asOf));
      const purchaseNet = active.reduce((sum, p) => sum + p.amount_cents * (p.kind === 'refund' ? -1 : 1), 0);
      // A card purchase is the full commitment, not a paid bank installment.
      const recordedPaid = active.filter(p => !p.initial_assumption && p.method !== 'card_purchase')
        .reduce((sum, p) => sum + p.amount_cents * (p.kind === 'refund' ? -1 : 1), 0);
      const payer = expense.declared_payer_family_id || expense.source?.declared_payer_family_id || null;
      const paymentStatus = expense.payment_status || expense.source?.payment_status || (active.some(p => p.method === 'card_purchase') ? 'card_charged' : purchaseNet >= expense.total_cents ? 'paid' : purchaseNet > 0 ? 'partial' : 'on_site');
      return { ...expense, declared_payer_family_id: payer, payment_status: paymentStatus, payments,
        recorded_paid_cents: recordedPaid, paid_cents: recordedPaid,
        pending_cents: expense.status === 'cancelled' ? 0 : expense.total_cents - recordedPaid };
    });
    // Use the same dated movements for the totals, family balances and calendar.
    // Future installments never enter "paid", even when the purchase is charged.
    const cashflow = window.jp27Cashflow.build(purchaseViews, transfers, families, asOf);
    const externalMovements = [...(cashflow.monthly_cashflow || []).flatMap(m => m.movements), ...(cashflow.unscheduled_cashflow || [])]
      .filter(m => m.kind !== 'reimbursement');
    const expenses = purchaseViews.map(expense => {
      const external = externalMovements.filter(m => m.expense_id === expense.id);
      const past = external.filter(m => m.scope === 'historical');
      const contributions = Object.fromEntries(families.map(f => [f.id, 0]));
      past.forEach(movement => {
        if (balances[movement.from_family_id]) contributions[movement.from_family_id] += movement.amount_cents;
        if (balances[movement.to_family_id]) contributions[movement.to_family_id] -= movement.amount_cents;
      });
      const paid = Object.values(contributions).reduce((sum, amount) => sum + amount, 0);
      const assumedDue = past.filter(m => m.kind === 'supplier' && m.assumed_paid).reduce((sum, m) => sum + m.amount_cents, 0);
      const pending = expense.status === 'cancelled' ? 0 : expense.total_cents - paid;
      const cards = external.filter(m => m.kind === 'card');
      const cardProgress = expense.payment_status !== 'on_site' && expense.installment_plan?.kind === 'card' ? {
        count: expense.installment_plan.count,
        matured_count: cards.filter(m => m.scope === 'historical').length,
        matured_cents: cards.filter(m => m.scope === 'historical').reduce((sum, m) => sum + m.amount_cents, 0),
        future_count: cards.filter(m => m.scope === 'future').length,
        future_cents: cards.filter(m => m.scope === 'future').reduce((sum, m) => sum + m.amount_cents, 0)
      } : null;
      if (!expense.verified) {
        summary.unverified_count++;
        if (expense.status !== 'cancelled') summary.unverified_cents += expense.total_cents;
      } else {
        summary.paid_cents += paid;
        if (expense.status !== 'cancelled') { summary.committed_cents += expense.total_cents; summary.pending_cents += pending; }
        const shares = allocate(paid, expense.allocations);
        Object.entries(contributions).forEach(([family, amount]) => { balances[family].paid_cents += amount; });
        expense.allocations.forEach(a => { balances[a.family_id].share_paid_cents += shares[a.family_id]; if (expense.status !== 'cancelled') balances[a.family_id].future_cents += a.amount_cents - shares[a.family_id]; });
      }
      return { ...expense, assumed_due_cents: assumedDue, card_progress: cardProgress, paid_cents: paid, pending_cents: pending };
    });
    transfers.forEach(t => { if (!t.voided_at && (!t.paid_on || t.paid_on <= asOf)) { balances[t.from_id].sent_cents += t.amount_cents; balances[t.to_id].received_cents += t.amount_cents; } });
    Object.values(balances).forEach(b => { b.balance_cents = b.paid_cents + b.sent_cents - b.received_cents - b.share_paid_cents; });
    if (Object.values(balances).reduce((sum, b) => sum + b.balance_cents, 0) !== 0) throw error('Os saldos precisam ser conferidos antes de continuar.', 500);
    const settlements = [];
    if (!summary.unverified_count) {
      const creditors = Object.values(balances).filter(b => b.balance_cents > 0).map(b => ({ id: b.family_id, amount: b.balance_cents })).sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
      const debtors = Object.values(balances).filter(b => b.balance_cents < 0).map(b => ({ id: b.family_id, amount: -b.balance_cents })).sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
      let ci = 0, di = 0;
      while (ci < creditors.length && di < debtors.length) {
        const c = creditors[ci], d = debtors[di], amount = Math.min(c.amount, d.amount);
        settlements.push({ from_id: d.id, to_id: c.id, from: balances[d.id].name, to: balances[c.id].name, amount_cents: amount });
        c.amount -= amount; d.amount -= amount;
        if (!c.amount) ci++; if (!d.amount) di++;
      }
    } else warnings.push(`${summary.unverified_count} despesas importadas ainda em conferência. Os saldos e os compromissos confirmados representam somente lançamentos já revisados.`);
    const cardInstallments = expenses.filter(e => e.status !== 'cancelled' && e.payment_status !== 'on_site').flatMap(e => (e.installment_plan?.items || []).map(item => ({ ...item, expense_id: e.id, title: e.title, count: e.installment_plan.count, kind: e.installment_plan.kind, confirmed: e.installment_plan.confirmed && e.verified, payer_family_id: e.installment_plan.payer_family_id, family_id: e.installment_plan.payer_family_id, family_name: balances[e.installment_plan.payer_family_id]?.name || 'Titular a confirmar' })));
    const reimbursementInstallments = expenses.filter(e => e.status !== 'cancelled').flatMap(e => (e.reimbursement_plans || []).flatMap(plan => (plan.items || []).map(item => ({
      ...item, expense_id: e.id, title: e.title, plan_id: plan.id || `${plan.from_family_id}-${plan.to_family_id}`,
      from_family_id: plan.from_family_id, to_family_id: plan.to_family_id,
      from_name: balances[plan.from_family_id]?.name || 'Família a confirmar',
      to_name: balances[plan.to_family_id]?.name || 'Família a confirmar',
      count: plan.count, confirmed: Boolean(plan.confirmed && e.verified)
    }))));
    const unclearPayments = expenses.filter(e => e.status !== 'cancelled' && e.payment_status === 'unknown');
    summary.unknown_payment_count = unclearPayments.length;
    summary.unknown_payment_cents = unclearPayments.reduce((sum, e) => sum + e.total_cents, 0);
    const questions = [...(settings.questions || [])].filter(q => {
      if (q.id === 'payment-la-vista') return expenses.some(e => e.id === q.expense_id && e.payment_status === 'unknown');
      if (q.action === 'edit-transfer' && q.transfer_id) return transfers.some(t => t.id === q.transfer_id && !t.voided_at && !t.paid_on);
      return true;
    });
    const reconciliation = window.jp27Reconciliation.build({ families, expenses, transfers,
      monthly_cashflow: cashflow.monthly_cashflow || [], unscheduled_cashflow: cashflow.unscheduled_cashflow || [], as_of: asOf });
    reconciliation.months.forEach(month => { month.settlement_due_on = window.jp27Cashflow.reimbursementDue(month.month,
      Number(settings.planning_rule?.reimbursement_business_day || 5)); });
    return { as_of: asOf, version: value.version, families, balances: Object.values(balances), summary, expenses, transfers, settlements, reconciliation,
      legacy: settings.legacy || null, audit: data.audit || [], warnings, review_items: settings.review_items || [],
      receipts: settings.receipts || [], planning_rule: settings.planning_rule || null, credit_card_schedule: settings.credit_card_schedule || [], card_installments: cardInstallments,
      reimbursement_installments: reimbursementInstallments, questions, ...cashflow };
  }
  async function mutate(action, payload) {
    if (!snapshot) await read();
    const result = await http('/rest/v1/rpc/jp27_mutate', { action, payload, expected_version: Number(snapshot.version) }, { token: await accessToken() });
    snapshot = result;
    return { ok: true, version: result.version };
  }
  async function request(path, options = {}) {
    const method = options.method || 'GET';
    const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body || {};
    if (path === '/api/login' && method === 'POST') {
      const value = await http('/auth/v1/token?grant_type=password', { email: String(body.username || '').trim(), password: body.password });
      saveSession({ ...value, expires_at: Math.floor(Date.now() / 1000) + value.expires_in });
      try { await read(); } catch (cause) { saveSession(null); throw cause; }
      return { user: { username: value.user.email, role: 'editor' }, csrf: 'supabase-bearer-session' };
    }
    if (path === '/api/logout') {
      try { if (session) await http('/auth/v1/logout', {}, { token: await accessToken() }); } finally { saveSession(null); }
      return { ok: true };
    }
    if (path === '/api/password' && method === 'POST') {
      if (typeof body.password !== 'string' || body.password.length < 12) throw error('Use uma senha com pelo menos 12 caracteres.');
      await http('/auth/v1/user', { password: body.password }, { method: 'PUT', token: await accessToken() });
      return { ok: true };
    }
    if (path === '/api/session') {
      const user = await http('/auth/v1/user', undefined, { method: 'GET', token: await accessToken() });
      await read();
      return { user: { username: user.email, role: 'editor' }, csrf: 'supabase-bearer-session' };
    }
    if (path === '/api/dashboard') return dashboard(await read());
    if (path === '/api/export') return { ...dashboard(await read()), exported_at: new Date().toISOString(), schema_version: 1 };
    if (path === '/api/expenses' && method === 'POST') return mutate('create_expense', body);
    if (path.startsWith('/api/expenses/') && method === 'PUT') return mutate('update_expense', { ...body, id: decodeURIComponent(path.split('/').pop()) });
    if (path === '/api/payments' && method === 'POST') return mutate('add_payment', body);
    if (path === '/api/transfers' && method === 'POST') return mutate('add_transfer', body);
    if (path.startsWith('/api/transfers/') && method === 'PUT') return mutate('update_transfer', { ...body, id: decodeURIComponent(path.split('/').pop()) });
    if (path.startsWith('/api/payments/') && method === 'DELETE') return mutate('void_payment', { ...body, id: decodeURIComponent(path.split('/').pop()) });
    if (path.startsWith('/api/transfers/') && method === 'DELETE') return mutate('void_transfer', { ...body, id: decodeURIComponent(path.split('/').pop()) });
    throw error('Operação não encontrada.', 404);
  }
  document.addEventListener('click', async event => {
    const anchor = event.target.closest('a');
    if (!anchor) return;
    const path = anchor.getAttribute('href') || '';
    if (path === '/api/export') {
      event.preventDefault();
      try { const data = await request(path); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `japao-contas-${currentDay()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
      catch (cause) { alert(cause.message); }
    } else if (path.startsWith('/api/receipts/')) {
      event.preventDefault();
      const tab = window.open('about:blank', '_blank');
      if (tab) tab.opener = null;
      try {
        if (!snapshot) await read();
        const id = decodeURIComponent(path.split('/').pop());
        const receipt = snapshot.data.settings?.receipts?.find(r => r.id === id);
        if (!receipt?.storage_path) throw error('Comprovante pendente de envio à área privada.', 404);
        const objectPath = receipt.storage_path.split('/').map(encodeURIComponent).join('/');
        const signed = await http('/storage/v1/object/sign/jp27-receipts/' + objectPath, { expiresIn: 60 }, { token: await accessToken() });
        if (!signed.signedURL) throw error('Falha ao abrir o comprovante. Tente novamente.');
        const url = root + '/storage/v1' + signed.signedURL;
        if (tab) tab.location.replace(url); else window.location.assign(url);
      } catch (cause) { if (tab) tab.close(); alert(cause.message); }
    }
  }, true);
  window.jp27Cloud = { request, dashboard, allocate };
})();
