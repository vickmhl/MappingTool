import { describe, expect, it } from 'vitest';
import { createEmptyState } from '../data/seed';
import { createId, nowIso } from './ids';
import {
  applyAcceptedMapPatch,
  buildFollowUpPrompts,
  buildInterviewArtifacts,
  parseInterviewQuickNotes,
  suggestMountTargets,
} from './interviewPatch';
import type { CandidateProfile, InterviewSession, MapPatch } from '../types';

function draftCandidate(overrides: Partial<CandidateProfile> = {}): CandidateProfile {
  const timestamp = nowIso();
  return {
    id: createId('candidate'),
    name: '李明',
    company: '云图地图科技（虚拟）',
    source: 'resume',
    status: 'interviewing',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function draftSession(candidateId: string, rawNotes = ''): InterviewSession {
  return {
    id: createId('session'),
    candidateId,
    startedAt: nowIso(),
    sourceType: 'phone',
    status: 'draft',
    rawNotes,
    structuredNotes: [],
    evidenceIds: [],
    patchIds: [],
  };
}

describe('interview patch helpers', () => {
  it('parses quick interview notes into structured fields', () => {
    const fields = parseInterviewQuickNotes(
      ['上级：张三', '部门：地图渲染引擎部', '团队：12人', '变化：Q1裁员约20%'].join('\n'),
    );

    expect(fields.find((field) => field.key === 'managerName')?.value).toBe('张三');
    expect(fields.find((field) => field.key === 'currentDepartment')?.value).toBe('地图渲染引擎部');
    expect(fields.find((field) => field.key === 'teamSize')?.value).toBe('12人');
    expect(fields.find((field) => field.key === 'recentChanges')?.value).toBe('Q1裁员约20%');
  });

  it('suggests manager and department mount targets from the current map', () => {
    const state = createEmptyState();
    state.people.push({
      id: createId('person'),
      name: '张三',
      aliases: [],
      company: '云图地图科技（虚拟）',
      currentTitle: '地图平台总监',
      currentDepartment: '地图渲染引擎部',
      tags: [],
      status: 'active',
      evidenceIds: [],
      updatedAt: nowIso(),
    });
    state.orgUnits.push({
      id: createId('org'),
      company: '云图地图科技（虚拟）',
      name: '地图渲染引擎部',
      status: 'active',
      evidenceIds: [],
      updatedAt: nowIso(),
    });

    const suggestions = suggestMountTargets(
      state,
      '李明',
      '云图地图科技（虚拟）',
      [
        { key: 'managerName', label: '直属上级', value: '张三', confidence: 'high' },
        { key: 'currentDepartment', label: '当前部门', value: '地图渲染引擎部', confidence: 'medium' },
      ],
    );

    expect(suggestions[0]?.targetType).toBe('person');
    expect(suggestions.some((suggestion) => suggestion.targetType === 'orgUnit')).toBe(true);
  });

  it('builds interview artifacts as draft patches and preserves evidence', () => {
    const state = createEmptyState();
    state.people.push({
      id: createId('person'),
      name: '张三',
      aliases: [],
      company: '云图地图科技（虚拟）',
      currentTitle: '地图平台总监',
      currentDepartment: '地图渲染引擎部',
      tags: [],
      status: 'active',
      evidenceIds: [],
      updatedAt: nowIso(),
    });

    const candidate = draftCandidate({ resumeTitle: '地图算法专家', resumeDepartment: '地图渲染引擎部' });
    const session = draftSession(
      candidate.id,
      ['上级：张三', '部门：地图渲染引擎部', '岗位：地图算法专家', '变化：Q1裁员约20%'].join('\n'),
    );

    const artifacts = buildInterviewArtifacts(state, candidate, session);

    expect(artifacts.evidence.length).toBeGreaterThanOrEqual(4);
    expect(artifacts.patches.some((patch) => patch.type === 'person')).toBe(true);
    expect(artifacts.patches.some((patch) => patch.type === 'reportingLine')).toBe(true);
    expect(artifacts.patches.some((patch) => patch.type === 'changeEvent')).toBe(true);
    expect(artifacts.suggestions[0]?.targetType).toBe('person');
  });

  it('suggests follow-up prompts for missing critical org fields', () => {
    const prompts = buildFollowUpPrompts([
      { key: 'currentDepartment', label: '当前部门', value: '地图渲染引擎部', confidence: 'medium' },
    ]);

    expect(prompts.some((prompt) => prompt.id === 'manager')).toBe(true);
    expect(prompts.some((prompt) => prompt.id === 'title')).toBe(true);
    expect(prompts.some((prompt) => prompt.id === 'department-head')).toBe(true);
  });

  it('applies an accepted person patch into the formal org state', () => {
    const state = createEmptyState();
    const patch: MapPatch = {
      id: createId('patch'),
      sessionId: createId('session'),
      type: 'person',
      status: 'accepted',
      payload: {
        name: '李明',
        company: '云图地图科技（虚拟）',
        title: '地图算法专家',
        department: '地图渲染引擎部',
        tags: ['通话新增'],
      },
      evidenceId: createId('ie'),
      confidence: 'medium',
      createdAt: nowIso(),
    };

    const next = applyAcceptedMapPatch(state, patch);
    const person = next.people.find((item) => item.name === '李明');

    expect(person?.currentTitle).toBe('地图算法专家');
    expect(person?.currentDepartment).toBe('地图渲染引擎部');
    expect(person?.evidenceIds).toContain(patch.evidenceId);
  });
});
