import type {
  AnyCandidatePayload,
  AppState,
  CandidateRecord,
  ChangeCandidatePayload,
  OrgUnit,
  OrgUnitCandidatePayload,
  Person,
  PersonCandidatePayload,
  ReportingCandidatePayload,
  RoleCandidatePayload,
} from '../types';
import { createId, normalizeName, nowIso } from './ids';

function addUnique(values: string[], next?: string): string[] {
  if (!next) return values;
  return values.includes(next) ? values : [...values, next];
}

function isRolePayload(payload: unknown): payload is RoleCandidatePayload {
  return Boolean(payload && typeof payload === 'object' && 'personName' in payload && 'title' in payload);
}

function isPersonPayload(payload: unknown): payload is PersonCandidatePayload {
  return Boolean(payload && typeof payload === 'object' && 'name' in payload);
}

function isOrgPayload(payload: unknown): payload is OrgUnitCandidatePayload {
  return Boolean(payload && typeof payload === 'object' && 'name' in payload);
}

function isReportingPayload(payload: unknown): payload is ReportingCandidatePayload {
  return Boolean(payload && typeof payload === 'object' && 'subordinateName' in payload && 'managerName' in payload);
}

function isChangePayload(payload: unknown): payload is ChangeCandidatePayload {
  return Boolean(payload && typeof payload === 'object' && 'type' in payload && 'description' in payload);
}

function findPerson(people: Person[], name: string): Person | undefined {
  const normalized = normalizeName(name);
  return people.find(
    (person) =>
      normalizeName(person.name) === normalized ||
      person.aliases.some((alias) => normalizeName(alias) === normalized),
  );
}

function upsertPerson(
  state: AppState,
  input: {
    name: string;
    company?: string;
    title?: string;
    department?: string;
    evidenceId: string;
    status?: Person['status'];
  },
): Person {
  const timestamp = nowIso();
  let person = findPerson(state.people, input.name);

  if (!person) {
    person = {
      id: createId('person'),
      name: input.name,
      aliases: [],
      company: input.company,
      currentTitle: input.title,
      currentDepartment: input.department,
      tags: [],
      status: input.status ?? 'unknown',
      evidenceIds: [input.evidenceId],
      updatedAt: timestamp,
    };
    state.people.push(person);
    return person;
  }

  person.company = input.company ?? person.company;
  person.currentTitle = input.title ?? person.currentTitle;
  person.currentDepartment = input.department ?? person.currentDepartment;
  person.status = input.status ?? person.status;
  person.evidenceIds = addUnique(person.evidenceIds, input.evidenceId);
  person.updatedAt = timestamp;
  return person;
}

function findOrgUnit(orgUnits: OrgUnit[], name: string, company?: string): OrgUnit | undefined {
  const normalized = normalizeName(name);
  return orgUnits.find(
    (unit) => normalizeName(unit.name) === normalized && (!company || unit.company === company),
  );
}

function upsertOrgUnit(
  state: AppState,
  input: {
    name: string;
    company?: string;
    function?: string;
    parentName?: string;
    evidenceId: string;
  },
): OrgUnit {
  const timestamp = nowIso();
  const company = input.company || '未知公司';
  let unit = findOrgUnit(state.orgUnits, input.name, company);

  if (!unit) {
    unit = {
      id: createId('org'),
      company,
      name: input.name,
      function: input.function,
      status: 'active',
      evidenceIds: [input.evidenceId],
      updatedAt: timestamp,
    };
    state.orgUnits.push(unit);
  } else {
    unit.function = input.function ?? unit.function;
    unit.evidenceIds = addUnique(unit.evidenceIds, input.evidenceId);
    unit.updatedAt = timestamp;
  }

  state.project.companies = addUnique(state.project.companies, company);
  return unit;
}

