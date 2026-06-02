import { createId, normalizeName, nowIso } from './ids';
import type {
  AppState,
  CandidateProfile,
  ChangeEvent,
  EvidenceConfidence,
  InterviewEvidence,
  InterviewField,
  InterviewSession,
  MapPatch,
  OrgUnit,
  Person,
  ReportingLine,
  RoleAssignment,
} from '../types';

export interface MountSuggestion {
  targetType: 'person' | 'orgUnit' | 'newOrgUnit' | 'unassigned';
  targetId?: string;
  label: string;
  reason: string;
  confidence: EvidenceConfidence;
}

const INTERVIEW_FIELD_LABELS: Record<InterviewField['key'], string> = {
  currentTitle: '当前岗位',
  currentDepartment: '当前部门',
  managerName: '直属上级',
  departmentHead: '部门一号位',
  teamSize: '团队规模',
  peerTeams: '平级团队',
  directReports: '下属情况',
  recentChanges: '近期变化',
  rawNote: '备注',
};

const QUICK_NOTE_PATTERNS: Array<{ regex: RegExp; key: InterviewField['key'] }> = [
  { regex: /^(上级|直属上级|汇报给)[:：\s]+(.+)$/i, key: 'managerName' },
  { regex: /^(部门一号位|一号位)[:：\s]+(.+)$/i, key: 'departmentHead' },
  { regex: /^(部门|当前部门|所在部门)[:：\s]+(.+)$/i, key: 'currentDepartment' },
  { regex: /^(岗位|当前岗位|title|职级岗位)[:：\s]+(.+)$/i, key: 'currentTitle' },
  { regex: /^(团队|团队规模)[:：\s]+(.+)$/i, key: 'teamSize' },
  { regex: /^(平级|平级团队)[:：\s]+(.+)$/i, key: 'peerTeams' },
  { regex: /^(下属|直属下属)[:：\s]+(.+)$/i, key: 'directReports' },
  { regex: /^(变化|组织变化|调整)[:：\s]+(.+)$/i, key: 'recentChanges' },
  { regex: /^(备注)[:：\s]+(.+)$/i, key: 'rawNote' },
];

function confidenceFromText(value: string): EvidenceConfidence {
  if (/确定|明确|直接汇报|就是|就是我上级/.test(value)) return 'high';
  if (/大概|可能|听说|不确定|应该算/.test(value)) return 'low';
  return 'medium';
}

export function labelForInterviewField(key: InterviewField['key']): string {
  return INTERVIEW_FIELD_LABELS[key];
}

export function getInterviewFieldValue(fields: InterviewField[], key: InterviewField['key']): string {
  return fields.find((field) => field.key === key)?.value ?? '';
}

export function upsertInterviewField(
  fields: InterviewField[],
  key: InterviewField['key'],
  value: string,
  confidence: EvidenceConfidence = 'medium',
): InterviewField[] {
  const trimmed = value.trim();
  const next = fields.filter((field) => field.key !== key);
  if (!trimmed) return next;
  next.push({
    key,
    label: labelForInterviewField(key),
    value: trimmed,
    confidence,
  });
  return next;
}

export function parseInterviewQuickNotes(text: string): InterviewField[] {
  const fields: InterviewField[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const matched = QUICK_NOTE_PATTERNS.find((pattern) => pattern.regex.test(line));
    if (!matched) continue;
    const match = line.match(matched.regex);
    const value = match?.[2]?.trim() ?? '';
    if (!value) continue;
    const nextField = {
      key: matched.key,
      label: labelForInterviewField(matched.key),
      value,
      confidence: confidenceFromText(value),
    } satisfies InterviewField;
    const existingIndex = fields.findIndex((field) => field.key === matched.key);
    if (existingIndex >= 0) fields[existingIndex] = nextField;
    else fields.push(nextField);
  }

  return fields;
}

