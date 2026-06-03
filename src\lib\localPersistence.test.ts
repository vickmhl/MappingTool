import { describe, expect, it } from 'vitest';
import { createDemoState } from '../data/seed';
import {
  createLocalPersistenceKey,
  decryptPersistedState,
  encryptPersistedState,
  isPersistedStateEnvelope,
} from './localPersistence';

describe('localPersistence', () => {
  it('encrypts and decrypts persisted app state without leaking plaintext fields', async () => {
    const state = createDemoState();
    const key = await createLocalPersistenceKey();
    const envelope = await encryptPersistedState(state, key);

    expect(isPersistedStateEnvelope(envelope)).toBe(true);
    expect(envelope.cipherText).not.toContain(state.project.name);

    const restored = await decryptPersistedState(envelope, key);
    expect(restored.project.name).toBe(state.project.name);
    expect(restored.people.length).toBe(state.people.length);
  });

  it('rejects decryption with a different local key', async () => {
    const state = createDemoState();
    const correctKey = await createLocalPersistenceKey();
    const wrongKey = await createLocalPersistenceKey();
    const envelope = await encryptPersistedState(state, correctKey);

    await expect(decryptPersistedState(envelope, wrongKey)).rejects.toThrow();
  });
});
