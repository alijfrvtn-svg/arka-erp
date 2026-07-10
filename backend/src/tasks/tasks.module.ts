import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get,
  Injectable, Module, Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, Min, Max, IsNumber } from 'class-validator';
import { DatabaseService } from '../common/database/database.service';
import { CurrentUser, RequirePermissions } from '../common/auth/decorators';
import { AuthUser } from '../common/auth/auth.types';

class UpsertTaskDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsIn(['PERSONAL','GROUP']) kind?: string;
  @IsOptional() @IsUUID() assigneeId?: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsIn(['TODO','IN_PROGRESS','DONE','BLOCKED']) status?: string;
  @IsOptional() @IsIn(['LOW','NORMAL','HIGH','URGENT']) priority?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) progressPct?: number;
}
class StatusDto {
  @IsIn(['TODO','IN_PROGRESS','DONE','BLOCKED']) status!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) progressPct?: number;
}
class DeleteDto { @IsString() @MaxLength(500) reason!: string; }

const SELECT =
  `t.id, t.task_code, t.title, t.description, t.kind, t.assignee_id, t.project_id,
   t.status, t.priority, t.due_date, t.progress_pct, t.created_by, t.completed_at, t.created_at,
   a.full_name AS assignee_name, cb.full_name AS created_by_name, pr.name AS project_name`;
const FROM =
  `FROM arka.tasks t
   LEFT JOIN arka.users a  ON a.id  = t.assignee_id
   LEFT JOIN arka.users cb ON cb.id = t.created_by
   LEFT JOIN arka.projects pr ON pr.id = t.project_id`;

@Injectable()
export class TasksService {
  constructor(private readonly db: DatabaseService) {}

  /** Personal tasks assigned to the given user. */
  mine(userId: string) {
    return this.db.query(
      `SELECT ${SELECT} ${FROM}
        WHERE t.deleted_at IS NULL AND t.kind='PERSONAL' AND t.assignee_id = $1
        ORDER BY (t.status='DONE'), t.due_date NULLS LAST, t.priority DESC`,
      [userId],
    );
  }

  /** Group tasks visible to the whole team. */
  group() {
    return this.db.query(
      `SELECT ${SELECT} ${FROM}
        WHERE t.deleted_at IS NULL AND t.kind='GROUP'
        ORDER BY (t.status='DONE'), t.due_date NULLS LAST, t.priority DESC`,
    );
  }

  /** Management view: every active task. */
  all(projectId?: string) {
    return this.db.query(
      `SELECT ${SELECT} ${FROM}
        WHERE t.deleted_at IS NULL AND ($1::uuid IS NULL OR t.project_id = $1::uuid)
        ORDER BY t.created_at DESC`,
      [projectId ?? null],
    );
  }

  async get(id: string) {
    const [row] = await this.db.query(`SELECT ${SELECT} ${FROM} WHERE t.id = $1 AND t.deleted_at IS NULL`, [id]);
    return row;
  }

  create(dto: UpsertTaskDto) {
    if (!dto.title?.trim()) throw new BadRequestException('Task title is required');
    const kind = dto.kind ?? 'PERSONAL';
    if (kind === 'PERSONAL' && !dto.assigneeId) {
      throw new BadRequestException('A personal task needs an assignee');
    }
    return this.db.withActor(async (m) => {
      const [row] = await m.query(
        `INSERT INTO arka.tasks
           (task_code, title, description, kind, assignee_id, project_id, status, priority, due_date, progress_pct, created_by)
         VALUES ('TASK-'||lpad(nextval('arka.seq_task_code')::text,4,'0'),
                 $1,$2,$3,$4,$5,COALESCE($6,'TODO'),COALESCE($7,'NORMAL'),$8,COALESCE($9,0), arka.current_actor_id())
         RETURNING id, task_code, title, kind`,
        [dto.title, dto.description ?? null, kind, kind === 'GROUP' ? null : dto.assigneeId ?? null,
         dto.projectId ?? null, dto.status ?? null, dto.priority ?? null, dto.dueDate ?? null, dto.progressPct ?? null],
      );
      return row;
    });
  }

