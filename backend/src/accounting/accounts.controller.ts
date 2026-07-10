import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/account.dto';
import { RequirePermissions } from '../common/auth/decorators';

@Controller({ path: 'accounts', version: '1' })
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequirePermissions('ledger.view')
  tree() {
    return this.accounts.tree();
  }

  @Get('postable')
  @RequirePermissions('ledger.view')
  postable() {
    return this.accounts.postable();
  }

  @Get(':id')
  @RequirePermissions('ledger.view')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.getById(id);
  }

  @Post()
  @RequirePermissions('ledger.post')
  create(@Body() dto: CreateAccountDto) {
    return this.accounts.create(dto);
  }
}
