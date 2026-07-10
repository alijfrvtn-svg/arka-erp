import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** Amounts are integers in the smallest currency unit (Rial), sent as strings
 *  to preserve NUMERIC(78,0) precision across the wire. */
const AMOUNT = /^\d{1,78}$/;

export class JournalLineDto {
  @IsUUID()
  accountId!: string;

  @Matches(AMOUNT, { message: 'debit must be a non-negative integer string' })
  debit: string = '0';

  @Matches(AMOUNT, { message: 'credit must be a non-negative integer string' })
  credit: string = '0';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  memo?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;
}

export class CreateJournalDto {
  @IsString()
  @MaxLength(500)
  memo!: string;

  @IsDateString()
  entryDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsIn(['MANUAL', 'INVOICE', 'PAYROLL', 'DEPRECIATION', 'FX', 'REVERSAL', 'CLOSING'])
  source?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines!: JournalLineDto[];
}

export class TransferDto {
  @IsUUID()
  fromAccountId!: string;

  @IsUUID()
  toAccountId!: string;

  @Matches(AMOUNT, { message: 'amount must be a positive integer string' })
  amount!: string;

  @IsString()
  @MaxLength(500)
  memo!: string;

  @IsOptional()
  @IsDateString()
  entryDate?: string;
}

export class ReverseDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  memo?: string;
}

export class JournalDeleteDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}
