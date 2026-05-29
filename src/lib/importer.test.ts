import { describe, expect, it } from 'vitest';
import { importSourceFile } from './importer';

function fakeTextFile(name: string, text: string): File {
  const encoded = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);

  return {
    name,
    arrayBuffer: async () => buffer,
    text: async () => text,
  } as File;
}

describe('importer', () => {
  it('imports a transcript and creates evidence-backed candidates', async () => {
    const result = await importSourceFile(
      fakeTextFile('sample-call.txt', '张伟现任星河科技研发中心CTO。刘洋汇报给张伟。'),
      { enableOcr: false },
    );

    expect(result.source.fileName).toBe('sample-call.txt');
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.candidates.some((candidate) => candidate.kind === 'roleAssignment')).toBe(true);
    expect(result.candidates.some((candidate) => candidate.kind === 'reportingLine')).toBe(true);
    expect(result.candidates.every((candidate) => candidate.evidenceText.length > 0)).toBe(true);
  });
});
