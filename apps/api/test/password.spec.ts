import { describe, expect, it } from 'vitest';
import { PasswordService } from '../src/modules/auth/password.service';

const service = new PasswordService({ get: () => 12 } as never);

describe('PasswordService', () => {
  it('hashes with Argon2id and verifies the correct password', async () => {
    const hash = await service.hash('Correct-Horse-9472');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(service.verify(hash, 'Correct-Horse-9472')).resolves.toBe(true);
  });

  it('rejects invalid passwords and current-password mismatches', async () => {
    expect(() => service.assertValid('too-short')).toThrow(/mot de passe/i);
    const hash = await service.hash('Another-Password-8431');
    await expect(service.verify(hash, 'Invalid-Password-1283')).resolves.toBe(false);
  });
});
