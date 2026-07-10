import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { JournalService } from './journal.service';
import { CreateJournalDto, JournalDeleteDto, ReverseDto, TransferDto } from './dto/journal.dto';
import {
  CreateJournalCommand,
  PostJournalCommand,
  ReverseJournalCommand,
  TransferFundsCommand,
} from './commands/journal.commands';
import { RequirePermissions, RequireStepUp } from '../common/auth/decorators';

@Controller({ path: 'journal', version: '1' })
export class JournalController {
  constructor(
    private readonly journal: JournalService,
    private readonly commandBus: CommandBus,
  ) {}

  @Get()
  @RequirePermissions('ledger.view')
  list(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.journal.list({
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  /** Critical action: fund transfer requires fund.transfer + fresh MFA step-up. */
  @Post('transfer')
  @RequirePermissions('fund.transfer')
  @RequireStepUp()
  transfer(@Body() dto: TransferDto) {
    return this.commandBus.execute(new TransferFundsCommand(dto));
  }

  @Get('trash')
  @RequirePermissions('ledger.view')
  trash() {
    return this.journal.trash();
  }

  @Get(':id')
  @RequirePermissions('ledger.view')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.journal.getById(id);
  }

  @Post()
  @RequirePermissions('ledger.create')
  create(@Body() dto: CreateJournalDto) {
    return this.commandBus.execute(new CreateJournalCommand(dto));
  }

  @Patch(':id')
  @RequirePermissions('ledger.create')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateJournalDto) {
    return this.journal.updateDraft(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('ledger.create')
  remove(@Param('id', ParseUUIDPipe) id: string, @Body() dto: JournalDeleteDto) {
    return this.journal.deleteDraft(id, dto.reason);
  }

  @Post(':id/restore')
  @RequirePermissions('ledger.create')
  restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.journal.restore(id);
  }

  @Post(':id/post')
  @RequirePermissions('ledger.post')
  post(@Param('id', ParseUUIDPipe) id: string) {
    return this.commandBus.execute(new PostJournalCommand(id));
  }

  /** Reverse a posted entry (books a contra entry; needs ledger.reverse). */
  @Post(':id/reverse')
  @RequirePermissions('ledger.reverse')
  reverse(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReverseDto) {
    return this.commandBus.execute(new ReverseJournalCommand(id, dto.date, dto.memo));
  }
}
