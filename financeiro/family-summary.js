'use strict';

// Presentation only: transfers are distributed by weights, never linked to a purchase.
// Supplier contributions and accrued shares use the same historical movements as dashboard().
(() => {
  const list = value => Array.isArray(value) ? value : [];
  const cents = value => Number.isSafeInteger(value);
  const nonnegative = value => cents(value) && value >= 0;
  const compare = (a, b) => String(a).localeCompare(String(b));
  const sum = values => values.every(cents) && Number.isSafeInteger(values.reduce((a, b) => a + b, 0))
    ? values.reduce((a, b) => a + b, 0) : null;
  const day = value => {
    if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
  };
  const month = value => typeof value === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
  const fields = ['share_cents', 'due_cents', 'supplier_paid_cents', 'sent_cents', 'paid_cents', 'received_cents', 'balance_cents'];

  // Signed, symmetric largest remainders. IDs settle ties regardless of input order.
  function allocate(amount, weights) {
    const denominator = sum(weights.map(item => item.weight));
    if (!cents(amount) || !denominator || weights.some(item => !nonnegative(item.weight))) return null;
    const sign = amount < 0 ? -1 : 1, absolute = BigInt(Math.abs(amount)), divisor = BigInt(denominator);
    const parts = weights.map(item => ({ id: item.id,
      value: Number(absolute * BigInt(item.weight) / divisor),
      remainder: absolute * BigInt(item.weight) % divisor }));
    let missing = Math.abs(amount) - parts.reduce((total, part) => total + part.value, 0);
    parts.sort((a, b) => a.remainder === b.remainder ? compare(a.id, b.id) : a.remainder > b.remainder ? -1 : 1);
    for (const part of parts) if (missing-- > 0) part.value++;
    return new Map(parts.map(part => [part.id, sign * part.value]));
  }

  function build(data = {}, familyId) {
    const asOf = day(typeof data.as_of === 'string' ? data.as_of.slice(0, 10) : null);
    if (!asOf) throw new Error('Informe uma data válida para o resumo da família.');
    const id = String(familyId), families = list(data.families), familyIds = new Set(families.map(f => String(f.id)));
    if (!familyIds.has(id)) throw new Error('Escolha uma família cadastrada.');
    const warnings = [], warningSet = new Set();
    let partial = false;
    const warn = message => { partial = true; if (!warningSet.has(message)) { warningSet.add(message); warnings.push(message); } };
    const expenses = list(data.expenses), byExpense = new Map(expenses.map(expense => [String(expense.id), expense]));
    const sourceAvailable = Array.isArray(data.monthly_cashflow) || Array.isArray(data.unscheduled_cashflow);
    const movements = [...list(data.monthly_cashflow).flatMap(bucket => list(bucket.movements)), ...list(data.unscheduled_cashflow)];
    const contributions = new Map(), uncertain = new Set(), seen = new Map();
    for (const expense of expenses) contributions.set(String(expense.id), new Map(families.map(f => [String(f.id), 0])));
    movements.forEach((movement, index) => {
      if (!movement || !['card', 'supplier'].includes(movement.kind) || movement.voided_at) return;
      const expenseId = String(movement.expense_id), expense = byExpense.get(expenseId);
      if (!expense) return;
      const date = day(movement.date), calendarMonth = date?.slice(0, 7) || month(movement.month);
      if (!date && !calendarMonth) uncertain.add(expenseId);
      if (movement.scope !== 'historical' || (date && date > asOf) || (calendarMonth && calendarMonth > asOf.slice(0, 7))) return;
      const key = movement.id == null ? 'movement-' + index : String(movement.id);
      const signature = JSON.stringify([expenseId, movement.kind, movement.from_family_id, movement.to_family_id, movement.amount_cents, date, calendarMonth]);
      if (seen.has(key)) {
        if (seen.get(key) !== signature) { uncertain.add(expenseId); warn('Há movimentos repetidos com dados diferentes. Confira a origem dos pagamentos.'); }
        return;
      }
      seen.set(key, signature);
      const from = movement.from_family_id == null ? null : String(movement.from_family_id);
      const to = movement.to_family_id == null ? null : String(movement.to_family_id);
      if (!nonnegative(movement.amount_cents) || (!familyIds.has(from) && !familyIds.has(to))) {
        uncertain.add(expenseId); return;
      }
      const amounts = contributions.get(expenseId);
      if (familyIds.has(from)) amounts.set(from, amounts.get(from) + movement.amount_cents);
      if (familyIds.has(to)) amounts.set(to, amounts.get(to) - movement.amount_cents);
    });

    const rows = [];
    for (const expense of expenses) {
      const expenseId = String(expense.id), allocations = list(expense.allocations);
      const own = allocations.find(allocation => String(allocation.family_id) === id);
      const referenceShare = own ? own.amount_cents : 0, cancelled = expense.status === 'cancelled';
      const share = cancelled ? 0 : nonnegative(referenceShare) ? referenceShare : null;
      const amounts = contributions.get(expenseId), observedSupplier = amounts.get(id);
      const verified = expense.verified === true;
      const supplier = verified ? observedSupplier : 0;
      const validAllocations = allocations.length > 0 && new Set(allocations.map(a => String(a.family_id))).size === allocations.length
        && allocations.every(a => familyIds.has(String(a.family_id)) && nonnegative(a.amount_cents))
        && nonnegative(expense.total_cents) && sum(allocations.map(a => a.amount_cents)) === expense.total_cents;
      const paid = sum([...amounts.values()]);
      const shares = validAllocations && cents(paid) && expense.total_cents > 0
        ? allocate(paid, allocations.map(a => ({ id: String(a.family_id), weight: a.amount_cents }))) : null;
      const knownDue = verified && shares ? shares.get(id) ?? 0 : 0;
      const declaredPayer = expense.declared_payer_family_id || expense.source?.declared_payer_family_id
        || expense.installment_plan?.payer_family_id
        || list(expense.payments).find(payment => !payment.voided_at && payment.kind !== 'refund')?.family_id;
      const activePurchaseByFamily = !cancelled && declaredPayer != null && String(declaredPayer) === id;
      if (share === 0 && supplier === 0 && knownDue === 0 && !(own && !nonnegative(referenceShare)) && !activePurchaseByFamily) continue;
      const unknownPayment = expense.payment_status === 'unknown' || expense.payment_unknown === true
        || expense.payment_status_unknown === true || expense.pending_cents === null;
      const incomplete = !sourceAvailable || !verified || !validAllocations || !cents(paid)
        || !cents(supplier) || uncertain.has(expenseId) || unknownPayment;
      if (incomplete) warn('Há valores ou vencimentos a esclarecer em ' + String(expense.title || 'uma compra') + '.');
      rows.push({ id: expenseId, expense_id: expenseId, title: String(expense.title || 'Compra'),
        status: expense.status || null, cancelled, reference_share_cents: nonnegative(referenceShare) ? referenceShare : null,
        share_cents: share, due_cents: incomplete ? null : knownDue,
        supplier_paid_cents: incomplete ? null : supplier,
        sent_cents: 0, received_cents: 0, paid_cents: null, balance_cents: null,
        known_due_cents: knownDue, known_supplier_paid_cents: cents(supplier) ? supplier : 0, partial: incomplete });
    }

    let sent = 0, received = 0, unknownTransfer = false;
    const transferIds = new Map();
    list(data.transfers).forEach((transfer, index) => {
      if (!transfer || transfer.voided_at) return;
      const from = String(transfer.from_id ?? transfer.from_family_id ?? ''), to = String(transfer.to_id ?? transfer.to_family_id ?? '');
      if (from !== id && to !== id) return;
      const date = day(transfer.paid_on);
      if (date && date > asOf) return;
      if (!date) warn('Transferências sem data entram neste resumo, como no saldo geral. Informe as datas para conferir o período.');
      const key = transfer.id == null ? 'transfer-' + index : String(transfer.id);
      const signature = JSON.stringify([from, to, transfer.amount_cents, transfer.paid_on]);
      if (transferIds.has(key)) {
        if (transferIds.get(key) !== signature) { unknownTransfer = true; warn('Há transferências repetidas com dados diferentes.'); }
        return;
      }
      transferIds.set(key, signature);
      if (!familyIds.has(from) || !familyIds.has(to) || from === to || !nonnegative(transfer.amount_cents)) {
        unknownTransfer = true; warn('Há uma transferência com família ou valor a esclarecer.'); return;
      }
      if (from === id) sent += transfer.amount_cents;
      if (to === id) received += transfer.amount_cents;
    });

    let distributionBasis = 'advance', weights = [];
    if (rows.every(row => cents(row.due_cents)) && rows.some(row => row.due_cents > 0)) {
      distributionBasis = 'due'; weights = rows.map(row => ({ id: row.id, weight: Math.max(0, row.due_cents) }));
    } else if (rows.every(row => nonnegative(row.share_cents)) && rows.some(row => row.share_cents > 0)) {
      distributionBasis = 'share'; weights = rows.map(row => ({ id: row.id, weight: row.share_cents }));
    }
    if (!weights.length && (sent || received || unknownTransfer)) {
      const advanceId = '__family-summary-advance__';
      rows.push({ id: advanceId, expense_id: null, title: 'Adiantamentos', status: null, cancelled: false,
        reference_share_cents: 0, share_cents: 0, due_cents: 0, supplier_paid_cents: 0,
        sent_cents: 0, received_cents: 0, paid_cents: null, balance_cents: null,
        known_due_cents: 0, known_supplier_paid_cents: 0, partial: unknownTransfer });
      weights = [{ id: advanceId, weight: 1 }];
    }
    const distributedSent = weights.length ? allocate(sent, weights) : null;
    const distributedReceived = weights.length ? allocate(received, weights) : null;
    rows.forEach(row => {
      row.sent_cents = unknownTransfer ? null : distributedSent?.get(row.id) ?? 0;
      row.received_cents = unknownTransfer ? null : distributedReceived?.get(row.id) ?? 0;
      row.known_sent_cents = distributedSent?.get(row.id) ?? 0;
      row.known_received_cents = distributedReceived?.get(row.id) ?? 0;
      row.paid_cents = sum([row.supplier_paid_cents, row.sent_cents]);
      row.balance_cents = cents(row.paid_cents) && cents(row.received_cents) && cents(row.due_cents)
        ? row.paid_cents - row.received_cents - row.due_cents : null;
      row.known_paid_cents = row.known_supplier_paid_cents + row.known_sent_cents;
      row.known_balance_cents = row.known_paid_cents - row.known_received_cents - row.known_due_cents;
      row.partial ||= unknownTransfer;
    });
    const totals = Object.fromEntries(fields.map(field => [field, sum(rows.map(row => row[field]))]));
    const knownTotals = { share_cents: totals.share_cents,
      due_cents: sum(rows.map(row => row.known_due_cents)), supplier_paid_cents: sum(rows.map(row => row.known_supplier_paid_cents)),
      sent_cents: sum(rows.map(row => row.known_sent_cents)), received_cents: sum(rows.map(row => row.known_received_cents)),
      paid_cents: sum(rows.map(row => row.known_paid_cents)), balance_cents: sum(rows.map(row => row.known_balance_cents)) };
    const reference = list(data.balances).find(balance => String(balance.family_id) === id);
    const referenceBalance = cents(reference?.balance_cents) ? reference.balance_cents : null;
    const reconciled = referenceBalance === null ? null : referenceBalance === knownTotals.balance_cents;
    if (reconciled === false) warn('A decomposição precisa ser conferida com o saldo geral. Os valores desconhecidos continuam separados.');
    return { family_id: id, as_of: asOf, rows, totals, known_totals: knownTotals,
      reference_balance_cents: referenceBalance, reconciled, partial,
      distribution_basis: distributionBasis,
      distribution_note: 'Transferências distribuídas para apresentar o total por compra; a distribuição não identifica a finalidade dos pagamentos.',
      warnings };
  }

  const externalMovements = data => [
    ...list(data.monthly_cashflow).flatMap(bucket => list(bucket.movements)), ...list(data.unscheduled_cashflow)
  ].filter(item => item && ['card', 'supplier'].includes(item.kind) && !item.voided_at);
  const nextMonth = value => {
    const [year, number] = value.split('-').map(Number);
    return number < 12 ? String(year).padStart(4, '0') + '-' + String(number + 1).padStart(2, '0')
      : year < 9999 ? String(year + 1).padStart(4, '0') + '-01' : null;
  };

  function months(data = {}) {
    const asOf = day(typeof data.as_of === 'string' ? data.as_of.slice(0, 10) : null);
    if (!asOf) throw new Error('Informe uma data válida para a previsão.');
    const first = nextMonth(asOf.slice(0, 7));
    if (!first) return [];
    let last = first;
    externalMovements(data).forEach(item => {
      const period = day(item.date)?.slice(0, 7) || month(item.month);
      if (period && period > last) last = period;
    });
    const result = [];
    for (let period = first; period && period <= last; period = nextMonth(period)) result.push(period);
    return result;
  }

  // Future shares are marginal allocations of each purchase's cumulative cost.
  // The current credit offsets all purchases before distributing the remaining total.
  function forecast(data = {}, familyId, selectedMonth) {
    const current = build(data, familyId), id = current.family_id, asOf = current.as_of;
    const currentMonth = asOf.slice(0, 7), through = month(selectedMonth);
    if (!through || through <= currentMonth) throw new Error('Escolha um mês futuro válido para a previsão.');
    const warnings = [...current.warnings], warningSet = new Set(warnings);
    let partial = current.partial;
    const warn = message => { partial = true; if (!warningSet.has(message)) { warningSet.add(message); warnings.push(message); } };
    const familyIds = new Set(list(data.families).map(family => String(family.id)));
    const states = new Map(list(data.expenses).map(expense => [String(expense.id), {
      expense, before: [], future: [], beforeUnknown: false, futureUnknown: false, hasFuture: false, count: 0
    }]));
    const seen = new Map();
    externalMovements(data).forEach((item, index) => {
      const expenseId = String(item.expense_id), state = states.get(expenseId);
      if (!state) return;
      state.count++;
      const date = day(item.date), period = date?.slice(0, 7) || month(item.month);
      const historical = item.scope === 'historical' && (!date || date <= asOf) && (!period || period <= currentMonth);
      const included = !historical && (!period || period <= through);
      if (!historical && !included) return;
      const key = item.id == null ? 'movement-' + index : String(item.id);
      const signature = JSON.stringify([expenseId, item.kind, item.from_family_id, item.to_family_id, item.amount_cents, date, period]);
      if (seen.has(key)) {
        const previous = seen.get(key);
        if (previous.signature !== signature) {
          state.futureUnknown = true;
          states.get(previous.expenseId).futureUnknown = true;
          warn('Há movimentos repetidos com dados diferentes na previsão.');
        }
        return;
      }
      seen.set(key, { signature, expenseId });
      if (!historical) state.hasFuture = true;
      const from = item.from_family_id == null ? null : String(item.from_family_id);
      const to = item.to_family_id == null ? null : String(item.to_family_id);
      const valid = nonnegative(item.amount_cents) && (familyIds.has(from) || familyIds.has(to))
        && (from === null || familyIds.has(from)) && (to === null || familyIds.has(to));
      const invalidDate = item.date != null && item.date !== '' && !date;
      const conflictingMonth = date && item.month != null && item.month !== '' && month(item.month) !== date.slice(0, 7);
      if (!valid || invalidDate || conflictingMonth) {
        if (historical) state.beforeUnknown = true; else state.futureUnknown = true;
        return;
      }
      if (historical) {
        state.before.push((familyIds.has(from) ? item.amount_cents : 0) - (familyIds.has(to) ? item.amount_cents : 0));
      } else if (!period || (date && date <= asOf) || (!date && period < currentMonth)) {
        state.futureUnknown = true;
      } else {
        state.future.push((familyIds.has(from) ? item.amount_cents : 0) - (familyIds.has(to) ? item.amount_cents : 0));
      }
    });

    const currentRows = new Map(current.rows.map(row => [row.id, row]));
    const rows = [], futureShares = [];
    const sourceAvailable = Array.isArray(data.monthly_cashflow) || Array.isArray(data.unscheduled_cashflow);
    for (const [expenseId, state] of states) {
      const expense = state.expense, allocations = list(expense.allocations), existing = currentRows.get(expenseId);
      const own = allocations.find(item => String(item.family_id) === id), ownShare = own ? own.amount_cents : 0;
      const validAllocations = allocations.length > 0 && new Set(allocations.map(item => String(item.family_id))).size === allocations.length
        && allocations.every(item => familyIds.has(String(item.family_id)) && nonnegative(item.amount_cents))
        && nonnegative(expense.total_cents) && sum(allocations.map(item => item.amount_cents)) === expense.total_cents;
      const unknownPayment = expense.payment_status === 'unknown' || expense.payment_unknown === true
        || expense.payment_status_unknown === true || expense.pending_cents === null;
      const missingCalendar = expense.status !== 'cancelled' && expense.total_cents !== 0 && (!sourceAvailable || !state.count || unknownPayment);
      let futureShare = 0;
      if (ownShare !== 0 && (state.hasFuture || state.futureUnknown || missingCalendar)) {
        const before = sum(state.before), extra = sum(state.future), after = sum([before, extra]);
        if (!validAllocations || expense.verified !== true || state.beforeUnknown || state.futureUnknown || missingCalendar
          || !cents(before) || !cents(after)) futureShare = null;
        else if (expense.total_cents > 0) {
          const weights = allocations.map(item => ({ id: String(item.family_id), weight: item.amount_cents }));
          const oldShares = allocate(before, weights), newShares = allocate(after, weights);
          futureShare = (newShares.get(id) ?? 0) - (oldShares.get(id) ?? 0);
        } else futureShare = null;
      }
      if (futureShare === null) warn('Informe os valores e vencimentos de ' + String(expense.title || 'uma compra') + ' para completar a previsão.');
      futureShares.push(futureShare);
      const historicalDebt = existing ? cents(existing.balance_cents) ? Math.max(0, -existing.balance_cents) : null : 0;
      if (!existing && futureShare === 0 && historicalDebt === 0) continue;
      const weight = cents(futureShare) ? sum([Math.max(0, futureShare), historicalDebt]) : null;
      rows.push({ id: expenseId, expense_id: expenseId, title: String(expense.title || 'Compra'),
        future_share_cents: futureShare, historical_debt_cents: historicalDebt,
        weight_cents: cents(weight) ? weight : null, forecast_cents: null });
    }
    for (const existing of current.rows.filter(row => row.expense_id === null)) {
      const debt = cents(existing.balance_cents) ? Math.max(0, -existing.balance_cents) : null;
      rows.push({ id: existing.id, expense_id: null, title: existing.title, future_share_cents: 0,
        historical_debt_cents: debt, weight_cents: debt, forecast_cents: null });
    }
    const balance = cents(current.reference_balance_cents) ? current.reference_balance_cents : current.totals.balance_cents;
    const future = sum(futureShares), net = sum([future, cents(balance) ? -balance : null]);
    const total = cents(current.totals.balance_cents) && cents(net) && current.reconciled !== false ? Math.max(0, net) : null;
    const weights = rows.map(row => ({ id: row.id, weight: row.weight_cents }));
    const distributed = cents(total) && weights.every(item => nonnegative(item.weight)) && sum(weights.map(item => item.weight)) > 0
      ? allocate(total, weights) : null;
    rows.forEach(row => { row.forecast_cents = total === 0 || row.weight_cents === 0 ? 0 : distributed?.get(row.id) ?? null; });
    if (total === null || rows.some(row => row.forecast_cents === null)) warn('A previsão está parcial. Confira os valores e vencimentos pendentes.');
    return { family_id: id, as_of: asOf, through_month: through, rows, total_cents: total,
      current_balance_cents: cents(balance) ? balance : null, future_share_cents: future,
      partial, warnings, months: months(data) };
  }

  window.jp27FamilySummary = { build, forecast, months };
})();
