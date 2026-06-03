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

  it('keeps stopwords out of person candidates for realistic dirty Chinese transcripts', async () => {
    const result = await importSourceFile(
      fakeTextFile(
        'dirty-call.txt',
        '以下为虚拟脏数据，仅用于测试上传解析。赵知行现在担任导航与路线规划负责人，赵知行 report to 林澈。陈怀瑾在路径规划算法部做高级路径算法专家，陈怀瑾 report to 赵知行。',
      ),
      { enableOcr: false },
    );

    const personNames = result.candidates
      .filter((candidate) => candidate.kind === 'person')
      .map((candidate) => (candidate.payload as { name: string }).name);

    expect(personNames).toContain('赵知行');
    expect(personNames).toContain('陈怀瑾');
    expect(personNames).not.toContain('现在担任');
    expect(personNames).not.toContain('负责');
  });
});
