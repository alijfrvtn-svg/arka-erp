import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';
import { PasswordService } from '../common/crypto/password.service';

export interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  password_hash: string;
  mfa_enabled: boolean;
  mfa_secret_enc: Buffer | null;
  is_active: boolean;
  failed_logins: number;
  locked_until: Date | null;
}

const ROLES = ['CEO','ACCOUNTANT','SALES','DESIGNER','DEVELOPER','PHOTOGRAPHER','CUSTOMER','GUEST'];

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly password: PasswordService,
  ) {}

  private readonly SELECT_COLS =
    `id, email, full_name, role, password_hash, mfa_enabled, mfa_secret_enc,
     is_active, failed_logins, locked_until`;

  /** TypeORM returns `[rows, affectedCount]` for UPDATE ... RETURNING but the
   *  plain rows array for INSERT/SELECT. Normalise to the first row. */
  private firstRow(res: any): any {
    const rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res;
    return rows?.[0];
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const rows = await this.db.query<UserRow>(
      `SELECT ${this.SELECT_COLS} FROM arka.users
        WHERE lower(email) = lower($1) AND deleted_at IS NULL LIMIT 1`,
      [email],
    );
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const rows = await this.db.query<UserRow>(
      `SELECT ${this.SELECT_COLS} FROM arka.users
        WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async permissionsForRole(role: string): Promise<string[]> {
    const rows = await this.db.query<{ permission: string }>(
      `SELECT permission FROM arka.role_permissions WHERE role = $1::arka.user_role ORDER BY permission`,
      [role],
    );
    return rows.map((r) => r.permission);
  }

  /** Custom per-user grants replace role defaults when present. */
  async effectivePermissions(userId: string, role: string): Promise<string[]> {
    const custom = await this.db.query<{ permission: string }>(
      `SELECT permission FROM arka.user_permissions WHERE user_id = $1 ORDER BY permission`,
      [userId],
    );
    if (custom.length > 0) return custom.map((r) => r.permission);
    return this.permissionsForRole(role);
  }

  /** Full catalogue of assignable permissions (for the create/edit checkboxes). */
  permissionCatalog() {
    return this.db.query(
      `SELECT code, description, category FROM arka.permissions ORDER BY category, code`,
    );
  }

  /** Replace a user's explicit permission set (empty array ⇒ back to role defaults). */
  async setUserPermissions(userId: string, permissions: string[]): Promise<{ permissions: string[] }> {
    await this.db.withActor(async (m) => {
      await m.query(`DELETE FROM arka.user_permissions WHERE user_id = $1`, [userId]);
      for (const p of permissions) {
        await m.query(
          `INSERT INTO arka.user_permissions (user_id, permission) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [userId, p],
        );
      }
    });
    return { permissions };
  }

  async getDetail(id: string) {
    const [u] = await this.db.query(
      `SELECT id, email, full_name, role, is_active, mfa_enabled, created_at
         FROM arka.users WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!u) throw new NotFoundException('User not found');
    const custom = await this.db.query<{ permission: string }>(
      `SELECT permission FROM arka.user_permissions WHERE user_id = $1`,
      [id],
    );
    return {
      ...u,
      hasCustomPermissions: custom.length > 0,
      permissions: await this.effectivePermissions(id, (u as any).role),
    };
  }

  async registerSuccessfulLogin(id: string): Promise<void> {
    await this.db.query(
      `UPDATE arka.users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`,
      [id],
    );
  }

  async registerFailedLogin(id: string): Promise<void> {
    await this.db.query(
      `UPDATE arka.users
          SET failed_logins = failed_logins + 1,
              locked_until = CASE WHEN failed_logins + 1 >= 5
                                  THEN now() + interval '15 minutes' ELSE locked_until END
        WHERE id = $1`,
      [id],
    );
  }

  // ---- MFA state ------------------------------------------------------------
  async setMfaSecret(id: string, secretEnc: Buffer): Promise<void> {
    await this.db.query(`UPDATE arka.users SET mfa_secret_enc = $2, mfa_enabled = false WHERE id = $1`, [id, secretEnc]);
  }
  async enableMfa(id: string): Promise<void> {
    await this.db.query(`UPDATE arka.users SET mfa_enabled = true WHERE id = $1`, [id]);
  }
  async clearMfa(id: string): Promise<void> {
    await this.db.query(`UPDATE arka.users SET mfa_enabled = false, mfa_secret_enc = NULL WHERE id = $1`, [id]);
  }

  // ---- credentials ----------------------------------------------------------
  async setPasswordHash(id: string, hash: string): Promise<void> {
    await this.db.query(
      `UPDATE arka.users SET password_hash = $2, password_changed_at = now() WHERE id = $1`,
      [id, hash],
    );
  }

  /** Lightweight team directory (id + name) for task assignment pickers. */
  directory() {
    return this.db.query(
      `SELECT id, full_name, role FROM arka.users
        WHERE deleted_at IS NULL AND is_active ORDER BY full_name`,
    );
  }

  // ---- admin CRUD -----------------------------------------------------------
  list() {
    return this.db.query(
      `SELECT id, email, full_name, role, is_active, mfa_enabled, last_login_at, created_at
         FROM arka.users WHERE deleted_at IS NULL ORDER BY created_at`,
    );
  }

  async create(dto: {
    email: string; fullName: string; role: string; password: string;
    isActive?: boolean; permissions?: string[];
  }) {
    if (!ROLES.includes(dto.role)) throw new BadRequestException('Invalid role');
    const exists = await this.findByEmail(dto.email);
    if (exists) throw new BadRequestException('A user with this email already exists');
    const hash = await this.password.hash(dto.password);
    return this.db.withActor(async (m) => {
      const [row] = await m.query(
        `INSERT INTO arka.users (email, full_name, role, password_hash, is_active)
         VALUES ($1,$2,$3::arka.user_role,$4,COALESCE($5,true))
         RETURNING id, email, full_name, role, is_active, mfa_enabled`,
        [dto.email.trim(), dto.fullName, dto.role, hash, dto.isActive ?? true],
      );
      if (dto.permissions && dto.permissions.length > 0) {
        for (const p of dto.permissions) {
          await m.query(
            `INSERT INTO arka.user_permissions (user_id, permission) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [row.id, p],
          );
        }
      }
      return row;
    });
  }

  async updateUser(id: string, dto: { fullName?: string; role?: string; isActive?: boolean }) {
    if (dto.role && !ROLES.includes(dto.role)) throw new BadRequestException('Invalid role');
    const target = await this.findById(id);
    if (!target) throw new NotFoundException('User not found');
    return this.db.withActor(async (m) => {
      const res = await m.query(
        `UPDATE arka.users
            SET full_name = COALESCE($2, full_name),
                role      = COALESCE($3::arka.user_role, role),
                is_active = COALESCE($4, is_active)
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING id, email, full_name, role, is_active, mfa_enabled`,
        [id, dto.fullName ?? null, dto.role ?? null, dto.isActive ?? null],
      );
      return this.firstRow(res);
    });
  }

  async updateProfile(id: string, dto: { fullName?: string; email?: string }) {
    if (dto.email) {
      const other = await this.findByEmail(dto.email);
      if (other && other.id !== id) throw new BadRequestException('Email already in use');
    }
    return this.db.withActor(async (m) => {
      const res = await m.query(
        `UPDATE arka.users
            SET full_name = COALESCE($2, full_name), email = COALESCE($3, email)
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING id, email, full_name, role, is_active, mfa_enabled`,
        [id, dto.fullName ?? null, dto.email?.trim() ?? null],
      );
      return this.firstRow(res);
    });
  }

  async adminResetPassword(id: string, newPassword: string) {
    const hash = await this.password.hash(newPassword);
    await this.db.withActor(async (m) => {
      await m.query(`UPDATE arka.users SET password_hash = $2, password_changed_at = now() WHERE id = $1`, [id, hash]);
      await m.query(`UPDATE arka.refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
    });
    return { reset: true };
  }

  async softDelete(id: string, actingUserId: string) {
    if (id === actingUserId) throw new BadRequestException('You cannot delete your own account');
    const target = await this.findById(id);
    if (!target) throw new NotFoundException('User not found');
    await this.db.withActor(async (m) => {
      await m.query(`UPDATE arka.users SET deleted_at = now(), is_active = false WHERE id = $1`, [id]);
      await m.query(`UPDATE arka.refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
    });
    return { deleted: true };
  }
}
