import { describe, expect, it } from 'vitest';
import { dirtyExpectedNames, dirtyNotes, dirtyTranscript } from './dirtyFixture';
import { importSourceFile } from './importer';
import type { ImportResult } from '../types';

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

function collectRecognizedNames(result: ImportResult): string[] {
  const names = new Set<string>();
  for (const candidate of result.candidates) {
    const payload = candidate.payload as unknown as Record<string, unknown>;
    for (const key of ['name', 'personName', 'managerName', 'subordinateName']) {
      const value = payload[key];
      if (typeof value === 'string' && value.length >= 2) {
        names.add(value);
      }
    }
  }
  return [...names];
}

describe('dirty fixture regression', () => {
  it('keeps a high recall on the realistic dirty Chinese sample pack', async () => {
    const results = [
      await importSourceFile(fakeTextFile('dirty-call.txt', dirtyTranscript), { enableOcr: false }),
      await importSourceFile(fakeTextFile('dirty-notes.md', dirtyNotes), { enableOcr: false }),
    ];

    const recognizedNames = new Set<string>();
    for (const result of results) {
      for (const name of collectRecognizedNames(result)) {
        recognizedNames.add(name);
      }
    }

    const recognizedExpected = dirtyExpectedNames.filter((name) => recognizedNames.has(name));
    const missedExpected = dirtyExpectedNames.filter((name) => !recognizedNames.has(name));

    expect(recognizedExpected.length).toBeGreaterThanOrEqual(50);
    expect(missedExpected).toEqual([]);
  });
});
