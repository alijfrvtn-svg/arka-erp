import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { RequirePermissions } from '../common/auth/decorators';

@Controller({ path: 'reports', version: '1' })
@RequirePermissions('report.financial')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('trial-balance')
  trialBalance() {
    return this.reports.trialBalance();
  }

  @Get('profit-and-loss')
  profitAndLoss(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.profitAndLoss(from, to);
  }

  @Get('balance-sheet')
  balanceSheet() {
    return this.reports.balanceSheet();
  }

  @Get('general-ledger')
  generalLedger(
    @Query('accountId') accountId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reports.generalLedger({
      accountId,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('cash-flow')
  cashFlow(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.cashFlow(from, to);
  }
}