export function mergeInterviewFields(existing: InterviewField[], parsed: InterviewField[]): InterviewField[] {
  return parsed.reduce(
    (current, field) => upsertInterviewField(current, field.key, field.value, field.confidence),
    existing,
  );
}

function findExactPerson(name: string, people: Person[]): Person | undefined {
  const normalized = normalizeName(name);
  if (!normalized) return undefined;
  return people.find((person) => normalizeName(person.name) === normalized);
}

function findFuzzyPeople(name: string, people: Person[]): Person[] {
  const normalized = normalizeName(name);
  if (!normalized) return [];
  return people.filter((person) => {
    const current = normalizeName(person.name);
    return current === normalized || current.includes(normalized) || normalized.includes(current);
  });
}

function findExactOrgUnit(company: string | undefined, name: string, orgUnits: OrgUnit[]): OrgUnit | undefined {
  const normalized = normalizeName(name);
  if (!normalized) return undefined;
  return orgUnits.find((unit) => {
    if (company && unit.company !== company) return false;
    return normalizeName(unit.name) === normalized;
  });
}

function findFuzzyOrgUnits(company: string | undefined, name: string, orgUnits: OrgUnit[]): OrgUnit[] {
  const normalized = normalizeName(name);
  if (!normalized) return [];
  return orgUnits.filter((unit) => {
    if (company && unit.company !== company) return false;
    const current = normalizeName(unit.name);
    return current === normalized || current.includes(normalized) || normalized.includes(current);
  });
}

export function suggestMountTargets(
  state: AppState,
  candidateName: string,
  company: string | undefined,
  fields: InterviewField[],
): MountSuggestion[] {
  const suggestions: MountSuggestion[] = [];
  const managerName = getInterviewFieldValue(fields, 'managerName');
  const departmentName = getInterviewFieldValue(fields, 'currentDepartment');

  if (managerName) {
    const exactManager = findExactPerson(managerName, state.people);
    if (exactManager) {
      suggestions.push({
        targetType: 'person',
        targetId: exactManager.id,
        label: `挂到上级 ${exactManager.name} 下`,
        reason: '候选人明确提供了直属上级',
        confidence: 'high',
      });
    } else {
      for (const person of findFuzzyPeople(managerName, state.people).slice(0, 3)) {
        suggestions.push({
          targetType: 'person',
          targetId: person.id,
          label: `可能挂到 ${person.name} 下`,
          reason: '上级姓名模糊匹配',
          confidence: 'medium',
        });
      }
    }
  }

  if (departmentName) {
    const exactOrg = findExactOrgUnit(company, departmentName, state.orgUnits);
    if (exactOrg) {
      suggestions.push({
        targetType: 'orgUnit',
        targetId: exactOrg.id,
        label: `挂到部门 ${exactOrg.name}`,
        reason: '部门名称精确匹配',
        confidence: managerName ? 'medium' : 'high',
      });
    } else {
      for (const orgUnit of findFuzzyOrgUnits(company, departmentName, state.orgUnits).slice(0, 3)) {
        suggestions.push({
          targetType: 'orgUnit',
          targetId: orgUnit.id,
          label: `可能挂到部门 ${orgUnit.name}`,
          reason: '部门名称模糊匹配',
          confidence: 'low',
        });
      }
      suggestions.push({
        targetType: 'newOrgUnit',
        label: `新建待确认部门 ${departmentName}`,
        reason: '当前图中未找到匹配部门',
        confidence: 'low',
      });
    }
  }

  if (!managerName && !departmentName && candidateName.trim()) {
    suggestions.push({
      targetType: 'unassigned',
      label: `先放入待归属人员池`,
      reason: '暂未识别到上级或部门',
      confidence: 'low',
    });
  }

  return suggestions;
}

function fieldConfidence(fields: InterviewField[], key: InterviewField['key']): EvidenceConfidence {
  return fields.find((field) => field.key === key)?.confidence ?? 'medium';
}

