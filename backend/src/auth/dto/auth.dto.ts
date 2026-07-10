import { IsEmail, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  /** Present on the second step when the account has MFA enabled. */
  @IsOptional()
  @IsString()
  @Length(6, 6, { message: 'TOTP code must be 6 digits' })
  totp?: string;
}

export class MfaTokenDto {
  @IsString()
  @Length(6, 6, { message: 'TOTP code must be 6 digits' })
  token!: string;
}

export class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(200) fullName?: string;
  @IsOptional() @IsEmail() email?: string;
}

export class ChangePasswordDto {
  @IsString() @MinLength(8) currentPassword!: string;
  @IsString() @MinLength(8) @MaxLength(200) newPassword!: string;
}
