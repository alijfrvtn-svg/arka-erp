import { CommandHandler, ICommand, ICommandHandler } from '@nestjs/cqrs';
import { JournalService } from '../journal.service';
import { CreateJournalDto, TransferDto } from '../dto/journal.dto';

// ---- Command definitions (the write side of CQRS) --------------------------
export class CreateJournalCommand implements ICommand {
  constructor(public readonly dto: CreateJournalDto) {}
}
export class PostJournalCommand implements ICommand {
  constructor(public readonly entryId: string) {}
}
export class ReverseJournalCommand implements ICommand {
  constructor(
    public readonly entryId: string,
    public readonly date?: string,
    public readonly memo?: string,
  ) {}
}
export class TransferFundsCommand implements ICommand {
  constructor(public readonly dto: TransferDto) {}
}

// ---- Handlers --------------------------------------------------------------
@CommandHandler(CreateJournalCommand)
export class CreateJournalHandler implements ICommandHandler<CreateJournalCommand> {
  constructor(private readonly journal: JournalService) {}
  execute(cmd: CreateJournalCommand) {
    return this.journal.createDraft(cmd.dto);
  }
}

@CommandHandler(PostJournalCommand)
export class PostJournalHandler implements ICommandHandler<PostJournalCommand> {
  constructor(private readonly journal: JournalService) {}
  execute(cmd: PostJournalCommand) {
    return this.journal.post(cmd.entryId);
  }
}

@CommandHandler(ReverseJournalCommand)
export class ReverseJournalHandler implements ICommandHandler<ReverseJournalCommand> {
  constructor(private readonly journal: JournalService) {}
  execute(cmd: ReverseJournalCommand) {
    return this.journal.reverse(cmd.entryId, cmd.date, cmd.memo);
  }
}

@CommandHandler(TransferFundsCommand)
export class TransferFundsHandler implements ICommandHandler<TransferFundsCommand> {
  constructor(private readonly journal: JournalService) {}
  execute(cmd: TransferFundsCommand) {
    return this.journal.transfer(cmd.dto);
  }
}

export const JOURNAL_COMMAND_HANDLERS = [
  CreateJournalHandler,
  PostJournalHandler,
  ReverseJournalHandler,
  TransferFundsHandler,
];