function mergeAcceptedCandidate(state: AppState, candidate: CandidateRecord<AnyCandidatePayload>): void {
  const timestamp = nowIso();

  if (candidate.kind === 'person' && isPersonPayload(candidate.payload)) {
    upsertPerson(state, {
      name: candidate.payload.name,
      company: candidate.payload.company,
      title: candidate.payload.title,
      department: candidate.payload.department,
      evidenceId: candidate.evidenceId,
      status: 'active',
    });
    return;
  }

  if (candidate.kind === 'orgUnit' && isOrgPayload(candidate.payload)) {
    upsertOrgUnit(state, {
      name: candidate.payload.name,
      company: candidate.payload.company,
      function: candidate.payload.function,
      parentName: candidate.payload.parentName,
      evidenceId: candidate.evidenceId,
    });
    return;
  }

  if (candidate.kind === 'roleAssignment' && isRolePayload(candidate.payload)) {
    const payload = candidate.payload;
    const person = upsertPerson(state, {
      name: payload.personName,
      company: payload.company,
      title: payload.title,
      department: payload.orgUnitName,
      evidenceId: candidate.evidenceId,
      status: 'active',
    });
    const orgUnit = payload.orgUnitName
      ? upsertOrgUnit(state, {
          name: payload.orgUnitName,
          company: payload.company,
          evidenceId: candidate.evidenceId,
        })
      : undefined;

    const existing = state.roleAssignments.find(
      (role) =>
        normalizeName(role.personName) === normalizeName(payload.personName) &&
        normalizeName(role.title) === normalizeName(payload.title),
    );

    if (existing) {
      existing.company = payload.company ?? existing.company;
      existing.orgUnitName = payload.orgUnitName ?? existing.orgUnitName;
      existing.orgUnitId = orgUnit?.id ?? existing.orgUnitId;
      existing.status = 'current';
      existing.evidenceIds = addUnique(existing.evidenceIds, candidate.evidenceId);
      existing.updatedAt = timestamp;
    } else {
      state.roleAssignments.push({
        id: createId('role'),
        personId: person.id,
        personName: payload.personName,
        title: payload.title,
        orgUnitId: orgUnit?.id,
        orgUnitName: payload.orgUnitName,
        company: payload.company,
        effectiveDate: payload.effectiveDate,
        status: 'current',
        evidenceIds: [candidate.evidenceId],
        updatedAt: timestamp,
      });
    }
    return;
  }

  if (candidate.kind === 'reportingLine' && isReportingPayload(candidate.payload)) {
    const payload = candidate.payload;
    const subordinate = upsertPerson(state, {
      name: payload.subordinateName,
      evidenceId: candidate.evidenceId,
      status: 'active',
    });
    const manager = upsertPerson(state, {
      name: payload.managerName,
      evidenceId: candidate.evidenceId,
      status: 'active',
    });
    const existing = state.reportingLines.find(
      (line) =>
        normalizeName(line.subordinateName) === normalizeName(payload.subordinateName) &&
        normalizeName(line.managerName) === normalizeName(payload.managerName),
    );

    if (existing) {
      existing.confidence = Math.max(existing.confidence, candidate.confidence);
      existing.evidenceIds = addUnique(existing.evidenceIds, candidate.evidenceId);
      existing.isCurrent = true;
      existing.updatedAt = timestamp;
    } else {
      state.reportingLines.push({
        id: createId('line'),
        subordinateId: subordinate.id,
        subordinateName: payload.subordinateName,
        managerId: manager.id,
        managerName: payload.managerName,
        relationType: payload.relationType,
        confidence: candidate.confidence,
        evidenceIds: [candidate.evidenceId],
        isCurrent: true,
        updatedAt: timestamp,
      });
    }
    return;
  }

  if (candidate.kind === 'changeEvent' && isChangePayload(candidate.payload)) {
    const person = candidate.payload.personName
      ? upsertPerson(state, {
          name: candidate.payload.personName,
          evidenceId: candidate.evidenceId,
          status: candidate.payload.type === 'resigned' ? 'left' : 'active',
        })
      : undefined;

    state.changeEvents.push({
      id: createId('change'),
      personId: person?.id,
      personName: candidate.payload.personName,
      type: candidate.payload.type,
      description: candidate.payload.description,
      date: candidate.payload.date,
      sourceName: candidate.sourceName,
      evidenceIds: [candidate.evidenceId],
      createdAt: timestamp,
    });
  }
}

export function updateCandidateStatus(
  current: AppState,
  candidateIds: string[],
  status: 'accepted' | 'rejected',
): AppState {
  const selected = new Set(candidateIds);
  const next: AppState = structuredClone(current);

  for (const candidate of next.candidates) {
    if (!selected.has(candidate.id) || candidate.status !== 'pending') continue;
    candidate.status = status;
    if (status === 'accepted') {
      mergeAcceptedCandidate(next, candidate);
    }
  }

  next.project.updatedAt = nowIso();
  return next;
}

export function addImportResult(current: AppState, result: {
  source: AppState['sources'][number];
  evidence: AppState['evidence'];
  candidates: AppState['candidates'];
}): AppState {
  const next: AppState = structuredClone(current);
  const existingSource = next.sources.find((source) => source.hash === result.source.hash);

  if (existingSource) {
    const duplicateWarning = `已导入过 ${result.source.fileName}，本次未重复加入。`;
    existingSource.warnings = addUnique(existingSource.warnings ?? [], duplicateWarning);
    return next;
  }

  next.sources.unshift(result.source);
  next.evidence.unshift(...result.evidence);
  next.candidates.unshift(...result.candidates);
  next.project.updatedAt = nowIso();
  return next;
}
