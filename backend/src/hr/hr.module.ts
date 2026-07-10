import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Module,
  Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import {
  IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength,
} from 'class-validator';
import { DatabaseService } from '../common/database/database.service';
import { EnvelopeService } from '../common/crypto/envelope.service';
import { CurrentUser, RequirePermissions } from '../common/auth/decorators';
import { AuthUser } from '../common/auth/auth.types';

// ---------------------------------------------------------------------------
//  DTOs
// ---------------------------------------------------------------------------
class PositionDto {
  @IsString() @MaxLength(120) title!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}

class UpsertPersonnelDto {
  @IsOptional() @IsUUID() userId?: string;            // link to a login account
  @IsOptional() @IsString() @MaxLength(120) firstName?: string;
  @IsOptional() @IsString() @MaxLength(120) lastName?: string;
  @IsOptional() @IsString() @MaxLength(20) nationalId?: string;   // encrypted at rest
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsString() @MaxLength(20) gender?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(320) email?: string;
  @IsOptional() @IsString() @MaxLength(1000) address?: string;
  @IsOptional() @IsUUID() positionId?: string;
  @IsOptional() @IsString() @MaxLength(120) department?: string;
  @IsOptional() @IsDateString() hireDate?: string;
  @IsOptional() @IsString() baseSalary?: string;      // Rial integer string
  @IsOptional() @IsString() @MaxLength(40) iban?: string;         // encrypted at rest
  @IsOptional() @IsIn(['ACTIVE','ON_LEAVE','TERMINATED']) employmentStatus?: string;
  @IsOptional() @IsString() @MaxLength(200) emergencyContact?: string;
}

class DeleteDto { @IsString() @MaxLength(500) reason!: string; }

// ---------------------------------------------------------------------------
//  Services
// ---------------------------------------------------------------------------
@Injectable()
export class HrService {
  constructor(
    private readonly db: DatabaseService,
    private readonly envelope: EnvelopeService,
  ) {}

  // -- positions --
  listPositions() {
    return this.db.query(
      `SELECT p.id, p.title, p.description,
              (SELECT count(*) FROM arka.personnel n WHERE n.position_id = p.id AND n.deleted_at IS NULL)::int AS headcount
         FROM arka.positions p ORDER BY p.title`,
    );
  }
  createPosition(dto: PositionDto) {
    return this.db.withActor(async (m) => {
      const [row] = await m.query(
        `INSERT INTO arka.positions (title, description) VALUES ($1,$2) RETURNING id, title`,
        [dto.title, dto.description ?? null],
      );
      return row;
    });
  }
  async deletePosition(id: string) {
    await this.db.query(`DELETE FROM arka.positions WHERE id = $1`, [id]);
    return { deleted: true };
  }

  // -- personnel --
  list() {
    return this.db.query(
      `SELECT id, employee_code, user_id, full_name, first_name, last_name,
              national_id_last4, phone, email, position_title, department,
              hire_date, base_salary::text AS base_salary, iban_last4,
              employment_status, login_email
         FROM arka.v_personnel WHERE deleted_at IS NULL ORDER BY employee_code`,
    );
  }

