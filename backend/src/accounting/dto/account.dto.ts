import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateAccountDto {
  @Matches(/^[0-9]{1,20}$/, { message: 'code must be numeric' })
  code!: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsIn(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'])
  accountType!: string;

  @IsIn(['DEBIT', 'CREDIT'])
  normalBalance!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
