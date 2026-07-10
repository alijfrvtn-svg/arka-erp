import {
  BadRequestException, Body, Controller, Get, Injectable, Module,
  Param, ParseUUIDPipe, Post,
} from '@nestjs/common';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { DatabaseService } from '../common/database/database.service';
import { RequirePermissions } from '../common/auth/decorators';

class CreateRunDto {
  @IsString() @MaxLength(20) periodCode!: string;               // e.g. 1405-04
  @IsOptional() @IsNumber() @Min(0) @Max(100) taxPct?: number;         // default 10
  @IsOptional() @IsNumber() @Min(0) @Max(100) insurancePct?: number;   // default 7
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

@Injectable()
export class PayrollService {
  constructor(private readonly db: DatabaseService) {}

  listRuns() {
    return this.db.query(
      `SELECT r.id, r.period_code, r.run_date, r.status, r.total_net::text AS total_net,
              r.journal_entry_id, je.entry_no AS journal_no,
              (SELECT count(*) FROM arka.payslips s WHERE s.run_id = r.id)::int AS headcount,
              u.full_name AS created_by_name
         FROM arka.payroll_runs r
         LEFT JOIN arka.journal_entries je ON je.id = r.journal_entry_id
         LEFT JOIN arka.users u ON u.id = r.created_by
        ORDER BY r.run_date DESC, r.period_code DESC`,
    );
  }

  async getRun(id: string) {
    const [run] = await this.db.query(
      `SELECT r.*, r.total_net::text AS total_net FROM arka.payroll_runs r WHERE r.id = $1`, [id]);
    if (!run) throw new BadRequestException('Payroll run not found');
    const slips = await this.db.query(
      `SELECT s.id, s.personnel_id, (p.first_name||' '||p.last_name) AS personnel_name, p.employee_code,
              s.base_salary::text AS base_salary, s.additions::text AS additions,
              s.deductions::text AS deductions, s.tax::text AS tax, s.insurance::text AS insurance,
              s.net::text AS net
         FROM arka.payslips s JOIN arka.personnel p ON p.id = s.personnel_id
        WHERE s.run_id = $1 ORDER BY p.employee_code`,
      [id],
    );
    return { ...run, payslips: slips };
  }

