import type {
  AnyCandidatePayload,
  CandidateKind,
  CandidateRecord,
  ReportingLine,
  RoleAssignment,
  SourceDocument,
} from '../types';
import { normalizeName } from './ids';

export type ReviewQueueKey = 'priority' | 'review' | 'manual' | 'all';

export interface ReviewQueueBucket {
  key: ReviewQueueKey;
  label: string;
  description: string;
  count: number;
  candidateIds: string[];
  sourceIds: string[];
}

export interface ReviewSourceAlert {
  id: string;
  fileName: string;
  type: SourceDocument['type'];
  severity: 'warning' | 'manual';
  title: string;
  message: string;
}

function isRolePayload(payload: AnyCandidatePayload): payload is Extract<AnyCandidatePayload, { personName: string; title: string }> {
  return 'personName' in payload && 'title' in payload;
}

function isReportingPayload(
  payload: AnyCandidatePayload,
): payload is Extract<AnyCandidatePayload, { subordinateName: string; managerName: string }> {
  return 'subordinateName' in payload && 'managerName' in payload;
}

function warningContainsAny(warnings: string[], keywords: string[]): boolean {
  return warnings.some((warning) => keywords.some((keyword) => warning.includes(keyword)));
}

function sourceNeedsManualFollowUp(source: SourceDocument): boolean {
  if (source.type === 'ocr') return true;
  const warnings = source.warnings ?? [];
  return warningContainsAny(warnings, ['OCR 失败', '手动补充', '手工补录', '没有解析到可抽取文本', '未解析到可选中文字']);
}

function sourceHasImagePageWarning(source: SourceDocument): boolean {
  const warnings = source.warnings ?? [];
  return warningContainsAny(warnings, ['发现 ', '图片', '截图', 'OCR']);
}

function buildConflictIds(
  candidates: CandidateRecord<AnyCandidatePayload>[],
  roleAssignments: RoleAssignment[],
  reportingLines: ReportingLine[],
): Set<string> {
  const conflictIds = new Set<string>();
  const roleByPerson = new Map<string, Set<string>>();
  const managerBySubordinate = new Map<string, Set<string>>();

  for (const candidate of candidates) {
    if (candidate.status !== 'pending') continue;
    const payload = candidate.payload;

    if (isRolePayload(payload)) {
      const personKey = normalizeName(payload.personName);
      const signature = `${normalizeName(payload.title)}::${normalizeName(payload.orgUnitName ?? '')}`;
      const signatures = roleByPerson.get(personKey) ?? new Set<string>();
      signatures.add(signature);
      roleByPerson.set(personKey, signatures);

      const existingRoles = roleAssignments.filter(
        (role) =>
          role.status === 'current' &&
          normalizeName(role.personName) === personKey &&
          `${normalizeName(role.title)}::${normalizeName(role.orgUnitName ?? '')}` !== signature,
      );
      if (existingRoles.length > 0) conflictIds.add(candidate.id);
    }

    if (isReportingPayload(payload)) {
      const subordinateKey = normalizeName(payload.subordinateName);
      const managerKey = normalizeName(payload.managerName);
      const managers = managerBySubordinate.get(subordinateKey) ?? new Set<string>();
      managers.add(managerKey);
      managerBySubordinate.set(subordinateKey, managers);

      const existingLines = reportingLines.filter(
        (line) =>
          line.isCurrent &&
          normalizeName(line.subordinateName) === subordinateKey &&
          normalizeName(line.managerName) !== managerKey,
      );
      if (existingLines.length > 0) conflictIds.add(candidate.id);
    }
  }

  for (const candidate of candidates) {
    if (candidate.status !== 'pending') continue;
    const payload = candidate.payload;

    if (isRolePayload(payload)) {
      const personKey = normalizeName(payload.personName);
      if ((roleByPerson.get(personKey)?.size ?? 0) > 1) {
        conflictIds.add(candidate.id);
      }
    }

    if (isReportingPayload(payload)) {
      const subordinateKey = normalizeName(payload.subordinateName);
      if ((managerBySubordinate.get(subordinateKey)?.size ?? 0) > 1) {
        conflictIds.add(candidate.id);
      }
    }
  }

  return conflictIds;
}

