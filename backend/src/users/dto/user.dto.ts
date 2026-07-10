import { ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const ROLES = ['CEO','ACCOUNTANT','SALES','DESIGNER','DEVELOPER','PHOTOGRAPHER','CUSTOMER','GUEST'];

export class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @MaxLength(200) fullName!: string;
  @IsIn(ROLES) role!: string;
  @IsString() @MinLength(8) @MaxLength(200) password!: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** Explicit permission codes; when provided they override the role defaults. */
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayUnique() permissions?: string[];
}

export class SetPermissionsDto {
  @IsArray() @IsString({ each: true }) @ArrayUnique() permissions!: string[];
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MaxLength(200) fullName?: string;
  @IsOptional() @IsIn(ROLES) role?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ResetPasswordDto {
  @IsString() @MinLength(8) @MaxLength(200) newPassword!: string;
}
