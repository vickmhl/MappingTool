import { describe, expect, it } from 'vitest';
import { createEmptyState } from '../data/seed';
import type { CandidateRecord, RoleCandidatePayload } from '../types';
import { updateCandidateStatus } from './merge';

describe('merge', () => {
  it('accepts a role candidate into people, org units, and role assignments', () => {
    const state = createEmptyState();
    const candidate: CandidateRecord<RoleCandidatePayload> = {
      id: 'cand_1',
      kind: 'roleAssignment',
      status: 'pending',
      confidence: 0.9,
      payload: {
        personName: '王敏',
        title: '总经理',
        orgUnitName: '商业化事业部',
        company: '星河科技',
      },
      evidenceId: 'ev_1',
      evidenceText: '王敏现任星河科技商业化事业部总经理',
      sourceName: 'call.txt',
      createdAt: '2026-05-29T00:00:00.000Z',
      reason: 'test',
    };
    state.candidates.push(candidate);

    const next = updateCandidateStatus(state, ['cand_1'], 'accepted');

    expect(next.candidates[0].status).toBe('accepted');
    expect(next.people).toHaveLength(1);
    expect(next.people[0].name).toBe('王敏');
    expect(next.orgUnits[0].name).toBe('商业化事业部');
    expect(next.roleAssignments[0].title).toBe('总经理');
  });
});