  async update(id: string, dto: UpsertTaskDto) {
    await this.db.withActor(async (m) => {
      await m.query(
        `UPDATE arka.tasks SET
            title = COALESCE($2, title), description = COALESCE($3, description),
            kind = COALESCE($4, kind),
            assignee_id = CASE WHEN COALESCE($4,kind)='GROUP' THEN NULL ELSE COALESCE($5, assignee_id) END,
            project_id = $6,
            status = COALESCE($7, status), priority = COALESCE($8, priority),
            due_date = $9, progress_pct = COALESCE($10, progress_pct),
            completed_at = CASE WHEN COALESCE($7,status)='DONE' THEN COALESCE(completed_at, now()) ELSE NULL END
          WHERE id = $1 AND deleted_at IS NULL`,
        [id, dto.title ?? null, dto.description ?? null, dto.kind ?? null, dto.assigneeId ?? null,
         dto.projectId ?? null, dto.status ?? null, dto.priority ?? null, dto.dueDate ?? null, dto.progressPct ?? null],
      );
    });
    return this.get(id);
  }

  /** Assignee (or a manager) updates status/progress of a task. */
  async updateStatus(id: string, status: string, progress: number | undefined, user: AuthUser) {
    const [task] = await this.db.query<{ assignee_id: string; kind: string }>(
      `SELECT assignee_id, kind FROM arka.tasks WHERE id = $1 AND deleted_at IS NULL`, [id],
    );
    if (!task) throw new BadRequestException('Task not found');
    const isManager = user.permissions.includes('task.manage');
    const isAssignee = task.assignee_id === user.id;
    const isGroup = task.kind === 'GROUP';
    if (!isManager && !isAssignee && !isGroup) {
      throw new ForbiddenException('You may only update your own tasks');
    }
    await this.db.withActor(async (m) => {
      await m.query(
        `UPDATE arka.tasks SET status = $2, progress_pct = COALESCE($3, progress_pct),
            completed_at = CASE WHEN $2='DONE' THEN now() ELSE NULL END
          WHERE id = $1 AND deleted_at IS NULL`,
        [id, status, progress ?? null],
      );
    });
    return this.get(id);
  }

  async softDelete(id: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('A deletion reason is required');
    await this.db.withActor(async (m) => {
      await m.query(
        `UPDATE arka.tasks SET deleted_at = now(), deleted_by = arka.current_actor_id(), deleted_reason = $2
          WHERE id = $1 AND deleted_at IS NULL`,
        [id, reason.trim()],
      );
    });
    return { deleted: true };
  }

  trash() {
    return this.db.query(
      `SELECT t.id, t.task_code, t.title, t.deleted_at, t.deleted_reason, u.full_name AS deleted_by_name
         FROM arka.tasks t LEFT JOIN arka.users u ON u.id = t.deleted_by
        WHERE t.deleted_at IS NOT NULL ORDER BY t.deleted_at DESC`,
    );
  }

  async restore(id: string) {
    await this.db.query(
      `UPDATE arka.tasks SET deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL WHERE id = $1`, [id]);
    return { restored: true };
  }
}

@Controller({ path: 'tasks', version: '1' })
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  // Self-service (any authenticated user)
  @Get('mine')  mine(@CurrentUser() u: AuthUser) { return this.tasks.mine(u.id); }
  @Get('group') group() { return this.tasks.group(); }

  @Patch(':id/status')
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto, @CurrentUser() u: AuthUser) {
    return this.tasks.updateStatus(id, dto.status, dto.progressPct, u);
  }

  // Management
  @Get() @RequirePermissions('task.manage') all() { return this.tasks.all(); }
  @Get('trash') @RequirePermissions('task.manage') trash() { return this.tasks.trash(); }
  @Post() @RequirePermissions('task.manage') create(@Body() dto: UpsertTaskDto) { return this.tasks.create(dto); }
  @Patch(':id') @RequirePermissions('task.manage') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertTaskDto) { return this.tasks.update(id, dto); }
  @Delete(':id') @RequirePermissions('task.manage') remove(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeleteDto) { return this.tasks.softDelete(id, dto.reason); }
  @Post(':id/restore') @RequirePermissions('task.manage') restore(@Param('id', ParseUUIDPipe) id: string) { return this.tasks.restore(id); }
}

@Module({
  providers: [TasksService],
  controllers: [TasksController],
  exports: [TasksService],
})
export class TasksModule {}
