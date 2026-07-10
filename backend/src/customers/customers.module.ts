import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { DatabaseService } from '../common/database/database.service';
import { EnvelopeService } from '../common/crypto/envelope.service';
import { RequirePermissions } from '../common/auth/decorators';

class UpsertCustomerDto {
  @IsOptional() @IsString() @MaxLength(50) code?: string;    // auto-generated when omitted
  @IsOptional() @IsIn(['INDIVIDUAL','COMPANY']) kind?: string;   // required on create (checked in service)
  @IsOptional() @IsString() @MaxLength(200) displayName?: string;
  @IsOptional() @IsString() @MaxLength(200) legalName?: string;
  @IsOptional() @IsString() @MaxLength(320) email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(40) iban?: string;
  @IsOptional() @IsString() @MaxLength(40) taxId?: string;
  @IsOptional() @IsString() creditLimit?: string;
}

class DeleteDto {
  @IsString() @MaxLength(500) reason!: string;
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly envelope: EnvelopeService,
  ) {}

  list() {
    return this.db.query(
      `SELECT c.id, c.code, c.kind, c.display_name, c.legal_name, c.email, c.phone,
              c.iban_last4, c.tax_id_last4, c.credit_limit::text AS credit_limit,
              COALESCE(a.balance,0)::text AS receivable_balance
         FROM arka.customers c
         LEFT JOIN arka.accounts a ON a.id = c.ar_account_id
        WHERE c.deleted_at IS NULL
        ORDER BY c.created_at DESC`,
    );
  }

  async get(id: string) {
    const [row] = await this.db.query(
      `SELECT id, code, kind, display_name, legal_name, email, phone,
              iban_last4, tax_id_last4, credit_limit::text AS credit_limit
         FROM arka.customers WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return row;
  }

  create(dto: UpsertCustomerDto) {
    if (!dto.displayName?.trim()) throw new BadRequestException('Customer name is required');
    const kind = dto.kind ?? 'COMPANY';
    const ibanEnc = this.envelope.encrypt(dto.iban);
    const taxEnc = this.envelope.encrypt(dto.taxId);
    return this.db.withActor(async (m) => {
      const [row] = await m.query(
        `INSERT INTO arka.customers
           (code, kind, display_name, legal_name, email, phone,
            iban_enc, iban_last4, tax_id_enc, tax_id_last4, credit_limit, created_by)
         VALUES (
            COALESCE(NULLIF($1,''), 'CUST-'||lpad(nextval('arka.seq_customer_code')::text,4,'0')),
            $2::arka.customer_kind,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,0), arka.current_actor_id())
         RETURNING id, code, display_name`,
        [dto.code ?? null, kind, dto.displayName, dto.legalName ?? null, dto.email ?? null, dto.phone ?? null,
         ibanEnc, this.envelope.last4(dto.iban), taxEnc, this.envelope.last4(dto.taxId), dto.creditLimit ?? null],
      );
      return row;
    });
  }

  async update(id: string, dto: UpsertCustomerDto) {
    const ibanEnc = dto.iban !== undefined ? this.envelope.encrypt(dto.iban) : undefined;
    const taxEnc = dto.taxId !== undefined ? this.envelope.encrypt(dto.taxId) : undefined;
    await this.db.withActor(async (m) => {
      await m.query(
        `UPDATE arka.customers SET
            kind = COALESCE($2::arka.customer_kind, kind),
            display_name = COALESCE($3, display_name),
            legal_name = COALESCE($4, legal_name), email = COALESCE($5, email), phone = COALESCE($6, phone),
            credit_limit = COALESCE($7, credit_limit),
            iban_enc = COALESCE($8, iban_enc), iban_last4 = COALESCE($9, iban_last4),
            tax_id_enc = COALESCE($10, tax_id_enc), tax_id_last4 = COALESCE($11, tax_id_last4)
          WHERE id = $1 AND deleted_at IS NULL`,
        [id, dto.kind ?? null, dto.displayName ?? null, dto.legalName ?? null, dto.email ?? null, dto.phone ?? null,
         dto.creditLimit ?? null, ibanEnc ?? null, dto.iban !== undefined ? this.envelope.last4(dto.iban) : null,
         taxEnc ?? null, dto.taxId !== undefined ? this.envelope.last4(dto.taxId) : null],
      );
    });
    return this.get(id);
  }

  async softDelete(id: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('A deletion reason is required');
    await this.db.withActor(async (m) => {
      await m.query(
        `UPDATE arka.customers SET deleted_at = now(), deleted_by = arka.current_actor_id(), deleted_reason = $2
          WHERE id = $1 AND deleted_at IS NULL`,
        [id, reason.trim()],
      );
    });
    return { deleted: true };
  }

  trash() {
    return this.db.query(
      `SELECT c.id, c.code, c.display_name, c.deleted_at, c.deleted_reason,
              u.full_name AS deleted_by_name
         FROM arka.customers c LEFT JOIN arka.users u ON u.id = c.deleted_by
        WHERE c.deleted_at IS NOT NULL ORDER BY c.deleted_at DESC`,
    );
  }

  async restore(id: string) {
    await this.db.withActor(async (m) => {
      await m.query(
        `UPDATE arka.customers SET deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL
          WHERE id = $1 AND deleted_at IS NOT NULL`,
        [id],
      );
    });
    return { restored: true };
  }
}

@Controller({ path: 'customers', version: '1' })
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get() @RequirePermissions('customer.view') list() { return this.customers.list(); }
  @Get('trash') @RequirePermissions('customer.manage') trash() { return this.customers.trash(); }
  @Get(':id') @RequirePermissions('customer.view') get(@Param('id', ParseUUIDPipe) id: string) { return this.customers.get(id); }
  @Post() @RequirePermissions('customer.manage') create(@Body() dto: UpsertCustomerDto) { return this.customers.create(dto); }
  @Patch(':id') @RequirePermissions('customer.manage') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertCustomerDto) { return this.customers.update(id, dto); }
  @Delete(':id') @RequirePermissions('customer.manage') remove(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeleteDto) { return this.customers.softDelete(id, dto.reason); }
  @Post(':id/restore') @RequirePermissions('customer.manage') restore(@Param('id', ParseUUIDPipe) id: string) { return this.customers.restore(id); }
}

@Module({
  providers: [CustomersService],
  controllers: [CustomersController],
  exports: [CustomersService],
})
export class CustomersModule {}