function confidenceToNumber(confidence: EvidenceConfidence): number {
  return confidence === 'high' ? 0.92 : confidence === 'medium' ? 0.74 : 0.52;
}

export interface InterviewArtifacts {
  mergedFields: InterviewField[];
  evidence: InterviewEvidence[];
  patches: MapPatch[];
  suggestions: MountSuggestion[];
  matchedPersonId?: string;
}

export function buildInterviewArtifacts(
  state: AppState,
  candidate: CandidateProfile,
  session: InterviewSession,
): InterviewArtifacts {
  const parsedFields = parseInterviewQuickNotes(session.rawNotes);
  const mergedFields = mergeInterviewFields(session.structuredNotes, parsedFields);
  const company = candidate.company?.trim() || undefined;
  const candidateName = candidate.name.trim();
  const suggestions = suggestMountTargets(state, candidateName, company, mergedFields);
  const now = nowIso();

  const evidence: InterviewEvidence[] = mergedFields
    .filter((field) => field.value.trim())
    .map((field) => ({
      id: createId('ie'),
      sessionId: session.id,
      text: `${field.label}：${field.value.trim()}`,
      field: field.key,
      confidence: field.confidence,
      createdAt: now,
    }));

  if (session.rawNotes.trim()) {
    evidence.push({
      id: createId('ie'),
      sessionId: session.id,
      text: session.rawNotes.trim(),
      field: 'rawNote',
      confidence: 'medium',
      createdAt: now,
    });
  }

  const evidenceByField = new Map<string, InterviewEvidence>();
  for (const item of evidence) {
    if (item.field && !evidenceByField.has(item.field)) evidenceByField.set(item.field, item);
  }

  const exactPerson = findExactPerson(candidateName, state.people);
  const patches: MapPatch[] = [];

  if (candidateName && !exactPerson) {
    const personEvidence = evidenceByField.get('currentDepartment') ?? evidence[0];
    if (personEvidence) {
      patches.push({
        id: createId('patch'),
        sessionId: session.id,
        type: 'person',
        status: 'draft',
        payload: {
          name: candidateName,
          company,
          title: getInterviewFieldValue(mergedFields, 'currentTitle') || candidate.resumeTitle,
          department: getInterviewFieldValue(mergedFields, 'currentDepartment') || candidate.resumeDepartment,
          tags: ['通话新增', '待确认'],
        },
        evidenceId: personEvidence.id,
        confidence: personEvidence.confidence,
        createdAt: now,
      });
    }
  }

  const departmentName = getInterviewFieldValue(mergedFields, 'currentDepartment');
  if (departmentName && !findExactOrgUnit(company, departmentName, state.orgUnits)) {
    const orgEvidence = evidenceByField.get('currentDepartment');
    if (orgEvidence) {
      patches.push({
        id: createId('patch'),
        sessionId: session.id,
        type: 'orgUnit',
        status: 'draft',
        payload: {
          name: departmentName,
          company,
          status: 'unknown',
        },
        evidenceId: orgEvidence.id,
        confidence: orgEvidence.confidence,
        createdAt: now,
      });
    }
  }

  const currentTitle = getInterviewFieldValue(mergedFields, 'currentTitle') || candidate.resumeTitle;
  if (candidateName && (currentTitle || departmentName || company)) {
    const roleEvidence =
      evidenceByField.get('currentTitle') ??
      evidenceByField.get('currentDepartment') ??
      evidence[0];
    if (roleEvidence) {
      patches.push({
        id: createId('patch'),
        sessionId: session.id,
        type: 'roleAssignment',
        status: 'draft',
        payload: {
          personName: candidateName,
          title: currentTitle || '岗位待确认',
          orgUnitName: departmentName || candidate.resumeDepartment,
          company,
          status: 'uncertain',
        },
        evidenceId: roleEvidence.id,
        confidence: roleEvidence.confidence,
        createdAt: now,
      });
    }
  }

  const managerName = getInterviewFieldValue(mergedFields, 'managerName');
  if (candidateName && managerName) {
    const managerEvidence = evidenceByField.get('managerName');
    if (managerEvidence) {
      const existingLine = exactPerson
        ? state.reportingLines.find(
            (line) =>
              line.isCurrent &&
              normalizeName(line.subordinateName) === normalizeName(candidateName),
          )
        : undefined;
      patches.push({
        id: createId('patch'),
        sessionId: session.id,
        type: 'reportingLine',
        status:
          existingLine && normalizeName(existingLine.managerName) !== normalizeName(managerName) ? 'conflict' : 'draft',
        payload: {
          subordinateName: candidateName,
          managerName,
          relationType: 'reports-to',
          isCurrent: true,
        },
        evidenceId: managerEvidence.id,
        confidence: managerEvidence.confidence,
        createdAt: now,
      });
    }
  }

  for (const key of ['teamSize', 'peerTeams', 'directReports', 'recentChanges', 'rawNote'] as const) {
    const value = getInterviewFieldValue(mergedFields, key);
    const fieldEvidence = evidenceByField.get(key);
    if (!value || !fieldEvidence) continue;
    patches.push({
      id: createId('patch'),
      sessionId: session.id,
      type: 'changeEvent',
      status: 'draft',
      payload: {
        personName: candidateName || undefined,
        type: key === 'recentChanges' ? 'new' : 'conflict',
        description: `${labelForInterviewField(key)}：${value}`,
        sourceName: '候选人通话',
      },
      evidenceId: fieldEvidence.id,
      confidence: fieldEvidence.confidence,
      createdAt: now,
    });
  }

  return {
    mergedFields,
    evidence,
    patches,
    suggestions,
    matchedPersonId: exactPerson?.id,
  };
}

