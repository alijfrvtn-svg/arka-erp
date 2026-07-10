import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'node:crypto';
import { AppConfig } from '../../config/configuration';

/**
 * Envelope encryption for PII (IBAN, national/tax id, TOTP secrets).
 * Layout of the returned buffer:  [ iv(12) | authTag(16) | ciphertext ]
 * The master key would live in KMS/Vault in production; here it is injected
 * via ENVELOPE_MASTER_KEY_HEX (32-byte hex).
 */
@Injectable()
export class EnvelopeService {
  private readonly key: Buffer;

  constructor(config: ConfigService<AppConfig, true>) {
    const hex = config.get('crypto', { infer: true }).masterKeyHex;
    // Normalise to exactly 32 bytes (accepts hex or arbitrary string).
    this.key =
      /^[0-9a-fA-F]{64}$/.test(hex)
        ? Buffer.from(hex, 'hex')
        : createHash('sha256').update(hex).digest();
  }

  encrypt(plaintext: string | null | undefined): Buffer | null {
    if (plaintext === null || plaintext === undefined || plaintext === '') return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]);
  }

  decrypt(blob: Buffer | null | undefined): string | null {
    if (!blob || blob.length < 28) return null;
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const ct = blob.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  /** Convenience: last-4 of a sensitive value for non-sensitive display. */
  last4(value: string | null | undefined): string | null {
    if (!value) return null;
    return value.slice(-4);
  }
}