export function buildReviewQueueBuckets(
  candidates: CandidateRecord<AnyCandidatePayload>[],
  sources: SourceDocument[],
  roleAssignments: RoleAssignment[],
  reportingLines: ReportingLine[],
): ReviewQueueBucket[] {
  const pending = candidates.filter((candidate) => candidate.status === 'pending');
  const conflictIds = buildConflictIds(pending, roleAssignments, reportingLines);
  const sourceByName = new Map(sources.map((source) => [source.fileName, source]));

  const manualCandidateIds: string[] = [];
  const reviewCandidateIds: string[] = [];
  const priorityCandidateIds: string[] = [];

  for (const candidate of pending) {
    const source = sourceByName.get(candidate.sourceName);
    const fromManualSource =
      (source ? sourceNeedsManualFollowUp(source) : false) ||
      candidate.evidenceText.includes('图片 OCR') ||
      candidate.evidenceText.includes('OCR');
    const inConflict = conflictIds.has(candidate.id);

    if (fromManualSource) {
      manualCandidateIds.push(candidate.id);
      continue;
    }

    if (inConflict || candidate.confidence < 0.82) {
      reviewCandidateIds.push(candidate.id);
      continue;
    }

    priorityCandidateIds.push(candidate.id);
  }

  const allCandidateIds = pending.map((candidate) => candidate.id);
  const sourceFileNamesWithPendingCandidates = new Set(pending.map((candidate) => candidate.sourceName));
  const sourceOnlyManualIds = sources
    .filter((source) => sourceNeedsManualFollowUp(source))
    .filter((source) => !sourceFileNamesWithPendingCandidates.has(source.fileName))
    .map((source) => source.id);

  return [
    {
      key: 'priority',
      label: '优先确认',
      description: '高置信候选，可先并入正式图',
      count: priorityCandidateIds.length,
      candidateIds: priorityCandidateIds,
      sourceIds: [],
    },
    {
      key: 'review',
      label: '待复核',
      description: '低置信候选或与现有结构冲突',
      count: reviewCandidateIds.length,
      candidateIds: reviewCandidateIds,
      sourceIds: [],
    },
    {
      key: 'manual',
      label: '截图待补录',
      description: '截图或 OCR 线索，建议人工确认后再入图',
      count: manualCandidateIds.length + sourceOnlyManualIds.length,
      candidateIds: manualCandidateIds,
      sourceIds: sourceOnlyManualIds,
    },
    {
      key: 'all',
      label: '全部候选',
      description: '当前导入生成的全部待确认候选',
      count: allCandidateIds.length,
      candidateIds: allCandidateIds,
      sourceIds: [],
    },
  ];
}

export function buildReviewSourceAlerts(sources: SourceDocument[]): ReviewSourceAlert[] {
  return sources
    .filter((source) => (source.warnings?.length ?? 0) > 0)
    .map((source) => {
      const manual = sourceNeedsManualFollowUp(source);
      return {
        id: source.id,
        fileName: source.fileName,
        type: source.type,
        severity: manual ? 'manual' : 'warning',
        title: manual ? '截图或图片资料待补录' : sourceHasImagePageWarning(source) ? '图片页待复核' : '来源需复核',
        message: (source.warnings ?? []).join('；'),
      } satisfies ReviewSourceAlert;
    });
}

export function candidateQueueNote(
  candidate: CandidateRecord<AnyCandidatePayload>,
  sources: SourceDocument[],
  roleAssignments: RoleAssignment[],
  reportingLines: ReportingLine[],
): ReviewQueueKey {
  return (
    buildReviewQueueBuckets([candidate], sources, roleAssignments, reportingLines).find(
      (bucket) => bucket.key !== 'all' && bucket.candidateIds.includes(candidate.id),
    )?.key ?? 'review'
  );
}

export function candidateKindCounts(candidates: CandidateRecord<AnyCandidatePayload>[]): Array<{
  kind: CandidateKind;
  count: number;
}> {
  const kinds: CandidateKind[] = ['person', 'orgUnit', 'roleAssignment', 'reportingLine', 'changeEvent'];
  return kinds.map((kind) => ({
    kind,
    count: candidates.filter((candidate) => candidate.kind === kind).length,
  }));
}
