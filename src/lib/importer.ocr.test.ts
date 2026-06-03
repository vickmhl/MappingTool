import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildReviewQueueBuckets } from './reviewQueue';

const recognizeImageBlob = vi.fn();

vi.mock('./ocr', () => ({
  recognizeImageBlob,
}));

function fakeImageFile(name: string): File {
  const bytes = new Uint8Array([137, 80, 78, 71]);
  return {
    name,
    type: 'image/png',
    arrayBuffer: async () => bytes.slice().buffer,
    text: async () => '',
  } as File;
}

describe('importer OCR flow', () => {
  beforeEach(() => {
    recognizeImageBlob.mockReset();
  });

  it('turns OCR text into pending manual candidates that can enter the confirmation queue', async () => {
    recognizeImageBlob.mockResolvedValue({
      text: '赵知行现在担任导航与路线规划负责人，赵知行 report to 林澈。',
      confidence: 0.82,
    });

    const { importSourceFile } = await import('./importer');
    const result = await importSourceFile(fakeImageFile('org-chart.png'), { enableOcr: true });
    const reviewQueues = buildReviewQueueBuckets(result.candidates, [result.source], [], []);

    expect(result.source.type).toBe('ocr');
    expect(result.candidates.some((candidate) => candidate.kind === 'person')).toBe(true);
    expect(result.candidates.some((candidate) => candidate.kind === 'reportingLine')).toBe(true);
    expect(reviewQueues.find((queue) => queue.key === 'manual')?.count ?? 0).toBeGreaterThan(0);
  });
});
