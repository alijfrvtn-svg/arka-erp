import { Global, Module } from '@nestjs/common';
import { EnvelopeService } from './envelope.service';
import { PasswordService } from './password.service';

@Global()
@Module({
  providers: [EnvelopeService, PasswordService],
  exports: [EnvelopeService, PasswordService],
})
export class CryptoModule {}
