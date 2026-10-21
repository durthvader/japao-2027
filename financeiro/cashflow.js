'use strict';

// Cash movements are a different view of the ledger, never additional expenses.
// This module reads its arguments only. It does not fetch, persist or date events.
(() => {
  const cents = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
  const day = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(value + 'T00:00:00Z');
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
  };
  const month = value => typeof value === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) ? value : null;
  const period = value => day(value.date) || month(value.month) || null;
  const sourceEvidence = value => ['receipt', 'spreadsheet', 'pending'].includes(value) ? value : 'pending';
  const list = value => Array.isArray(value) ? value : [];
  const key = (expenseId, from, to) => JSON.stringify([expenseId || null, from || null, to || null]);
  const order = (a, b) => !period(a) && !period(b) ? String(a.id).localeCompare(String(b.id)) : !period(a) ? 1 : !period(b) ? -1 : period(a).localeCompare(period(b)) || String(a.id).localeCompare(String(b.id));

  // Planning date only: weekdays excluding Brazilian national bank holidays.
  function reimbursementDue(calendarMonth, businessDay = 5) {
    if (!month(calendarMonth) || !Number.isInteger(Number(businessDay)) || Number(businessDay) < 1 || Number(businessDay) > 20) return null;
    const [year, calendar] = calendarMonth.split('-').map(Number);
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const n = h + l - 7 * m + 114;
    const easter = new Date(Date.UTC(year, Math.floor(n / 31) - 1, n % 31 + 1));
    const holidays = new Set(['01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25'].map(value => year + '-' + value));
    [-48,-47,-2,60].forEach(offset => {
      const holiday = new Date(easter); holiday.setUTCDate(holiday.getUTCDate() + offset); holidays.add(holiday.toISOString().slice(0,10));
    });
    let found = 0;
    for (let number = 1; number <= 31; number++) {
      const date = new Date(Date.UTC(year, calendar - 1, number));
      if (date.getUTCMonth() !== calendar - 1) break;
      const value = date.toISOString().slice(0,10);
      if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6 && !holidays.has(value) && ++found === Number(businessDay)) return value;
    }
    return null;
  }

  function build(expenses, transfers, families, asOf) {
    const cutoff = day(typeof asOf === 'string' ? asOf.slice(0, 10) : null);
    const familyList = list(families), familyMap = new Map(familyList.map(family => [String(family.id), family]));
    const familyName = id => familyMap.get(String(id))?.name || 'Família a definir';
    const timeline = [], movements = [], installments = [], totals = [];
    const activeTransfers = list(transfers).filter(transfer => !transfer.voided_at && cents(transfer.amount_cents) > 0);
    const transferCredit = new Map(), unallocatedCredit = new Map();
    const recordedBy = date => !date || !cutoff || date <= cutoff;
    const maturedBy = (date, calendarMonth) => Boolean(cutoff && (date ? date <= cutoff : calendarMonth && calendarMonth <= cutoff.slice(0, 7)));
    const addEvent = event => timeline.push({ ...event, date: day(event.date), month: day(event.date)?.slice(0, 7) || month(event.month), evidence: sourceEvidence(event.evidence), receipt_id: event.receipt_id || null });
    const addMovement = movement => {
      if (!cents(movement.amount_cents)) return;
      movements.push({
        ...movement, date: day(movement.date), month: day(movement.date)?.slice(0, 7) || month(movement.month),
        from_family_id: movement.from_family_id || null, to_family_id: movement.to_family_id || null,
        from_name: movement.from_name || (movement.from_family_id ? familyName(movement.from_family_id) : 'Pagador a definir'),
        to_name: movement.to_name || (movement.to_family_id ? familyName(movement.to_family_id) : movement.kind === 'card' ? 'Cartão' : 'Fornecedor'),
        confirmed: Boolean(movement.confirmed)
      });
    };

    // Only transfers already recorded as performed can cover a reimbursement plan.
    // An undated receipt remains a historical movement in the undated bucket.
    activeTransfers.forEach((transfer, index) => {
      const date = day(transfer.paid_on), historical = recordedBy(date);
      const expenseId = transfer.expense_id || transfer.meta?.expense_id || null;
      const from = transfer.from_id || transfer.from_family_id, to = transfer.to_id || transfer.to_family_id;
      const amount = cents(transfer.amount_cents), id = transfer.id || 'transfer-' + index;
      const evidence = sourceEvidence(transfer.evidence || transfer.meta?.evidence || (transfer.receipt_id ? 'receipt' : 'pending'));
      addEvent({ id: 'transfer-' + id, date, type: 'transfer', title: 'Reembolso entre famílias', description: transfer.notes || 'Transferência registrada; não aumenta o custo da viagem.', amount_cents: amount, from_id: from || null, to_id: to || null, expense_id: expenseId, evidence, receipt_id: transfer.receipt_id, scope: historical ? 'historical' : 'future' });
      addMovement({ id: 'transfer-' + id, date, kind: 'reimbursement', from_family_id: from, to_family_id: to, title: transfer.title || 'Reembolso registrado', amount_cents: amount, expense_id: expenseId, confirmed: historical, scope: historical ? 'historical' : 'future', certainty: historical ? 'recorded' : 'planned' });
      if (historical && expenseId && from && to) {
        const group = key(expenseId, from, to);
        transferCredit.set(group, (transferCredit.get(group) || 0) + amount);
      } else if (historical && !expenseId && from && to) {
        const pair = key(null, from, to);
        unallocatedCredit.set(pair, (unallocatedCredit.get(pair) || 0) + amount);
      }
    });

    // Undesignated transfers can reduce the same family's remaining obligations
    // to the same recipient. This is planning allocation, never a historical link.
    const orderedExpenses = [...list(expenses)].sort((a, b) => order({ date: day(a.incurred_on), id: a.id || '' }, { date: day(b.incurred_on), id: b.id || '' }));
    orderedExpenses.forEach((expense, expenseIndex) => {
      const expenseId = expense.id || 'expense-' + expenseIndex, title = expense.title || 'Compra sem descrição';
      const total = cents(expense.total_cents), source = expense.source || {};
      const payer = expense.declared_payer_family_id || source.declared_payer_family_id || expense.installment_plan?.payer_family_id || list(expense.payments).find(payment => !payment.voided_at && payment.kind !== 'refund')?.family_id || null;
      const evidence = sourceEvidence(expense.evidence || source.evidence || (source.sheet ? 'spreadsheet' : 'pending'));
      const receiptId = source.receipt_id || expense.receipt_id || null, purchaseDate = day(expense.incurred_on);
      const cancelled = expense.status === 'cancelled';
      const unknownPayment = expense.payment_status === 'unknown' || expense.payment_status_unknown === true || expense.payment_unknown === true || expense.pending_cents === null;
      const activePayments = list(expense.payments).filter(payment => !payment.voided_at && cents(payment.amount_cents) > 0);
      const plan = expense.installment_plan;
      const cardPlan = expense.payment_status !== 'on_site' && plan && (plan.kind === 'card' || plan.kind === 'credit_card' || plan.kind === 'card_purchase');
      addEvent({ id: 'purchase-' + expenseId, date: purchaseDate, type: 'purchase', title, description: cancelled ? 'Compra ou reserva cancelada; movimentações realizadas permanecem no histórico.' : 'Custo da compra ou reserva. Parcelas e reembolsos não são novas despesas.', amount_cents: total, from_id: payer, to_id: null, expense_id: expenseId, evidence, receipt_id: receiptId, scope: purchaseDate && cutoff && purchaseDate > cutoff ? 'future' : 'historical' });

      // A full purchase charged to a card is not a bank cash outflow on purchase day.
      // Cash/PIX payments explicitly recorded here remain separate from financed amounts.
      activePayments.forEach((payment, paymentIndex) => {
        if (payment.initial_assumption || payment.method === 'card_purchase') return;
        const amount = cents(payment.amount_cents), refund = payment.kind === 'refund';
        const date = day(payment.paid_on), historical = recordedBy(date);
        const id = payment.id || expenseId + '-' + paymentIndex;
        const paymentEvidence = sourceEvidence(payment.evidence || payment.meta?.evidence || (payment.receipt_id ? 'receipt' : evidence));
        addEvent({ id: 'payment-' + id, date, type: refund ? 'supplier_refund' : 'supplier_payment', title, description: refund ? 'Devolução registrada pelo fornecedor.' : 'Pagamento direto ao fornecedor registrado.', amount_cents: amount, from_id: refund ? null : payment.family_id, to_id: refund ? payment.family_id : null, expense_id: expenseId, evidence: paymentEvidence, receipt_id: payment.receipt_id || null, scope: historical ? 'historical' : 'future' });
        addMovement({ id: 'payment-' + id, date, kind: 'supplier', from_family_id: refund ? null : payment.family_id, to_family_id: refund ? payment.family_id : null, from_name: refund ? 'Fornecedor' : familyName(payment.family_id), title, amount_cents: amount, expense_id: expenseId, confirmed: historical, scope: historical ? 'historical' : 'future', certainty: historical ? 'recorded' : 'planned' });
      });

      if (cardPlan) {
        list(plan.items).forEach((item, itemIndex) => {
          const number = item.number || itemIndex + 1, amount = cents(item.amount_cents);
          const date = day(item.due_on), dueMonth = date?.slice(0, 7) || month(item.due_month);
          // Agreed group rule: the responsible family is assumed to have met
          // matured card obligations. We do not track bank bill settlement.
          const paid = maturedBy(date, dueMonth);
          if (cancelled && !paid) return;
          const monthBasis = 'due_month';
          const holder = plan.payer_family_id || payer;
          const state = paid ? 'paid' : date || dueMonth ? 'open' : 'unknown';
          const confirmed = Boolean(plan.confirmed), id = 'card-' + expenseId + '-' + number;
          const certainty = state === 'unknown' ? 'unknown' : 'planned';
          const description = paid ? 'Vencida — considerada paga pelo responsável, conforme a regra combinada. A data é o vencimento, não o pagamento bancário.' : state === 'open' ? 'Compromisso futuro do responsável, no vencimento informado.' : 'Falta informar o mês de vencimento desta parcela.';
          addEvent({ id, date, month: dueMonth, month_basis: monthBasis, date_basis: 'due_on', assumed_paid: paid, type: paid ? 'installment_matured' : 'installment_due', title: title + ' · cartão ' + number + '/' + (plan.count || plan.items.length), description, amount_cents: amount, from_id: holder, to_id: null, expense_id: expenseId, evidence: 'pending', receipt_id: item.receipt_id || receiptId, scope: paid ? 'historical' : 'future' });
          addMovement({ id, date, month: dueMonth, month_basis: monthBasis, date_basis: 'due_on', assumed_paid: paid, kind: 'card', from_family_id: holder, to_family_id: null, title: title + ' · parcela ' + number + '/' + (plan.count || plan.items.length), amount_cents: amount, expense_id: expenseId, confirmed, scope: paid ? 'historical' : 'future', certainty, payment_state: state, overdue: false });
        });
      }

      if (!cancelled) {
        // Credits are consumed once per expense/from/to, even with multiple plans.
        list(expense.reimbursement_plans).forEach((reimbursement, planIndex) => {
          const from = reimbursement.from_family_id, to = reimbursement.to_family_id;
          const group = key(expenseId, from, to), planId = reimbursement.id || expenseId + '-' + from + '-' + to + '-' + planIndex;
          const pair = key(null, from, to);
          let credit = transferCredit.get(group) || 0, freeCredit = unallocatedCredit.get(pair) || 0;
          let originalTotal = 0, coveredTotal = 0, freeCoveredTotal = 0;
          const items = list(reimbursement.items).map((item, index) => ({ ...item, number: item.number || index + 1 })).sort((a, b) => a.number - b.number);
          items.forEach(item => {
            const original = cents(item.amount_cents), matched = Math.min(original, credit);
            const freeCovered = Math.min(original - matched, freeCredit), covered = matched + freeCovered, remaining = original - covered;
            originalTotal += original; coveredTotal += covered; freeCoveredTotal += freeCovered; credit -= matched; freeCredit -= freeCovered;
            const derived = { ...item, due_on: day(item.due_on), due_month: day(item.due_on)?.slice(0, 7) || month(item.due_month), original_amount_cents: original, amount_cents: remaining, covered_by_transfers_cents: covered, matched_transfers_cents: matched, unallocated_credit_applied_cents: freeCovered, allocation_method: 'fifo_derived', allocation_note: 'Abatimento calculado por ordem de compra e parcela. Crédito sem compra identificada permanece sem vínculo no histórico; esta distribuição serve somente ao planejamento.', plan_id: planId, count: reimbursement.count || items.length, expense_id: expenseId, title, from_family_id: from, to_family_id: to, from_name: familyName(from), to_name: familyName(to), confirmed: Boolean(reimbursement.confirmed) };
            installments.push(derived);
            if (!remaining) return;
            const id = 'reimbursement-' + planId + '-' + item.number;
            const itemTitle = title + ' · reembolso ' + item.number + '/' + derived.count;
            addEvent({ id, date: derived.due_on, month: derived.due_month, type: 'installment_due', title: itemTitle, description: 'Valor restante após abater os reembolsos já registrados. A distribuição do abatimento é calculada por ordem de parcela.', amount_cents: remaining, from_id: from, to_id: to, expense_id: expenseId, evidence: 'pending', receipt_id: null, scope: 'future' });
            addMovement({ id, date: derived.due_on, month: derived.due_month, kind: 'reimbursement', from_family_id: from, to_family_id: to, title: itemTitle, amount_cents: remaining, expense_id: expenseId, confirmed: derived.confirmed, scope: 'future', certainty: derived.confirmed ? 'planned' : 'unknown', overdue: Boolean(cutoff && (derived.due_on ? derived.due_on < cutoff : derived.due_month && derived.due_month < cutoff.slice(0, 7))) });
          });
          transferCredit.set(group, credit);
          unallocatedCredit.set(pair, freeCredit);
          totals.push({ plan_id: planId, expense_id: expenseId, from_family_id: from, to_family_id: to, original_amount_cents: originalTotal, total_cents: originalTotal, covered_by_transfers_cents: coveredTotal, unallocated_credit_applied_cents: freeCoveredTotal, remaining_cents: originalTotal - coveredTotal, confirmed: Boolean(reimbursement.confirmed) });
        });

        if (!cardPlan) {
          const hasCardPurchase = activePayments.some(payment => payment.method === 'card_purchase');
          const cardCharged = expense.payment_status === 'card_charged' || hasCardPurchase;
          const pending = expense.assumed_due_cents > 0 ? Math.max(0, total - cents(expense.recorded_paid_cents)) : expense.pending_cents === undefined ? Math.max(0, total - cents(expense.paid_cents)) : cents(expense.pending_cents);
          if (unknownPayment || pending > 0 || cardCharged) {
            const amount = unknownPayment ? total : cardCharged ? (activePayments.filter(payment => payment.method === 'card_purchase').reduce((sum, payment) => sum + cents(payment.amount_cents), 0) || total) : pending;
            // Unknown supplier status has no implied due date, even if a stay date exists.
            const date = unknownPayment || cardCharged ? null : day(expense.due_on);
            const dueMonth = unknownPayment || cardCharged ? null : date?.slice(0, 7) || month(expense.due_month);
            const kind = cardCharged && !unknownPayment ? 'card' : 'supplier';
            const matured = !unknownPayment && !cardCharged && maturedBy(date, dueMonth);
            const description = unknownPayment ? 'Situação do pagamento desconhecida. Este valor precisa ser esclarecido; não é uma cobrança futura confirmada.' : kind === 'card' ? 'Compra lançada no cartão sem calendário de vencimento informado.' : matured ? 'Vencida — considerada paga pelo responsável, conforme a regra combinada. A data é o vencimento.' : 'Pagamento direto ao fornecedor previsto no vencimento informado.';
            const id = 'pending-' + expenseId;
            addEvent({ id, date, month: dueMonth, date_basis: 'due_on', assumed_paid: matured, type: matured ? 'installment_matured' : 'installment_due', title, description, amount_cents: amount, from_id: payer, to_id: null, expense_id: expenseId, evidence: 'pending', receipt_id: receiptId, scope: matured ? 'historical' : 'future' });
            addMovement({ id, date, month: dueMonth, date_basis: 'due_on', assumed_paid: matured, kind, from_family_id: payer, to_family_id: null, title, amount_cents: amount, expense_id: expenseId, confirmed: !unknownPayment && !cardCharged && Boolean(expense.verified), scope: matured ? 'historical' : 'future', certainty: unknownPayment || cardCharged ? 'unknown' : 'planned', payment_unknown: unknownPayment, overdue: false });
          }
        }
      }
    });

    // Expose surplus after all plans for the pair, rather than applying it twice.
    totals.forEach((total, index) => {
      const later = totals.slice(index + 1).some(other => key(other.expense_id, other.from_family_id, other.to_family_id) === key(total.expense_id, total.from_family_id, total.to_family_id));
      total.excess_transfers_cents = later ? 0 : transferCredit.get(key(total.expense_id, total.from_family_id, total.to_family_id)) || 0;
      const laterPair = totals.slice(index + 1).some(other => key(null, other.from_family_id, other.to_family_id) === key(null, total.from_family_id, total.to_family_id));
      total.unallocated_credit_remaining_cents = laterPair ? 0 : unallocatedCredit.get(key(null, total.from_family_id, total.to_family_id)) || 0;
    });

    const months = new Map(), unscheduled = [];
    movements.sort(order).forEach(movement => {
      const calendarMonth = movement.date?.slice(0, 7) || month(movement.month);
      if (!calendarMonth) { unscheduled.push(movement); return; }
      if (!months.has(calendarMonth)) months.set(calendarMonth, []);
      months.get(calendarMonth).push(movement);
    });
    const monthly = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, monthMovements]) => {
      const rows = familyList.map(family => ({ family_id: family.id, name: family.name, outgoing_cents: 0, incoming_cents: 0, net_cents: 0, card_cents: 0, reimbursement_out_cents: 0, supplier_cents: 0 }));
      const byId = new Map(rows.map(row => [String(row.family_id), row]));
      monthMovements.forEach(movement => {
        const from = byId.get(String(movement.from_family_id)), to = byId.get(String(movement.to_family_id));
        if (from) {
          from.outgoing_cents += movement.amount_cents;
          if (movement.kind === 'card') from.card_cents += movement.amount_cents;
          else if (movement.kind === 'reimbursement') from.reimbursement_out_cents += movement.amount_cents;
          else from.supplier_cents += movement.amount_cents;
        }
        if (to) { to.incoming_cents += movement.amount_cents; if (movement.kind === 'supplier') to.supplier_cents -= movement.amount_cents; }
      });
      rows.forEach(row => { row.net_cents = row.outgoing_cents - row.incoming_cents; });
      return { month, families: rows, movements: monthMovements };
    });
    timeline.sort((a, b) => !period(a) || !period(b) ? order(a, b) : period(b).localeCompare(period(a)) || String(a.id).localeCompare(String(b.id)));
    const dueAccrual = [...list(expenses)].map(expense => {
      const external = movements.filter(movement => movement.expense_id === expense.id && movement.kind !== 'reimbursement' && !movement.to_family_id);
      return { expense_id: expense.id, matured_cents: external.filter(movement => movement.scope === 'historical').reduce((sum, movement) => sum + movement.amount_cents, 0), future_cents: external.filter(movement => movement.scope === 'future' && period(movement)).reduce((sum, movement) => sum + movement.amount_cents, 0), undated_cents: external.filter(movement => movement.scope === 'future' && !period(movement)).reduce((sum, movement) => sum + movement.amount_cents, 0) };
    });
    return { financial_timeline: timeline, reimbursement_installments: installments, reimbursement_plan_totals: totals, monthly_cashflow: monthly, unscheduled_cashflow: unscheduled, due_accrual: dueAccrual };
  }

  window.jp27Cashflow = Object.freeze({ build, reimbursementDue });
})();
