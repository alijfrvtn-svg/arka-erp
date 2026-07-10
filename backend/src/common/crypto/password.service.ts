import { Injectable } from '@nestjs/common';
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';

const ARGON_OPTS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456, // 19 MiB (OWASP baseline)
  timeCost: 2,
  parallelism: 1,
};

/** Shared Argon2id hashing so both AuthService and UsersService can create
 *  credentials without a circular dependency. */
@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return argonHash(plain, ARGON_OPTS);
  }

  verify(hashStr: string, plain: string): Promise<boolean> {
    // Parameters are encoded in the hash; verify needs no options.
    return argonVerify(hashStr, plain).catch(() => false);
  }
}