  async createRun(dto: CreateRunDto) {
    const taxPct = dto.taxPct ?? 10;
    const insPct = dto.insurancePct ?? 7;

    const active = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM arka.personnel WHERE employment_status='ACTIVE' AND deleted_at IS NULL AND base_salary > 0`,
    );
    if ((active[0]?.n ?? 0) === 0) {
      throw new BadRequestException('No active personnel with a salary to run payroll for');
    }

    const runId = await this.db.withActor(async (m) => {
      const dup = await m.query(`SELECT 1 FROM arka.payroll_runs WHERE period_code = $1`, [dto.periodCode]);
      if (dup.length) throw new BadRequestException(`A payroll run already exists for period ${dto.periodCode}`);

      const [run] = await m.query(
        `INSERT INTO arka.payroll_runs (period_code, notes, created_by)
         VALUES ($1,$2, arka.current_actor_id()) RETURNING id`,
        [dto.periodCode, dto.notes ?? null],
      );
      await m.query(
        `INSERT INTO arka.payslips (run_id, personnel_id, base_salary, additions, deductions, tax, insurance, net, detail)
         SELECT $1, p.id, p.base_salary, 0, 0,
                trunc(p.base_salary * $2 / 100.0),
                trunc(p.base_salary * $3 / 100.0),
                p.base_salary - trunc(p.base_salary * $2 / 100.0) - trunc(p.base_salary * $3 / 100.0),
                jsonb_build_object('taxPct', $2, 'insurancePct', $3)
           FROM arka.personnel p
          WHERE p.employment_status='ACTIVE' AND p.deleted_at IS NULL AND p.base_salary > 0`,
        [run.id, taxPct, insPct],
      );
      await m.query(
        `UPDATE arka.payroll_runs SET total_net = (SELECT COALESCE(SUM(net),0) FROM arka.payslips WHERE run_id = $1) WHERE id = $1`,
        [run.id],
      );
      return run.id as string;
    });
    return this.getRun(runId);   // read after commit so the new rows are visible
  }

  /** Post a payroll run to the ledger:
   *    Dr Salaries & Wages (5010)      = gross
   *    Cr Salaries Payable (2020)      = net
   *    Cr Taxes Payable    (2050)      = tax
   *    Cr Insurance Payable(2040)      = insurance
   */
  async postRun(id: string) {
    await this.db.withActor(async (m) => {
      const [run] = await m.query(`SELECT * FROM arka.payroll_runs WHERE id = $1 FOR UPDATE`, [id]);
      if (!run) throw new BadRequestException('Payroll run not found');
      if (run.status === 'POSTED') throw new BadRequestException('This payroll run is already posted');

      const [tot] = await m.query(
        `SELECT COALESCE(SUM(base_salary + additions),0)::text AS gross,
                COALESCE(SUM(net),0)::text       AS net,
                COALESCE(SUM(tax),0)::text       AS tax,
                COALESCE(SUM(insurance),0)::text AS insurance
           FROM arka.payslips WHERE run_id = $1`,
        [id],
      );
      const gross = BigInt(tot.gross), net = BigInt(tot.net), tax = BigInt(tot.tax), insurance = BigInt(tot.insurance);
      if (gross === 0n) throw new BadRequestException('Nothing to post');

      const acc = async (code: string) => {
        const [a] = await m.query(`SELECT id FROM arka.accounts WHERE code = $1 AND deleted_at IS NULL`, [code]);
        if (!a) throw new BadRequestException(`Account ${code} is missing from the chart of accounts`);
        return a.id as string;
      };
      const [a5010, a2020, a2050, a2040] = [await acc('5010'), await acc('2020'), await acc('2050'), await acc('2040')];

      const [entry] = await m.query(
        `INSERT INTO arka.journal_entries (memo, entry_date, source, reference, created_by)
         VALUES ($1, current_date, 'PAYROLL', $2, arka.current_actor_id()) RETURNING id`,
        [`حقوق و دستمزد دوره ${run.period_code}`, `PAY-${run.period_code}`],
      );

      const lines: Array<[string, bigint, bigint]> = [[a5010, gross, 0n], [a2020, net, 0n]];
      // credits: 2020 net, 2050 tax, 2040 insurance
      lines[1] = [a2020, 0n, net];
      if (tax > 0n) lines.push([a2050, 0n, tax]);
      if (insurance > 0n) lines.push([a2040, 0n, insurance]);

      let ln = 1;
      for (const [accId, d, c] of lines) {
        await m.query(
          `INSERT INTO arka.journal_lines (entry_id, line_no, account_id, debit, credit)
           VALUES ($1,$2,$3,$4,$5)`,
          [entry.id, ln++, accId, d.toString(), c.toString()],
        );
      }
      await m.query(`SELECT arka.fn_post_journal_entry($1, arka.current_actor_id())`, [entry.id]);
      await m.query(`UPDATE arka.payroll_runs SET status='POSTED', journal_entry_id = $2 WHERE id = $1`, [id, entry.id]);
    });
    return this.getRun(id);   // read after commit
  }
}

@Controller({ path: 'payroll', version: '1' })
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('runs') @RequirePermissions('payroll.run') list() { return this.payroll.listRuns(); }
  @Get('runs/:id') @RequirePermissions('payroll.run') get(@Param('id', ParseUUIDPipe) id: string) { return this.payroll.getRun(id); }
  @Post('runs') @RequirePermissions('payroll.run') create(@Body() dto: CreateRunDto) { return this.payroll.createRun(dto); }
  @Post('runs/:id/post') @RequirePermissions('payroll.run') post(@Param('id', ParseUUIDPipe) id: string) { return this.payroll.postRun(id); }
}

@Module({
  providers: [PayrollService],
  controllers: [PayrollController],
})
export class PayrollModule {}
