import { describe, expect, it } from 'vitest';
import { createDemoState } from '../data/seed';
import { exportEncryptedProjectPackage, importEncryptedProjectPackage } from './projectPackage';

describe('project package', () => {
  it('round-trips an encrypted mapping package', async () => {
    const state = createDemoState();
    const blob = await exportEncryptedProjectPackage(state, 'secret-pass');
    const file = new File([blob], 'demo.mapping.zip');
    const imported = await importEncryptedProjectPackage(file, 'secret-pass');

    expect(imported.project.name).toBe(state.project.name);
    expect(imported.people.length).toBe(state.people.length);
  });

  it('rejects short passwords', async () => {
    await expect(exportEncryptedProjectPackage(createDemoState(), '123')).rejects.toThrow(/至少/);
  });
});
