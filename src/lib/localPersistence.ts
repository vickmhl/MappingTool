import type { AppState } from '../types';

const PERSISTENCE_VERSION = 2;

export interface PersistedStateEnvelope {
  version: number;
  algorithm: 'AES-GCM';
  savedAt: string;
  iv: string;
  cipherText: string;
}

function bytesToBufferSource(bytes: Uint8Array): BufferSource {
  return new Uint8Array(bytes) as unknown as BufferSource;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function isPersistedStateEnvelope(value: unknown): value is PersistedStateEnvelope {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === PERSISTENCE_VERSION &&
    record.algorithm === 'AES-GCM' &&
    typeof record.iv === 'string' &&
    typeof record.cipherText === 'string'
  );
}

export async function createLocalPersistenceKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptPersistedState(
  state: AppState,
  key: CryptoKey,
): Promise<PersistedStateEnvelope> {
  const iv = randomBytes(12);
  const encoded = new TextEncoder().encode(JSON.stringify(state));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: bytesToBufferSource(iv) },
    key,
    bytesToBufferSource(encoded),
  );

  return {
    version: PERSISTENCE_VERSION,
    algorithm: 'AES-GCM',
    savedAt: new Date().toISOString(),
    iv: encodeBase64(iv),
    cipherText: encodeBase64(new Uint8Array(encrypted)),
  };
}

export async function decryptPersistedState(
  envelope: PersistedStateEnvelope,
  key: CryptoKey,
): Promise<AppState> {
  const iv = decodeBase64(envelope.iv);
  const cipherText = decodeBase64(envelope.cipherText);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytesToBufferSource(iv) },
    key,
    bytesToBufferSource(cipherText),
  );
  return JSON.parse(new TextDecoder().decode(decrypted)) as AppState;
}
