import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';
import { RequirePermissions } from '../common/auth/decorators';

@Injectable()
export class DashboardService {
  constructor(private readonly db: DatabaseService) {}

  async ceoSnapshot() {
    const [
      cash,
      receivables,
      payables,
      pl,
      projects,
      overdue,
      recent,
      topDebtors,
      revenueTrend,
    ] = await Promise.all([
      this.db.query(
        `SELECT COALESCE(SUM(balance),0)::text AS v FROM arka.accounts
          WHERE metadata->>'cash_flow' = 'true' AND deleted_at IS NULL`,
      ),
      this.db.query(
        `SELECT COALESCE(rollup_balance,0)::text AS v FROM arka.v_account_rollup WHERE code = '1100'`,
      ),
      this.db.query(
        `SELECT COALESCE(rollup_balance,0)::text AS v FROM arka.v_account_rollup WHERE code = '20'`,
      ),
      this.db.query(
        `SELECT
           COALESCE(SUM(CASE WHEN account_type='INCOME'  THEN amount ELSE 0 END),0)::text AS income,
           COALESCE(SUM(CASE WHEN account_type='EXPENSE' THEN amount ELSE 0 END),0)::text AS expense
         FROM arka.v_profit_and_loss`,
      ),
      this.db.query(
        `SELECT status, count(*)::int AS n FROM arka.projects
          WHERE deleted_at IS NULL GROUP BY status`,
      ),
      this.db.query(
        `SELECT count(*)::int AS n FROM arka.projects
          WHERE deleted_at IS NULL AND due_on < current_date
            AND status NOT IN ('DELIVERED','CLOSED','CANCELLED')`,
      ),
      this.db.query(
        `SELECT entry_no, entry_date, memo, status,
                (SELECT COALESCE(SUM(debit),0) FROM arka.journal_lines l WHERE l.entry_id = je.id)::text AS amount
           FROM arka.journal_entries je
          WHERE deleted_at IS NULL
          ORDER BY entry_no DESC LIMIT 8`,
      ),
      this.db.query(
        `SELECT customer_code, display_name, receivable_balance::text AS balance
           FROM arka.v_ar_aging WHERE receivable_balance > 0
          ORDER BY receivable_balance DESC LIMIT 5`,
      ),
      this.db.query(
        `SELECT je.entry_date::text AS d,
                COALESCE(SUM(CASE WHEN a.account_type='INCOME' THEN jl.credit - jl.debit ELSE 0 END),0)::text AS income
           FROM arka.journal_entries je
           JOIN arka.journal_lines jl ON jl.entry_id = je.id
           JOIN arka.accounts a ON a.id = jl.account_id
          WHERE je.status='POSTED' AND je.deleted_at IS NULL AND a.account_type='INCOME'
          GROUP BY je.entry_date ORDER BY je.entry_date`,
      ),
    ]);

    const income = BigInt(pl[0]?.income ?? '0');
    const expense = BigInt(pl[0]?.expense ?? '0');

    return {
      cashPosition: cash[0]?.v ?? '0',
      totalReceivables: receivables[0]?.v ?? '0',
      totalPayables: payables[0]?.v ?? '0',
      revenue: income.toString(),
      expenses: expense.toString(),
      netProfit: (income - expense).toString(),
      projectsByStatus: projects,
      overdueProjects: overdue[0]?.n ?? 0,
      recentEntries: recent,
      topDebtors,
      revenueTrend,
      generatedAt: new Date().toISOString(),
    };
  }
}

@Controller({ path: 'dashboard', version: '1' })
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('ceo')
  @RequirePermissions('report.ceo')
  ceo() {
    return this.dashboard.ceoSnapshot();
  }
}

@Module({
  providers: [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {}
