import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '@ai-content-os/config';
import { ERROR_CODES } from '@ai-content-os/shared';
import { argon2id, hash, verify } from 'argon2';
import { CodedHttpException } from '../../common/errors/coded-http.exception';

@Injectable()
export class PasswordService {
  constructor(private readonly config: ConfigService<EnvironmentConfig, true>) {}

  hash(password: string): Promise<string> {
    this.assertValid(password);
    return hash(password, {
      type: argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
    });
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  assertValid(password: string): void {
    const minimum = this.config.get('PASSWORD_MIN_LENGTH', { infer: true });
    if (
      password.length < minimum ||
      password.length > 128 ||
      !password.trim() ||
      !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(password) ||
      !/\d/.test(password)
    ) {
      throw new CodedHttpException(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.validation,
        `Le mot de passe doit contenir entre ${minimum} et 128 caractères, une lettre et un chiffre.`,
      );
    }
  }

  temporaryPassword(): string {
    return `Tmp-${randomBytes(18).toString('base64url')}-7a`;
  }
}
