import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';
import { CreateAccountDto } from './dto/account.dto';

@Injectable()
export class AccountsService {
  constructor(private readonly db: DatabaseService) {}

  /** Full hierarchical chart of accounts (ordered as a tree). */
  tree() {
    return this.db.query(
      `SELECT id, code, name, account_type, normal_balance, parent_id, is_postable,
              is_active, balance::text AS balance, depth, path_display
         FROM arka.v_account_tree
        ORDER BY path_codes`,
    );
  }

  /** Flat list of postable accounts (for journal-entry pickers). */
  postable() {
    return this.db.query(
      `SELECT id, code, name, account_type, normal_balance, balance::text AS balance
         FROM arka.accounts
        WHERE is_postable AND is_active AND deleted_at IS NULL
        ORDER BY code`,
    );
  }

  async getById(id: string) {
    const rows = await this.db.query(
      `SELECT id, code, name, account_type, normal_balance, parent_id, is_postable,
              is_active, currency, balance::text AS balance, balance_version
         FROM arka.accounts WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Account not found');
    return rows[0];
  }

  async create(dto: CreateAccountDto) {
    return this.db.withActor(async (m) => {
      const rows = await m.query(
        `INSERT INTO arka.accounts (code, name, account_type, normal_balance, parent_id, description)
         VALUES ($1,$2,$3::arka.account_type,$4::arka.normal_balance,$5,$6)
         RETURNING id, code, name, account_type, normal_balance, parent_id, is_postable`,
        [dto.code, dto.name, dto.accountType, dto.normalBalance, dto.parentId ?? null, dto.description ?? null],
      );
      return rows[0];
    });
  }
}
