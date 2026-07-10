import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import { toDataURL } from 'qrcode';

/** TOTP (RFC 6238) enrollment & verification for step-up authentication. */
@Injectable()
export class MfaService {
  constructor() {
    // 1 step (±30s) tolerance for clock skew.
    authenticator.options = { window: 1 };
  }

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  otpauthUrl(email: string, secret: string): string {
    return authenticator.keyuri(email, 'Arka Ads Studio', secret);
  }

  async qrDataUrl(otpauthUrl: string): Promise<string> {
    return toDataURL(otpauthUrl);
  }

  verify(token: string, secret: string): boolean {
    try {
      return authenticator.verify({ token: token.replace(/\s/g, ''), secret });
    } catch {
      return false;
    }
  }
}