function arrayWithUnique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function applyPersonPatch(state: AppState, patch: MapPatch): AppState {
  const payload = patch.payload as { name: string; company?: string; title?: string; department?: string; tags?: string[] };
  const existing = findExactPerson(payload.name, state.people);
  const timestamp = nowIso();

  if (existing) {
    existing.company = payload.company ?? existing.company;
    existing.currentTitle = payload.title ?? existing.currentTitle;
    existing.currentDepartment = payload.department ?? existing.currentDepartment;
    existing.tags = arrayWithUnique([...(existing.tags ?? []), ...(payload.tags ?? [])]);
    existing.evidenceIds = arrayWithUnique([...existing.evidenceIds, patch.evidenceId]);
    existing.updatedAt = timestamp;
  } else {
    state.people.push({
      id: createId('person'),
      name: payload.name,
      aliases: [],
      company: payload.company,
      currentTitle: payload.title,
      currentDepartment: payload.department,
      tags: payload.tags ?? ['通话新增'],
      status: 'unknown',
      evidenceIds: [patch.evidenceId],
      updatedAt: timestamp,
    });
  }

  return state;
}

function applyOrgUnitPatch(state: AppState, patch: MapPatch): AppState {
  const payload = patch.payload as { name: string; company?: string; status?: OrgUnit['status'] };
  const timestamp = nowIso();
  const existing = findExactOrgUnit(payload.company, payload.name, state.orgUnits);
  if (existing) {
    existing.status = payload.status ?? existing.status;
    existing.evidenceIds = arrayWithUnique([...existing.evidenceIds, patch.evidenceId]);
    existing.updatedAt = timestamp;
  } else {
    state.orgUnits.push({
      id: createId('org'),
      company: payload.company ?? state.project.companies[0] ?? '待确认公司',
      name: payload.name,
      status: payload.status ?? 'unknown',
      evidenceIds: [patch.evidenceId],
      updatedAt: timestamp,
    });
  }
  return state;
}

