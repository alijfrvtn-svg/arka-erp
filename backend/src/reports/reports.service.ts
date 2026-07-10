import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';

@Injectable()
export class ReportsService {
  constructor(private readonly db: DatabaseService) {}

  async trialBalance() {
    const rows = await this.db.query(
      `SELECT account_id, code, name, account_type, normal_balance,
              total_debit::text AS total_debit, total_credit::text AS total_credit,
              debit_balance::text AS debit_balance, credit_balance::text AS credit_balance
         FROM arka.v_trial_balance
        WHERE total_debit <> 0 OR total_credit <> 0
        ORDER BY code`,
    );
    const totalDebit = rows.reduce((s, r) => s + BigInt(r.debit_balance), 0n);
    const totalCredit = rows.reduce((s, r) => s + BigInt(r.credit_balance), 0n);
    return { rows, totalDebit: totalDebit.toString(), totalCredit: totalCredit.toString(), balanced: totalDebit === totalCredit };
  }

  async profitAndLoss(from?: string, to?: string) {
    const rows = await this.db.query(
      `SELECT account_type, code, name, SUM(amount)::text AS amount
         FROM arka.v_profit_and_loss
        WHERE ($1::date IS NULL OR entry_date >= $1::date)
          AND ($2::date IS NULL OR entry_date <= $2::date)
        GROUP BY account_type, code, name
        HAVING SUM(amount) <> 0
        ORDER BY code`,
      [from ?? null, to ?? null],
    );
    const income = rows.filter((r) => r.account_type === 'INCOME');
    const expense = rows.filter((r) => r.account_type === 'EXPENSE');
    const totalIncome = income.reduce((s, r) => s + BigInt(r.amount), 0n);
    const totalExpense = expense.reduce((s, r) => s + BigInt(r.amount), 0n);
    return {
      income,
      expense,
      totalIncome: totalIncome.toString(),
      totalExpense: totalExpense.toString(),
      netProfit: (totalIncome - totalExpense).toString(),
    };
  }

  async balanceSheet() {
    const rows = await this.db.query(
      `SELECT a.account_type, a.code, a.name, r.rollup_balance::text AS amount
         FROM arka.accounts a
         JOIN arka.v_account_rollup r ON r.id = a.id
        WHERE a.account_type IN ('ASSET','LIABILITY','EQUITY')
          AND a.deleted_at IS NULL AND a.parent_id IS NOT NULL AND a.is_postable
        ORDER BY a.code`,
    );
    const sum = (t: string) =>
      rows.filter((r) => r.account_type === t).reduce((s, r) => s + BigInt(r.amount), 0n);
    const assets = sum('ASSET');
    const liabilities = sum('LIABILITY');
    const equity = sum('EQUITY');
    // Unclosed net income (income - expense) belongs to equity for the identity check.
    const [pl] = await this.db.query(
      `SELECT COALESCE(SUM(CASE WHEN account_type='INCOME' THEN amount ELSE -amount END),0)::text AS net
         FROM arka.v_profit_and_loss`,
    );
    const netIncome = BigInt(pl?.net ?? '0');
    return {
      assets: rows.filter((r) => r.account_type === 'ASSET'),
      liabilities: rows.filter((r) => r.account_type === 'LIABILITY'),
      equity: rows.filter((r) => r.account_type === 'EQUITY'),
      totals: {
        assets: assets.toString(),
        liabilities: liabilities.toString(),
        equity: equity.toString(),
        netIncome: netIncome.toString(),
        liabilitiesPlusEquity: (liabilities + equity + netIncome).toString(),
        balanced: assets === liabilities + equity + netIncome,
      },
    };
  }

  generalLedger(params: { accountId?: string; from?: string; to?: string; limit?: number }) {
    const limit = Math.min(params.limit ?? 200, 1000);
    return this.db.query(
      `SELECT entry_no, entry_date, account_code, account_name, account_type,
              entry_memo, line_memo, reference, source,
              debit::text AS debit, credit::text AS credit,
              project_code, project_name, entry_id, account_id
         FROM arka.v_general_ledger
        WHERE ($1::uuid IS NULL OR account_id = $1::uuid)
          AND ($2::date IS NULL OR entry_date >= $2::date)
          AND ($3::date IS NULL OR entry_date <= $3::date)
        ORDER BY entry_date DESC, entry_no DESC
        LIMIT $4`,
      [params.accountId ?? null, params.from ?? null, params.to ?? null, limit],
    );
  }

  async cashFlow(from?: string, to?: string) {
    const rows = await this.db.query(
      `SELECT code, name, SUM(net_inflow)::text AS net_inflow
         FROM arka.v_cash_flow_summary
        WHERE ($1::date IS NULL OR entry_date >= $1::date)
          AND ($2::date IS NULL OR entry_date <= $2::date)
        GROUP BY code, name
        ORDER BY code`,
      [from ?? null, to ?? null],
    );
    const net = rows.reduce((s, r) => s + BigInt(r.net_inflow), 0n);
    return { rows, netCashFlow: net.toString() };
  }
}
