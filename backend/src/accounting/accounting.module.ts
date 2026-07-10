import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { JournalService } from './journal.service';
import { JournalController } from './journal.controller';
import { JOURNAL_COMMAND_HANDLERS } from './commands/journal.commands';

@Module({
  imports: [CqrsModule],
  providers: [AccountsService, JournalService, ...JOURNAL_COMMAND_HANDLERS],
  controllers: [AccountsController, JournalController],
  exports: [AccountsService, JournalService],
})
export class AccountingModule {}