function applyRoleAssignmentPatch(state: AppState, patch: MapPatch): AppState {
  const payload = patch.payload as {
    personName: string;
    title: string;
    orgUnitName?: string;
    company?: string;
    status?: RoleAssignment['status'];
  };
  const existing = state.roleAssignments.find(
    (role) =>
      normalizeName(role.personName) === normalizeName(payload.personName) &&
      role.title === payload.title &&
      normalizeName(role.orgUnitName ?? '') === normalizeName(payload.orgUnitName ?? ''),
  );
  const timestamp = nowIso();
  const person = findExactPerson(payload.personName, state.people);

  if (existing) {
    existing.company = payload.company ?? existing.company;
    existing.orgUnitName = payload.orgUnitName ?? existing.orgUnitName;
    existing.personId = person?.id ?? existing.personId;
    existing.status = payload.status ?? existing.status;
    existing.evidenceIds = arrayWithUnique([...existing.evidenceIds, patch.evidenceId]);
    existing.updatedAt = timestamp;
  } else {
    state.roleAssignments.push({
      id: createId('role'),
      personId: person?.id,
      personName: payload.personName,
      title: payload.title,
      orgUnitName: payload.orgUnitName,
      company: payload.company,
      status: payload.status ?? 'uncertain',
      evidenceIds: [patch.evidenceId],
      updatedAt: timestamp,
    });
  }

  return state;
}

function applyReportingLinePatch(state: AppState, patch: MapPatch): AppState {
  const payload = patch.payload as {
    subordinateName: string;
    managerName: string;
    relationType: ReportingLine['relationType'];
    isCurrent?: boolean;
  };
  const timestamp = nowIso();
  const subordinate = findExactPerson(payload.subordinateName, state.people);
  const manager = findExactPerson(payload.managerName, state.people);
  const existing = state.reportingLines.find(
    (line) =>
      normalizeName(line.subordinateName) === normalizeName(payload.subordinateName) &&
      normalizeName(line.managerName) === normalizeName(payload.managerName) &&
      line.relationType === payload.relationType,
  );

  if (existing) {
    existing.subordinateId = subordinate?.id ?? existing.subordinateId;
    existing.managerId = manager?.id ?? existing.managerId;
    existing.confidence = Math.max(existing.confidence, confidenceToNumber(patch.confidence));
    existing.evidenceIds = arrayWithUnique([...existing.evidenceIds, patch.evidenceId]);
    existing.isCurrent = payload.isCurrent ?? existing.isCurrent;
    existing.updatedAt = timestamp;
  } else {
    state.reportingLines.push({
      id: createId('line'),
      subordinateId: subordinate?.id,
      subordinateName: payload.subordinateName,
      managerId: manager?.id,
      managerName: payload.managerName,
      relationType: payload.relationType,
      confidence: confidenceToNumber(patch.confidence),
      evidenceIds: [patch.evidenceId],
      isCurrent: payload.isCurrent ?? true,
      updatedAt: timestamp,
    });
  }

  return state;
}

function applyChangeEventPatch(state: AppState, patch: MapPatch): AppState {
  const payload = patch.payload as {
    personName?: string;
    type?: ChangeEvent['type'];
    description: string;
    sourceName?: string;
  };
  state.changeEvents.unshift({
    id: createId('change'),
    personName: payload.personName,
    type: payload.type ?? 'new',
    description: payload.description,
    sourceName: payload.sourceName ?? '候选人通话',
    evidenceIds: [patch.evidenceId],
    createdAt: nowIso(),
  });
  return state;
}

export function applyAcceptedMapPatch(state: AppState, patch: MapPatch): AppState {
  const next = structuredClone(state);
  switch (patch.type) {
    case 'person':
      return applyPersonPatch(next, patch);
    case 'orgUnit':
      return applyOrgUnitPatch(next, patch);
    case 'roleAssignment':
      return applyRoleAssignmentPatch(next, patch);
    case 'reportingLine':
      return applyReportingLinePatch(next, patch);
    case 'changeEvent':
      return applyChangeEventPatch(next, patch);
    default:
      return next;
  }
}
