import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DatabaseService } from '../common/database/database.service';
import { CreateJournalDto, TransferDto } from './dto/journal.dto';

@Injectable()
export class JournalService {
  constructor(private readonly db: DatabaseService) {}

  // ---- reads ----------------------------------------------------------------
  list(params: { status?: string; limit?: number; offset?: number }) {
    const limit = Math.min(params.limit ?? 50, 200);
    const offset = params.offset ?? 0;
    return this.db.query(
      `SELECT je.id, je.entry_no, je.entry_date, je.memo, je.reference, je.source,
              je.status, je.project_id, je.customer_id, je.posted_at,
              COALESCE(SUM(jl.debit),0)::text AS total_debit,
              COALESCE(SUM(jl.credit),0)::text AS total_credit,
              count(jl.id) AS line_count
         FROM arka.journal_entries je
         LEFT JOIN arka.journal_lines jl ON jl.entry_id = je.id
        WHERE je.deleted_at IS NULL
          AND ($1::arka.journal_status IS NULL OR je.status = $1::arka.journal_status)
        GROUP BY je.id
        ORDER BY je.entry_no DESC
        LIMIT $2 OFFSET $3`,
      [params.status ?? null, limit, offset],
    );
  }

  async getById(id: string) {
    const header = await this.db.query(
      `SELECT id, entry_no, entry_date, memo, reference, source, status,
              project_id, customer_id, reversed_entry_id, posted_at, posted_by, created_at
         FROM arka.journal_entries WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!header[0]) throw new NotFoundException('Journal entry not found');
    const lines = await this.db.query(
      `SELECT jl.id, jl.line_no, jl.account_id, a.code AS account_code, a.name AS account_name,
              jl.debit::text AS debit, jl.credit::text AS credit, jl.memo, jl.project_id
         FROM arka.journal_lines jl
         JOIN arka.accounts a ON a.id = jl.account_id
        WHERE jl.entry_id = $1
        ORDER BY jl.line_no`,
      [id],
    );
    return { ...header[0], lines };
  }

  // ---- writes ---------------------------------------------------------------
  private assertBalanced(dto: CreateJournalDto): void {
    let debit = 0n;
    let credit = 0n;
    dto.lines.forEach((l, i) => {
      const d = BigInt(l.debit || '0');
      const c = BigInt(l.credit || '0');
      if ((d > 0n && c > 0n) || (d === 0n && c === 0n)) {
        throw new BadRequestException(`Line ${i + 1} must be exactly one of debit or credit`);
      }
      debit += d;
      credit += c;
    });
    if (debit !== credit) {
      throw new BadRequestException(`Entry is unbalanced: debit=${debit} credit=${credit}`);
    }
  }

  async createDraft(dto: CreateJournalDto): Promise<any> {
    this.assertBalanced(dto);
    // Do the writes in the audited transaction, then read AFTER it commits
    // (getById uses a separate pooled connection and cannot see uncommitted rows).
    const entryId = await this.db.withActor(async (m) => {
      const [entry] = await m.query(
        `INSERT INTO arka.journal_entries
           (memo, entry_date, reference, source, project_id, customer_id, created_by)
         VALUES ($1,$2,$3,COALESCE($4,'MANUAL'),$5,$6, arka.current_actor_id())
         RETURNING id`,
        [dto.memo, dto.entryDate, dto.reference ?? null, dto.source ?? null,
         dto.projectId ?? null, dto.customerId ?? null],
      );
      await this.insertLines(m, entry.id, dto.lines);
      return entry.id as string;
    });
    return this.getById(entryId);
  }

  private async insertLines(m: EntityManager, entryId: string, lines: CreateJournalDto['lines']) {
    let lineNo = 1;
    for (const l of lines) {
      await m.query(
        `INSERT INTO arka.journal_lines (entry_id, line_no, account_id, debit, credit, memo, project_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [entryId, lineNo++, l.accountId, l.debit || '0', l.credit || '0', l.memo ?? null, l.projectId ?? null],
      );
    }
  }

