import { Module } from '@nestjs/common';
import { BootstrapService } from './bootstrap.service';
import { DbInitController } from './db-init.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [DbInitController],
  providers: [BootstrapService],
})
export class BootstrapModule {}
