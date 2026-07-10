import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { DatabaseService } from '../common/database/database.service';
import { CurrentUser, RequirePermissions } from '../common/auth/decorators';
import { AuthUser } from '../common/auth/auth.types';

const STATUSES = ['LEAD','PROPOSAL','CONTRACT','ACTIVE','ON_HOLD','DELIVERED','CLOSED','CANCELLED'];

class UpsertProjectDto {
  @IsOptional() @IsString() @MaxLength(50) code?: string;   // auto-generated when omitted
  @IsOptional() @IsString() @MaxLength(200) name?: string;  // required on create (checked in service)
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() managerId?: string;
  @IsOptional() @IsIn(STATUSES) status?: string;
  @IsOptional() @IsString() budget?: string;
  @IsOptional() @IsString() contractValue?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) progressPct?: number;
  @IsOptional() @IsDateString() startsOn?: string;
  @IsOptional() @IsDateString() dueOn?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

class DeleteDto {
  @IsString() @MaxLength(500) reason!: string;   // mandatory reason
}

@Injectable()
export class ProjectsService {
  constructor(private readonly db: DatabaseService) {}

  list() {
    return this.db.query(
      `SELECT p.id, p.code, p.name, p.status, p.budget::text AS budget,
              p.contract_value::text AS contract_value, p.cost_to_date::text AS cost_to_date,
              p.progress_pct, p.starts_on, p.due_on, p.delivered_on, p.customer_id, p.description,
              c.display_name AS customer_name, u.full_name AS manager_name
         FROM arka.projects p
         LEFT JOIN arka.customers c ON c.id = p.customer_id
         LEFT JOIN arka.users u ON u.id = p.manager_id
        WHERE p.deleted_at IS NULL
        ORDER BY p.created_at DESC`,
    );
  }

  async get(id: string) {
    const [row] = await this.db.query(
      `SELECT p.*, p.budget::text AS budget, p.contract_value::text AS contract_value,
              c.display_name AS customer_name
         FROM arka.projects p LEFT JOIN arka.customers c ON c.id = p.customer_id
        WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [id],
    );
    return row;
  }

  create(dto: UpsertProjectDto) {
    if (!dto.name?.trim()) throw new BadRequestException('Project name is required');
    return this.db.withActor(async (m) => {
      const [row] = await m.query(
        `INSERT INTO arka.projects
           (code, name, customer_id, manager_id, status, budget, contract_value, progress_pct,
            starts_on, due_on, description, created_by)
         VALUES (
            COALESCE(NULLIF($1,''), 'PRJ-'||to_char(current_date,'YY')||lpad(nextval('arka.seq_project_code')::text,4,'0')),
            $2,$3,$4,COALESCE($5,'LEAD')::arka.project_status,
            COALESCE($6,0),COALESCE($7,0),COALESCE($8,0),$9,$10,$11, arka.current_actor_id())
         RETURNING id, code, name, status`,
        [dto.code ?? null, dto.name, dto.customerId ?? null, dto.managerId ?? null, dto.status ?? null,
         dto.budget ?? null, dto.contractValue ?? null, dto.progressPct ?? null,
         dto.startsOn ?? null, dto.dueOn ?? null, dto.description ?? null],
      );
      return row;
    });
  }

  async update(id: string, dto: UpsertProjectDto) {
    await this.db.withActor(async (m) => {
      await m.query(
        `UPDATE arka.projects SET
            name = COALESCE($2, name),
            customer_id = $3, manager_id = $4,
            status = COALESCE($5::arka.project_status, status),
            budget = COALESCE($6, budget), contract_value = COALESCE($7, contract_value),
            progress_pct = COALESCE($8, progress_pct),
            starts_on = $9, due_on = $10, description = COALESCE($11, description)
          WHERE id = $1 AND deleted_at IS NULL`,
        [id, dto.name ?? null, dto.customerId ?? null, dto.managerId ?? null, dto.status ?? null,
         dto.budget ?? null, dto.contractValue ?? null, dto.progressPct ?? null,
         dto.startsOn ?? null, dto.dueOn ?? null, dto.description ?? null],
      );
    });
    return this.get(id);
  }

  async softDelete(id: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('A deletion reason is required');
    await this.db.withActor(async (m) => {
      await m.query(
        `UPDATE arka.projects SET deleted_at = now(), deleted_by = arka.current_actor_id(), deleted_reason = $2
          WHERE id = $1 AND deleted_at IS NULL`,
        [id, reason.trim()],
      );
    });
    return { deleted: true };
  }

  trash() {
    return this.db.query(
      `SELECT p.id, p.code, p.name, p.deleted_at, p.deleted_reason,
              u.full_name AS deleted_by_name
         FROM arka.projects p LEFT JOIN arka.users u ON u.id = p.deleted_by
        WHERE p.deleted_at IS NOT NULL ORDER BY p.deleted_at DESC`,
    );
  }

  async restore(id: string) {
    await this.db.withActor(async (m) => {
      await m.query(
        `UPDATE arka.projects SET deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL
          WHERE id = $1 AND deleted_at IS NOT NULL`,
        [id],
      );
    });
    return { restored: true };
  }
}

@Controller({ path: 'projects', version: '1' })
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get() @RequirePermissions('project.view') list() { return this.projects.list(); }
  @Get('trash') @RequirePermissions('project.manage') trash() { return this.projects.trash(); }
  @Get(':id') @RequirePermissions('project.view') get(@Param('id', ParseUUIDPipe) id: string) { return this.projects.get(id); }
  @Post() @RequirePermissions('project.manage') create(@Body() dto: UpsertProjectDto) { return this.projects.create(dto); }
  @Patch(':id') @RequirePermissions('project.manage') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertProjectDto) { return this.projects.update(id, dto); }
  @Delete(':id') @RequirePermissions('project.manage') remove(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeleteDto) { return this.projects.softDelete(id, dto.reason); }
  @Post(':id/restore') @RequirePermissions('project.manage') restore(@Param('id', ParseUUIDPipe) id: string) { return this.projects.restore(id); }
}

@Module({
  providers: [ProjectsService],
  controllers: [ProjectsController],
  exports: [ProjectsService],
})
export class ProjectsModule {}