  /** Create + immediately post a two-legged fund transfer (critical action). */
  async transfer(dto: TransferDto): Promise<any> {
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException('Source and destination must differ');
    }
    const create: CreateJournalDto = {
      memo: dto.memo,
      entryDate: dto.entryDate ?? new Date().toISOString().slice(0, 10),
      source: 'MANUAL',
      lines: [
        { accountId: dto.toAccountId, debit: dto.amount, credit: '0' },
        { accountId: dto.fromAccountId, debit: '0', credit: dto.amount },
      ],
    };
    const draft = await this.createDraft(create);
    return this.post(draft.id);
  }

  async post(entryId: string): Promise<any> {
    await this.db.withActor(async (m) => {
      await m.query(`SELECT arka.fn_post_journal_entry($1, arka.current_actor_id())`, [entryId]);
    });
    return this.getById(entryId);
  }

  async reverse(entryId: string, date?: string, memo?: string): Promise<any> {
    const result = await this.db.withActor(async (m) => {
      const [row] = await m.query(
        `SELECT (arka.fn_reverse_journal_entry($1, arka.current_actor_id(), $2, $3)).id AS id`,
        [entryId, date ?? null, memo ?? null],
      );
      return row.id as string;
    });
    return this.getById(result);
  }

  private async assertDraft(entryId: string): Promise<void> {
    const [e] = await this.db.query<{ status: string }>(
      `SELECT status FROM arka.journal_entries WHERE id = $1 AND deleted_at IS NULL`,
      [entryId],
    );
    if (!e) throw new NotFoundException('Journal entry not found');
    if (e.status !== 'DRAFT') {
      throw new BadRequestException(
        'Only DRAFT entries can be edited or deleted. Posted entries must be reversed to preserve the audit trail.',
      );
    }
  }

  /** Replace a draft's header + lines (drafts only). */
  async updateDraft(entryId: string, dto: CreateJournalDto): Promise<any> {
    await this.assertDraft(entryId);
    this.assertBalanced(dto);
    await this.db.withActor(async (m) => {
      await m.query(
        `UPDATE arka.journal_entries
            SET memo = $2, entry_date = $3, reference = $4,
                source = COALESCE($5,'MANUAL'), project_id = $6, customer_id = $7
          WHERE id = $1`,
        [entryId, dto.memo, dto.entryDate, dto.reference ?? null, dto.source ?? null,
         dto.projectId ?? null, dto.customerId ?? null],
      );
      await m.query(`DELETE FROM arka.journal_lines WHERE entry_id = $1`, [entryId]);
      await this.insertLines(m, entryId, dto.lines);
    });
    return this.getById(entryId);
  }

  /** Soft-delete a draft with a mandatory reason (posted entries → reverse). */
  async deleteDraft(entryId: string, reason: string): Promise<{ deleted: boolean }> {
    if (!reason?.trim()) throw new BadRequestException('A deletion reason is required');
    await this.assertDraft(entryId);
    await this.db.withActor(async (m) => {
      await m.query(
        `UPDATE arka.journal_entries
            SET deleted_at = now(), deleted_by = arka.current_actor_id(), deleted_reason = $2
          WHERE id = $1`,
        [entryId, reason.trim()],
      );
    });
    return { deleted: true };
  }

  /** Deleted drafts (recycle bin) with who/when/why. */
  trash() {
    return this.db.query(
      `SELECT je.id, je.entry_no, je.memo, je.entry_date, je.deleted_at, je.deleted_reason,
              u.full_name AS deleted_by_name
         FROM arka.journal_entries je
         LEFT JOIN arka.users u ON u.id = je.deleted_by
        WHERE je.deleted_at IS NOT NULL
        ORDER BY je.deleted_at DESC`,
    );
  }

  async restore(entryId: string): Promise<{ restored: boolean }> {
    await this.db.withActor(async (m) => {
      await m.query(
        `UPDATE arka.journal_entries
            SET deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL
          WHERE id = $1 AND deleted_at IS NOT NULL AND status = 'DRAFT'`,
        [entryId],
      );
    });
    return { restored: true };
  }
}
