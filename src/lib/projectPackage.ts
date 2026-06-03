import type { AppState } from '../types';

const PACKAGE_VERSION = 1;
const PBKDF2_ITERATIONS = 120_000;

function ensurePassword(password: string): void {
  if (password.trim().length < 6) {
    throw new Error('项目包密码至少需要 6 个字符。');
  }
}

function bytesToBufferSource(bytes: Uint8Array): BufferSource {
  return new Uint8Array(bytes) as unknown as BufferSource;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: bytesToBufferSource(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

export async function exportEncryptedProjectPackage(
  state: AppState,
  password: string,
): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  ensurePassword(password);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt);
  const encoded = new TextEncoder().encode(JSON.stringify(state));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: bytesToBufferSource(iv) },
    key,
    bytesToBufferSource(encoded),
  );

  const zip = new JSZip();
  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        version: PACKAGE_VERSION,
        app: 'competitor-org-mapping',
        encrypted: true,
        algorithm: 'AES-GCM',
        kdf: 'PBKDF2-SHA256',
        iterations: PBKDF2_ITERATIONS,
        exportedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  zip.file('payload.bin', new Uint8Array(encrypted));
  zip.file('salt.bin', salt);
  zip.file('iv.bin', iv);

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function importEncryptedProjectPackage(file: File, password: string): Promise<AppState> {
  const { default: JSZip } = await import('jszip');
  ensurePassword(password);
  const zip = await JSZip.loadAsync(await readBlobAsArrayBuffer(file));
  const manifest = JSON.parse((await zip.file('manifest.json')?.async('text')) ?? '{}') as {
    version?: number;
    encrypted?: boolean;
  };

  if (manifest.version !== PACKAGE_VERSION || !manifest.encrypted) {
    throw new Error('项目包格式不兼容或未加密。');
  }

  const payload = await zip.file('payload.bin')?.async('uint8array');
  const salt = await zip.file('salt.bin')?.async('uint8array');
  const iv = await zip.file('iv.bin')?.async('uint8array');

  if (!payload || !salt || !iv) {
    throw new Error('项目包缺少必要的加密数据。');
  }

  const key = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytesToBufferSource(iv) },
    key,
    bytesToBufferSource(payload),
  );
  return JSON.parse(new TextDecoder().decode(decrypted)) as AppState;
}
