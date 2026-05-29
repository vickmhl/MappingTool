import { describe, expect, it } from 'vitest';
import type { EvidenceChunk } from '../types';
import { extractCandidatesFromEvidence, splitIntoChunks } from './extractor';

function evidence(text: string): EvidenceChunk {
  return {
    id: 'ev_1',
    sourceDocumentId: 'src_1',
    sourceName: 'call.txt',
    location: '文本片段 1',
    text,
    extractedAt: '2026-05-29T00:00:00.000Z',
    confidence: 0.7,
    candidateIds: [],
  };
}

describe('extractor', () => {
  it('splits long transcript text into usable chunks', () => {
    const chunks = splitIntoChunks('王敏现任商业化事业部总经理。李然汇报给王敏。\n赵婧已经离职。', 18);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.join(' ')).toContain('李然汇报给王敏');
  });

  it('extracts role, org, reporting line, and change candidates with evidence', () => {
    const candidates = extractCandidatesFromEvidence(
      evidence('王敏现任星河科技商业化事业部总经理，李然汇报给王敏。赵婧已经离职。'),
    );

    expect(candidates.some((candidate) => candidate.kind === 'roleAssignment')).toBe(true);
    expect(candidates.some((candidate) => candidate.kind === 'orgUnit')).toBe(true);
    expect(candidates.some((candidate) => candidate.kind === 'reportingLine')).toBe(true);
    expect(candidates.some((candidate) => candidate.kind === 'changeEvent')).toBe(true);
    expect(candidates.every((candidate) => candidate.evidenceId === 'ev_1')).toBe(true);
  });
});
