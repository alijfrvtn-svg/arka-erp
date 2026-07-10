import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { MfaService } from './mfa.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule, JwtModule.register({ global: true })],
  providers: [AuthService, MfaService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
