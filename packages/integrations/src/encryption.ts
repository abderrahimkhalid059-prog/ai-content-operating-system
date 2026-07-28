import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

interface EncryptedEnvelope {
  algorithm: 'aes-256-gcm';
  keyVersion: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export class CredentialEncryption {
  private readonly key?: Buffer;

  constructor(
    encodedKey: string | undefined,
    readonly keyVersion: string,
  ) {
    if (encodedKey) {
      const key = Buffer.from(encodedKey, 'base64');
      if (key.length !== 32) throw new Error('Integration encryption key must contain 32 bytes.');
      this.key = key;
    }
  }

  encrypt(value: unknown): string {
    const key = this.requireKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), 'utf8'),
      cipher.final(),
    ]);
    const envelope: EncryptedEnvelope = {
      algorithm: 'aes-256-gcm',
      keyVersion: this.keyVersion,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
    return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
  }

  decrypt<T>(encodedEnvelope: string, expectedKeyVersion: string): T {
    const key = this.requireKey();
    if (expectedKeyVersion !== this.keyVersion) {
      throw new Error('Unsupported integration credential key version.');
    }
    const envelope = JSON.parse(
      Buffer.from(encodedEnvelope, 'base64').toString('utf8'),
    ) as EncryptedEnvelope;
    if (envelope.algorithm !== 'aes-256-gcm' || envelope.keyVersion !== expectedKeyVersion) {
      throw new Error('Invalid integration credential envelope.');
    }
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8')) as T;
  }

  private requireKey(): Buffer {
    if (!this.key) throw new Error('Integration credential encryption is not configured.');
    return this.key;
  }
}
