'use strict';

// Monthly settlement is a view of external commitments and actual transfers.
// Reimbursement schedules are deliberately never read by this module.
(() => {
  const list = value => Array.isArray(value) ? value : [];
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const monthOf = value => typeof value === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
  const dayOf = value => {
    if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
  };
  const compare = (a, b) => String(a).localeCompare(String(b));
  const sum = values => values.reduce((total, value) => total + value, 0);
  const zeroes = families => Object.fromEntries(families.map(f => [f.id, 0]));
  const cloneState = state => ({ raw: { ...state.raw }, due: { ...state.due }, funded: { ...state.funded }, lots: state.lots.map(lot => ({ ...lot })) });

  function allocate(amount, allocations) {
    const total = sum(allocations.map(a => a.amount_cents));
    const denominator = BigInt(total), funded = BigInt(amount);
    const shares = allocations.map(a => ({ family_id: a.family_id,
      amount: Number(funded * BigInt(a.amount_cents) / denominator),
      remainder: funded * BigInt(a.amount_cents) % denominator }));
    let missing = amount - sum(shares.map(a => a.amount));
    shares.sort((a, b) => a.remainder === b.remainder ? compare(a.family_id, b.family_id) : a.remainder > b.remainder ? -1 : 1);
    shares.forEach(a => { if (missing-- > 0) a.amount++; });
    return Object.fromEntries(shares.map(a => [a.family_id, a.amount]));
  }

  function settlements(rows, key) {
    const order = (a, b) => b.amount - a.amount || compare(a.id, b.id);
    const creditors = rows.filter(r => r[key] > 0).map(r => ({ id: r.family_id, name: r.name, amount: r[key] })).sort(order);
    const debtors = rows.filter(r => r[key] < 0).map(r => ({ id: r.family_id, name: r.name, amount: -r[key] })).sort(order);
    const result = [];
    let ci = 0, di = 0;
    while (ci < creditors.length && di < debtors.length) {
      const creditor = creditors[ci], debtor = debtors[di], amount = Math.min(creditor.amount, debtor.amount);
      result.push({ from_id: debtor.id, to_id: creditor.id, from: debtor.name, to: creditor.name, amount_cents: amount });
      creditor.amount -= amount; debtor.amount -= amount;
      if (!creditor.amount) ci++;
      if (!debtor.amount) di++;
    }
    return result;
  }

  function build(input = {}) {
    const asOf = dayOf(input.as_of);
    if (!asOf) throw new Error('Informe uma data válida para o encontro de contas.');
    const families = list(input.families).map(f => ({ id: String(f.id), name: String(f.name || f.id) }));
    const familyMap = new Map(families.map(f => [f.id, f]));
    if (familyMap.size !== families.length) throw new Error('Há famílias repetidas no encontro de contas.');
    const expenses = new Map(list(input.expenses).map(e => [String(e.id), e]));
    const undatedCommitments = [], undatedTransfers = [], datedCommitments = [], datedTransfers = [];
    const allocationCache = new Map();

    const allocationsFor = expense => {
      const id = String(expense.id);
      if (allocationCache.has(id)) return allocationCache.get(id);
      const allocations = list(expense.allocations).map(a => ({ family_id: String(a.family_id), amount_cents: a.amount_cents }));
      const valid = allocations.length > 0 && new Set(allocations.map(a => a.family_id)).size === allocations.length &&
        allocations.every(a => familyMap.has(a.family_id) && integer(a.amount_cents)) &&
        sum(allocations.map(a => a.amount_cents)) > 0 &&
        sum(allocations.map(a => a.amount_cents)) === expense.total_cents;
      allocationCache.set(id, valid ? allocations : null);
      return valid ? allocations : null;
    };

    const externalById = new Map(), conflictingExternal = new Set();
    const addExternal = (movement, bucketMonth, index) => {
      if (!movement || !['card', 'supplier'].includes(movement.kind) || movement.voided_at) return;
      const date = dayOf(movement.date), month = date?.slice(0, 7) || monthOf(movement.month) || monthOf(bucketMonth);
      const outgoing = movement.from_family_id == null ? null : String(movement.from_family_id);
      const incoming = movement.to_family_id == null ? null : String(movement.to_family_id);
      const payer = outgoing || incoming, refund = !outgoing && Boolean(incoming);
      const expenseId = movement.expense_id == null ? null : String(movement.expense_id);
      const expense = expenses.get(expenseId), id = String(movement.id || 'external-' + index);
      const normalized = { ...movement, id, expense_id: expenseId, title: movement.title || expense?.title || 'Compra',
        payer, payer_family_id: payer, payer_name: familyMap.get(payer)?.name || 'Família a definir', date, month,
        gross_amount_cents: movement.amount_cents, amount_cents: refund ? -movement.amount_cents : movement.amount_cents,
        direction: refund ? 'refund' : 'payment' };
      let reason = null;
      if (!integer(movement.amount_cents) || !movement.amount_cents) reason = 'invalid_amount';
      else if (!payer || !familyMap.has(payer) || (outgoing && incoming)) reason = 'missing_payer';
      else if (!expense) reason = 'missing_expense';
      else if (!allocationsFor(expense)) reason = 'invalid_allocation';
      normalized.reason = reason;
      const previous = externalById.get(id);
      if (previous) {
        const signature = value => JSON.stringify([value.expense_id, value.kind, value.payer, value.amount_cents, value.date, value.month]);
        if (signature(previous) !== signature(normalized)) conflictingExternal.add(id);
      } else externalById.set(id, normalized);
    };
    let externalIndex = 0;
    list(input.monthly_cashflow).forEach(bucket => list(bucket.movements).forEach(m => addExternal(m, bucket.month, externalIndex++)));
    list(input.unscheduled_cashflow).forEach(m => addExternal(m, null, externalIndex++));
    externalById.forEach(commitment => {
      if (conflictingExternal.has(commitment.id)) commitment.reason = 'conflicting_duplicate';
      if (!commitment.month || commitment.reason) undatedCommitments.push({ ...commitment, reason: commitment.reason || 'missing_month' });
      else datedCommitments.push(commitment);
    });

    const transferById = new Map(), conflictingTransfers = new Set();
    list(input.transfers).forEach((transfer, index) => {
      if (!transfer || transfer.voided_at) return;
      const id = String(transfer.id || 'actual-transfer-' + index);
      const from = String(transfer.from_id || transfer.from_family_id || ''), to = String(transfer.to_id || transfer.to_family_id || '');
      const date = transfer.date_unknown ? null : dayOf(transfer.paid_on || transfer.date);
      const normalized = { ...transfer, id, from_id: from, to_id: to,
        from: familyMap.get(from)?.name || 'Família a definir', to: familyMap.get(to)?.name || 'Família a definir',
        date, paid_on: date, month: date?.slice(0, 7) || null, amount_cents: transfer.amount_cents, sequence: index };
      if (!integer(transfer.amount_cents) || !transfer.amount_cents) normalized.reason = 'invalid_amount';
      else if (!familyMap.has(from) || !familyMap.has(to) || from === to) normalized.reason = 'invalid_family';
      const previous = transferById.get(id);
      if (previous) {
        if (JSON.stringify([previous.from_id, previous.to_id, previous.amount_cents, previous.date]) !==
            JSON.stringify([from, to, normalized.amount_cents, date])) conflictingTransfers.add(id);
      } else transferById.set(id, normalized);
    });
    transferById.forEach(transfer => {
      if (conflictingTransfers.has(transfer.id)) transfer.reason = 'conflicting_duplicate';
      if (!transfer.month || transfer.reason) undatedTransfers.push({ ...transfer, reason: transfer.reason || 'missing_date' });
      else datedTransfers.push(transfer);
    });

    const monthSet = new Set([asOf.slice(0, 7), ...datedCommitments.map(c => c.month), ...datedTransfers.map(t => t.month)]);
    const calendarMonths = [...monthSet].sort(compare);
    const state = { raw: zeroes(families), due: zeroes(families), funded: {}, lots: [] };

    function runMonth(target, calendarMonth, commitments, transfers) {
      const rows = families.map(f => ({ family_id: f.id, name: f.name, opening_cents: target.raw[f.id],
        advanced_cents: 0, share_cents: 0, sent_cents: 0, received_cents: 0 }));
      const byId = new Map(rows.map(r => [r.family_id, r]));
      const consumptions = [], ledgerEntries = [];
      const consumeAdvances = () => {
        // Circular advances are already offset globally. Remove their common
        // amount before routing credits, so a one-cent debt cannot circulate
        // through a large advance cycle indefinitely.
        const findCycle = () => {
          const visiting = new Map(), visited = new Set(), path = [];
          const visit = family => {
            visiting.set(family, path.length);
            for (const lot of target.lots) {
              if (!lot.remaining_cents || lot.owner_family_id !== family) continue;
              if (visiting.has(lot.holder_family_id)) return path.slice(visiting.get(lot.holder_family_id)).concat(lot);
              if (visited.has(lot.holder_family_id)) continue;
              path.push(lot);
              const cycle = visit(lot.holder_family_id);
              if (cycle) return cycle;
              path.pop();
            }
            visiting.delete(family); visited.add(family);
            return null;
          };
          for (const family of families) {
            if (visited.has(family.id)) continue;
            const cycle = visit(family.id);
            if (cycle) return cycle;
          }
          return null;
        };
        let cycle;
        while ((cycle = findCycle())) {
          const amount = Math.min(...cycle.map(lot => lot.remaining_cents));
          cycle.forEach(lot => {
            lot.remaining_cents -= amount;
            consumptions.push({ source_transfer_id: lot.source_transfer_id, owner_family_id: lot.owner_family_id,
              holder_family_id: lot.holder_family_id, amount_cents: amount, reason: 'offset_advance_cycle', month: calendarMonth });
          });
        }
        let changed;
        do {
          changed = false;
          target.lots.forEach(lot => {
            const amount = Math.min(lot.remaining_cents, Math.max(0, -target.due[lot.owner_family_id]));
            if (!amount) return;
            target.due[lot.owner_family_id] += amount;
            target.due[lot.holder_family_id] -= amount;
            lot.remaining_cents -= amount;
            consumptions.push({ source_transfer_id: lot.source_transfer_id, owner_family_id: lot.owner_family_id,
              holder_family_id: lot.holder_family_id, amount_cents: amount, reason: 'settle_due', month: calendarMonth });
            changed = true;
          });
        } while (changed);
      };

      // Marginal shares are differences of cumulative allocations per expense.
      // This prevents a new rounding adjustment on every installment/month.
      commitments.forEach(commitment => {
        const allocations = allocationsFor(expenses.get(commitment.expense_id));
        const before = target.funded[commitment.expense_id] || 0;
        const after = before + commitment.amount_cents;
        if (!Number.isSafeInteger(after) || after < 0) throw new Error('A devolução excede os compromissos desta despesa.');
        const oldShares = allocate(before, allocations), newShares = allocate(after, allocations);
        const impacts = zeroes(families);
        impacts[commitment.payer] += commitment.amount_cents;
        target.funded[commitment.expense_id] = after;
        target.raw[commitment.payer] += commitment.amount_cents;
        target.due[commitment.payer] += commitment.amount_cents;
        byId.get(commitment.payer).advanced_cents += commitment.amount_cents;
        allocations.forEach(allocation => {
          const family = allocation.family_id, amount = newShares[family] - oldShares[family];
          target.raw[family] -= amount; target.due[family] -= amount;
          byId.get(family).share_cents += amount;
          impacts[family] -= amount;
        });
        ledgerEntries.push({ id: commitment.id, kind: 'commitment', source_kind: commitment.kind,
          date: commitment.date, month: calendarMonth, title: commitment.title,
          expense_id: commitment.expense_id, amount_cents: commitment.amount_cents,
          payer_family_id: commitment.payer, family_impacts_cents: impacts });
      });
      consumeAdvances();
      [...transfers].sort((a, b) => compare(a.date, b.date) || a.sequence - b.sequence).forEach(transfer => {
        const from = transfer.from_id, to = transfer.to_id;
        let remaining = transfer.amount_cents;
        target.raw[from] += remaining; target.raw[to] -= remaining;
        byId.get(from).sent_cents += remaining; byId.get(to).received_cents += remaining;
        const impacts = zeroes(families);
        impacts[from] += remaining; impacts[to] -= remaining;
        ledgerEntries.push({ id: transfer.id, kind: 'transfer', date: transfer.date, month: calendarMonth,
          title: transfer.title || 'Reembolso entre famílias', expense_id: transfer.expense_id || null,
          amount_cents: transfer.amount_cents, from_id: from, to_id: to, family_impacts_cents: impacts });
        // Net settlements take precedence over optional advance returns. This
        // lets one transfer settle a route across several original buyers.
        const settled = Math.min(remaining, Math.max(0, -target.due[from]));
        target.due[from] += settled; target.due[to] -= settled;
        remaining -= settled;
        // Any excess can return money held for the recipient before it creates
        // a new advance in the opposite direction.
        target.lots.forEach(lot => {
          if (lot.owner_family_id !== to || lot.holder_family_id !== from) return;
          const amount = Math.min(remaining, lot.remaining_cents);
          if (!amount) return;
          lot.remaining_cents -= amount; remaining -= amount;
          consumptions.push({ source_transfer_id: lot.source_transfer_id, return_transfer_id: transfer.id,
            owner_family_id: to, holder_family_id: from, amount_cents: amount, reason: 'return_advance', month: calendarMonth });
        });
        if (remaining) target.lots.push({ source_transfer_id: transfer.id, owner_family_id: from, holder_family_id: to,
          created_month: calendarMonth, original_cents: remaining, remaining_cents: remaining });
        consumeAdvances();
      });
      rows.forEach(row => {
        row.month_position_cents = row.advanced_cents - row.share_cents;
        row.transferred_net_cents = row.sent_cents - row.received_cents;
        row.required_cents = row.opening_cents + row.month_position_cents;
        row.closing_cents = target.raw[row.family_id];
        row.advance_cents = sum(target.lots.filter(l => l.owner_family_id === row.family_id).map(l => l.remaining_cents));
        row.advance_held_cents = sum(target.lots.filter(l => l.holder_family_id === row.family_id).map(l => l.remaining_cents));
        row.due_balance_cents = target.due[row.family_id];
        if (row.closing_cents !== row.due_balance_cents + row.advance_cents - row.advance_held_cents)
          throw new Error('O encontro de contas não preservou os adiantamentos.');
      });
      if (sum(rows.map(r => r.closing_cents)) !== 0 || sum(rows.map(r => r.due_balance_cents)) !== 0)
        throw new Error('O encontro de contas precisa fechar em zero.');
      const payable = settlements(rows, 'due_balance_cents');
      return { families: rows, settlements: payable, payable_settlements: payable,
        ledger_entries: ledgerEntries.sort((a, b) => compare(a.date || a.month, b.date || b.month) || compare(a.id, b.id)),
        raw_settlements: settlements(rows, 'closing_cents'),
        total_due_cents: sum(commitments.map(c => c.amount_cents)),
        total_transferred_cents: sum(transfers.map(t => t.amount_cents)),
        closing_debt_cents: sum(rows.map(r => Math.max(0, -r.due_balance_cents))),
        raw_closing_debt_cents: sum(rows.map(r => Math.max(0, -r.closing_cents))),
        advance_lots: target.lots.filter(l => l.remaining_cents > 0).map(l => ({ ...l })), advance_consumptions: consumptions };
    }

    let forecastState = null;
    const months = calendarMonths.map(calendarMonth => {
      const commitments = datedCommitments.filter(c => c.month === calendarMonth).sort((a, b) => compare(a.date || a.month, b.date || b.month) || compare(a.id, b.id));
      const transfers = datedTransfers.filter(t => t.month === calendarMonth);
      const before = cloneState(state), full = runMonth(state, calendarMonth, commitments, transfers);
      const current = calendarMonth === asOf.slice(0, 7), future = calendarMonth > asOf.slice(0, 7);
      const monthEnd = new Date(Number(calendarMonth.slice(0, 4)), Number(calendarMonth.slice(5, 7)), 0).getDate();
      const matured = commitment => commitment.date ? commitment.date <= asOf :
        Number(asOf.slice(8, 10)) === monthEnd || commitment.assumed_paid === true || commitment.payment_state === 'paid' || commitment.scope === 'historical';
      const asOfCommitments = current ? commitments.filter(matured) : commitments;
      const asOfTransfers = current ? transfers.filter(t => t.date <= asOf) : transfers;
      const daily = current ? runMonth(before, calendarMonth, asOfCommitments, asOfTransfers) : full;
      let forecast = null;
      if (current) {
        // Carry today's actual balances and advances into every later month.
        // Suggested settlements never change this projected ledger.
        forecastState = cloneState(before);
        const maturedIds = new Set(asOfCommitments.map(c => c.id));
        forecast = runMonth(forecastState, calendarMonth, commitments.filter(c => !maturedIds.has(c.id)), []);
      } else if (future && forecastState) {
        forecast = runMonth(forecastState, calendarMonth, commitments, []);
      }
      return { month: calendarMonth, as_of: asOf, future, is_current: current,
        ...full, commitments: commitments.map(c => ({ ...c })), transfers: transfers.map(t => ({ ...t })),
        as_of_rows: daily.families, as_of_settlements: daily.payable_settlements,
        as_of_ledger_entries: daily.ledger_entries,
        as_of_payable_settlements: daily.payable_settlements,
        as_of_total_due_cents: daily.total_due_cents, as_of_total_transferred_cents: daily.total_transferred_cents,
        as_of_closing_debt_cents: daily.closing_debt_cents,
        as_of_advance_lots: daily.advance_lots, as_of_advance_consumptions: daily.advance_consumptions,
        as_of_commitments: asOfCommitments.map(c => ({ ...c })), as_of_transfers: asOfTransfers.map(t => ({ ...t })),
        ...(forecast ? { forecast_rows: forecast.families,
          forecast_ledger_entries: forecast.ledger_entries,
          forecast_payable_settlements: forecast.payable_settlements,
          forecast_total_to_settle_cents: forecast.closing_debt_cents,
          forecast_total_due_cents: forecast.total_due_cents,
          forecast_advance_lots: forecast.advance_lots,
          forecast_advance_consumptions: forecast.advance_consumptions,
          forecast_assumption: 'Carrega os saldos e adiantamentos reais e compensa os compromissos previstos dos próximos meses.' } : {}) };
    });
    return { months, undated_transfers: undatedTransfers, undated_commitments: undatedCommitments };
  }

  window.jp27Reconciliation = Object.freeze({ build });
})();
