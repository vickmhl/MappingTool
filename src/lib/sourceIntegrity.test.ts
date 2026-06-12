import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('source integrity guardrails', () => {
  it('does not reintroduce known mojibake strings in app code', async () => {
    const appSource = await readFile(path.join(root, 'src/App.tsx'), 'utf8');

    expect(appSource).not.toMatch(/瀵煎叆|瀵煎嚭/);
  });

  it('keeps bulk acceptance behind the active review queue', async () => {
    const appSource = await readFile(path.join(root, 'src/App.tsx'), 'utf8');

    expect(appSource).not.toContain('一键确认全部');
  });
});
