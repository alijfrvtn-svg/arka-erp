import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto, ResetPasswordDto, SetPermissionsDto, UpdateUserDto } from './dto/user.dto';
import { CurrentUser, RequirePermissions } from '../common/auth/decorators';
import { AuthUser } from '../common/auth/auth.types';

@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('user.manage')
  list() {
    return this.users.list();
  }

  /** Available roles + their permission sets (for the create/edit form). */
  @Get('roles')
  @RequirePermissions('user.manage')
  async roles() {
    const roles = ['CEO','ACCOUNTANT','SALES','DESIGNER','DEVELOPER','PHOTOGRAPHER','CUSTOMER','GUEST'];
    const out: Record<string, string[]> = {};
    for (const r of roles) out[r] = await this.users.permissionsForRole(r);
    return out;
  }

  /** Full catalogue of assignable permissions grouped for the checkbox UI. */
  @Get('permission-catalog')
  @RequirePermissions('user.manage')
  catalog() {
    return this.users.permissionCatalog();
  }

  /** Team directory (names) — any authenticated user, for task assignment. */
  @Get('directory')
  directory() {
    return this.users.directory();
  }

  @Get(':id')
  @RequirePermissions('user.manage')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.getDetail(id);
  }

  @Patch(':id/permissions')
  @RequirePermissions('user.manage')
  setPermissions(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPermissionsDto) {
    return this.users.setUserPermissions(id, dto.permissions);
  }

  @Post()
  @RequirePermissions('user.manage')
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('user.manage')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.updateUser(id, dto);
  }

  @Patch(':id/password')
  @RequirePermissions('user.manage')
  reset(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetPasswordDto) {
    return this.users.adminResetPassword(id, dto.newPassword);
  }

  /** Recovery: clear a user's MFA (e.g. they lost their authenticator). */
  @Post(':id/mfa/reset')
  @RequirePermissions('user.manage')
  async resetMfa(@Param('id', ParseUUIDPipe) id: string) {
    await this.users.clearMfa(id);
    return { mfaReset: true };
  }

  @Delete(':id')
  @RequirePermissions('user.manage')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.users.softDelete(id, me.id);
  }
}