  async get(id: string) {
    const [row] = await this.db.query(
      `SELECT id, employee_code, user_id, first_name, last_name, full_name,
              national_id_last4, birth_date, gender, phone, email, address,
              position_id, position_title, department, hire_date,
              base_salary::text AS base_salary, iban_last4, employment_status,
              emergency_contact, login_email
         FROM arka.v_personnel WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return row;
  }

  /** The personnel record linked to the currently-logged-in user (self view). */
  async mine(userId: string) {
    const [row] = await this.db.query(
      `SELECT id, employee_code, full_name, first_name, last_name, national_id_last4,
              birth_date, gender, phone, email, address, position_title, department,
              hire_date, base_salary::text AS base_salary, iban_last4, employment_status
         FROM arka.v_personnel WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    return row ?? null;
  }

  create(dto: UpsertPersonnelDto) {
    if (!dto.firstName?.trim() || !dto.lastName?.trim()) {
      throw new BadRequestException('First and last name are required');
    }
    const natEnc = this.envelope.encrypt(dto.nationalId);
    const ibanEnc = this.envelope.encrypt(dto.iban);
    return this.db.withActor(async (m) => {
      const [row] = await m.query(
        `INSERT INTO arka.personnel
           (employee_code, user_id, first_name, last_name, national_id_enc, national_id_last4,
            birth_date, gender, phone, email, address, position_id, department, hire_date,
            base_salary, iban_enc, iban_last4, employment_status, emergency_contact, created_by)
         VALUES ('EMP-'||nextval('arka.seq_employee_code'), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                 COALESCE($14,0),$15,$16, COALESCE($17,'ACTIVE'),$18, arka.current_actor_id())
         RETURNING id, employee_code, first_name, last_name`,
        [dto.userId ?? null, dto.firstName, dto.lastName, natEnc, this.envelope.last4(dto.nationalId),
         dto.birthDate ?? null, dto.gender ?? null, dto.phone ?? null, dto.email ?? null, dto.address ?? null,
         dto.positionId ?? null, dto.department ?? null, dto.hireDate ?? null, dto.baseSalary ?? null,
         ibanEnc, this.envelope.last4(dto.iban), dto.employmentStatus ?? null, dto.emergencyContact ?? null],
      );
      return row;
    });
  }

  async update(id: string, dto: UpsertPersonnelDto) {
    const natEnc = dto.nationalId !== undefined ? this.envelope.encrypt(dto.nationalId) : null;
    const ibanEnc = dto.iban !== undefined ? this.envelope.encrypt(dto.iban) : null;
    await this.db.withActor(async (m) => {
      await m.query(
        `UPDATE arka.personnel SET
            user_id = COALESCE($2, user_id),
            first_name = COALESCE($3, first_name), last_name = COALESCE($4, last_name),
            national_id_enc = COALESCE($5, national_id_enc), national_id_last4 = COALESCE($6, national_id_last4),
            birth_date = COALESCE($7, birth_date), gender = COALESCE($8, gender),
            phone = COALESCE($9, phone), email = COALESCE($10, email), address = COALESCE($11, address),
            position_id = COALESCE($12, position_id), department = COALESCE($13, department),
            hire_date = COALESCE($14, hire_date), base_salary = COALESCE($15, base_salary),
            iban_enc = COALESCE($16, iban_enc), iban_last4 = COALESCE($17, iban_last4),
            employment_status = COALESCE($18, employment_status),
            emergency_contact = COALESCE($19, emergency_contact)
          WHERE id = $1 AND deleted_at IS NULL`,
        [id, dto.userId ?? null, dto.firstName ?? null, dto.lastName ?? null,
         natEnc, dto.nationalId !== undefined ? this.envelope.last4(dto.nationalId) : null,
         dto.birthDate ?? null, dto.gender ?? null, dto.phone ?? null, dto.email ?? null, dto.address ?? null,
         dto.positionId ?? null, dto.department ?? null, dto.hireDate ?? null, dto.baseSalary ?? null,
         ibanEnc, dto.iban !== undefined ? this.envelope.last4(dto.iban) : null,
         dto.employmentStatus ?? null, dto.emergencyContact ?? null],
      );
    });
    return this.get(id);
  }

  async softDelete(id: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('A deletion reason is required');
    await this.db.withActor(async (m) => {
      await m.query(
        `UPDATE arka.personnel SET deleted_at = now(), deleted_by = arka.current_actor_id(), deleted_reason = $2
          WHERE id = $1 AND deleted_at IS NULL`,
        [id, reason.trim()],
      );
    });
    return { deleted: true };
  }

  trash() {
    return this.db.query(
      `SELECT p.id, p.employee_code, (p.first_name||' '||p.last_name) AS full_name,
              p.deleted_at, p.deleted_reason, u.full_name AS deleted_by_name
         FROM arka.personnel p LEFT JOIN arka.users u ON u.id = p.deleted_by
        WHERE p.deleted_at IS NOT NULL ORDER BY p.deleted_at DESC`,
    );
  }

  async restore(id: string) {
    await this.db.query(
      `UPDATE arka.personnel SET deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL
        WHERE id = $1 AND deleted_at IS NOT NULL`,
      [id],
    );
    return { restored: true };
  }
}

// ---------------------------------------------------------------------------
//  Controllers
// ---------------------------------------------------------------------------
@Controller({ path: 'positions', version: '1' })
export class PositionsController {
  constructor(private readonly hr: HrService) {}
  @Get() @RequirePermissions('hr.view') list() { return this.hr.listPositions(); }
  @Post() @RequirePermissions('hr.manage') create(@Body() dto: PositionDto) { return this.hr.createPosition(dto); }
  @Delete(':id') @RequirePermissions('hr.manage') remove(@Param('id', ParseUUIDPipe) id: string) { return this.hr.deletePosition(id); }
}

@Controller({ path: 'personnel', version: '1' })
export class PersonnelController {
  constructor(private readonly hr: HrService) {}

  /** Self-service: the caller's own personnel record (no special permission). */
  @Get('me') me(@CurrentUser() u: AuthUser) { return this.hr.mine(u.id); }

  @Get() @RequirePermissions('hr.view') list() { return this.hr.list(); }
  @Get('trash') @RequirePermissions('hr.manage') trash() { return this.hr.trash(); }
  @Get(':id') @RequirePermissions('hr.view') get(@Param('id', ParseUUIDPipe) id: string) { return this.hr.get(id); }
  @Post() @RequirePermissions('hr.manage') create(@Body() dto: UpsertPersonnelDto) { return this.hr.create(dto); }
  @Patch(':id') @RequirePermissions('hr.manage') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertPersonnelDto) { return this.hr.update(id, dto); }
  @Delete(':id') @RequirePermissions('hr.manage') remove(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeleteDto) { return this.hr.softDelete(id, dto.reason); }
  @Post(':id/restore') @RequirePermissions('hr.manage') restore(@Param('id', ParseUUIDPipe) id: string) { return this.hr.restore(id); }
}

@Module({
  providers: [HrService],
  controllers: [PositionsController, PersonnelController],
  exports: [HrService],
})
export class HrModule {}
