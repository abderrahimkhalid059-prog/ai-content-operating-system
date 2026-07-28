import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialEncryption } from '../src/encryption';

describe('CredentialEncryption', () => {
  const key = randomBytes(32).toString('base64');

  it('uses authenticated encryption with a random nonce and key version', () => {
    const encryption = new CredentialEncryption(key, 'v1');
    const first = encryption.encrypt({ accessToken: 'sensitive-access' });
    const second = encryption.encrypt({ accessToken: 'sensitive-access' });
    expect(first).not.toBe(second);
    expect(first).not.toContain('sensitive-access');
    expect(encryption.decrypt(first, 'v1')).toEqual({ accessToken: 'sensitive-access' });
  });

  it('rejects tampering, a wrong key, and a wrong key version', () => {
    const encryption = new CredentialEncryption(key, 'v1');
    const value = encryption.encrypt({ refreshToken: 'sensitive-refresh' });
    const tampered = `${value.slice(0, -2)}AA`;
    expect(() => encryption.decrypt(tampered, 'v1')).toThrow();
    expect(() =>
      new CredentialEncryption(randomBytes(32).toString('base64'), 'v1').decrypt(value, 'v1'),
    ).toThrow();
    expect(() => encryption.decrypt(value, 'v2')).toThrow(/version/i);
  });

  it('allows mock mode to start without an encryption key but fails safely on use', () => {
    const encryption = new CredentialEncryption(undefined, 'v1');
    expect(() => encryption.encrypt({ accessToken: 'never-persisted' })).toThrow(/configured/i);
  });
});
