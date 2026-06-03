import { describe, expect, it } from 'vitest';
import type { CandidateRecord, EvidenceChunk, RoleCandidatePayload } from '../types';
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

function roleCandidates(text: string) {
  return extractCandidatesFromEvidence(evidence(text)).filter(
    (candidate): candidate is CandidateRecord<RoleCandidatePayload> => candidate.kind === 'roleAssignment',
  );
}

describe('extractor', () => {
  it('splits long Chinese transcript text into usable chunks', () => {
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

  it('does not treat stopwords as people and can infer an org from leader titles', () => {
    const candidates = extractCandidatesFromEvidence(
      evidence('赵知行现在担任导航与路线规划负责人，赵知行 report to 林澈。'),
    );

    const people = candidates
      .filter((candidate) => candidate.kind === 'person')
      .map((candidate) => candidate.payload as { name: string });
    const roles = roleCandidates('赵知行现在担任导航与路线规划负责人，赵知行 report to 林澈。');

    expect(people.some((person) => person.name === '赵知行')).toBe(true);
    expect(people.some((person) => person.name === '现在担任')).toBe(false);
    expect(roles.some((role) => role.payload.orgUnitName === '导航与路线规划')).toBe(true);
  });

  it('extracts explicit department plus expert role from dirty transcript wording', () => {
    const roles = roleCandidates(
      '候选人说：陈怀瑾在路径规划算法部做高级路径算法专家，陈怀瑾 report to 赵知行，团队大概 12 人。',
    );

    expect(
      roles.some(
        (role) =>
          role.payload.personName === '陈怀瑾' &&
          role.payload.orgUnitName === '路径规划算法部' &&
          role.payload.title === '高级路径算法专家',
      ),
    ).toBe(true);
  });

  it('extracts people from a manager plus subordinate list sentence', () => {
    const candidates = extractCandidatesFromEvidence(
      evidence('韩雨乔 report to 林澈，地图数据平台下有钱亦航、尤清越、孙语涵。'),
    );

    const lines = candidates
      .filter((candidate) => candidate.kind === 'reportingLine')
      .map((candidate) => candidate.payload as { subordinateName: string; managerName: string });

    expect(lines.some((line) => line.managerName === '韩雨乔' && line.subordinateName === '钱亦航')).toBe(true);
    expect(lines.some((line) => line.managerName === '韩雨乔' && line.subordinateName === '尤清越')).toBe(true);
    expect(lines.some((line) => line.managerName === '韩雨乔' && line.subordinateName === '孙语涵')).toBe(true);
  });

  it('avoids turning disclaimer text into a company name', () => {
    const roles = roleCandidates(
      '以下为虚拟脏数据，仅用于测试上传解析，不代表任何真实公司。赵知行现在担任导航与路线规划负责人。',
    );

    expect(roles[0]?.payload.company).toBeUndefined();
  });

  it('does not treat conflict phrasing and trailing clauses as fake people', () => {
    const candidates = extractCandidatesFromEvidence(
      evidence('韩雨乔下面有钱亦航、尤清越、孙语涵，其中钱亦航最近被借调去支援跨部门项目。'),
    );

    const names = candidates
      .filter((candidate) => candidate.kind === 'person')
      .map((candidate) => (candidate.payload as { name: string }).name);

    expect(names).toContain('钱亦航');
    expect(names).toContain('尤清越');
    expect(names).toContain('孙语涵');
    expect(names).not.toContain('其中钱亦');
    expect(names).not.toContain('航最近被');
    expect(names).not.toContain('借调去支');
  });

  it('does not use generic department wording as reporting people or orgs', () => {
    const candidates = extractCandidatesFromEvidence(
      evidence('赵知行现任地图云事业群总经理，下面八个一级部门都向赵知行汇报。'),
    );

    const orgs = candidates
      .filter((candidate) => candidate.kind === 'orgUnit')
      .map((candidate) => (candidate.payload as { name: string }).name);
    const lines = candidates
      .filter((candidate) => candidate.kind === 'reportingLine')
      .map((candidate) => candidate.payload as { subordinateName: string; managerName: string });

    expect(orgs).toContain('地图云事业群');
    expect(orgs).not.toContain('下面八个一级部门');
    expect(lines.some((line) => line.subordinateName.includes('部门'))).toBe(false);
    expect(lines.some((line) => line.managerName.includes('汇'))).toBe(false);
  });

  it('does not break names around conflicting report narratives', () => {
    const candidates = extractCandidatesFromEvidence(
      evidence('金向南直属上级有两个说法：一说是李清越，一说是孙亦航，需要确认。'),
    );

    const names = candidates
      .flatMap((candidate) => {
        if (candidate.kind === 'person') return [(candidate.payload as { name: string }).name];
        if (candidate.kind === 'reportingLine') {
          const payload = candidate.payload as { subordinateName: string; managerName: string };
          return [payload.subordinateName, payload.managerName];
        }
        return [];
      });

    expect(names).toContain('金向南');
    expect(names).toContain('李清越');
    expect(names).toContain('孙亦航');
    expect(names).not.toContain('金向南汇');
    expect(names).not.toContain('口径说金');
    expect(names).not.toContain('是李清越');
  });
});
