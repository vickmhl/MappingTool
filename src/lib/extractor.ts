import type {
  AnyCandidatePayload,
  CandidateKind,
  CandidateRecord,
  ChangeCandidatePayload,
  EvidenceChunk,
  ImportResult,
  OrgUnitCandidatePayload,
  PersonCandidatePayload,
  ReportingCandidatePayload,
  RoleCandidatePayload,
  SourceDocument,
} from '../types';
import { clamp, createId, nowIso, normalizeName } from './ids';

const CHINESE_NAME = '[\\u4e00-\\u9fa5]{2,4}';
const TITLE_WORDS =
  'CEO|CTO|CFO|COO|CHRO|CPO|VP|SVP|总裁|副总裁|总经理|负责人|总监|经理|主管|总助|HRD|HRBP|Head|Director|Leader|Owner';
const ORG_SUFFIX = '事业部|部门|中心|团队|BU|平台|产品部|销售部|研发部|算法部|数据部|人力资源部|HR部|财务部|市场部|运营部';

const COMPANY_REGEX = /([\u4e00-\u9fa5A-Za-z0-9]{2,24}(?:公司|集团|科技|智能|网络|股份|有限|控股))/;
const ORG_REGEX = new RegExp(`([\\u4e00-\\u9fa5A-Za-z0-9（）()·\\-/]{2,28}(?:${ORG_SUFFIX}))`, 'gi');

export function splitIntoChunks(text: string, maxLength = 420): string[] {
  const normalized = text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) {
    return [];
  }

  const roughParts = normalized
    .split(/(?<=[。！？!?；;])|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buffer = '';

  for (const part of roughParts) {
    if ((buffer + part).length > maxLength && buffer) {
      chunks.push(buffer.trim());
      buffer = '';
    }
    buffer = `${buffer}${buffer ? ' ' : ''}${part}`;
  }

  if (buffer.trim()) {
    chunks.push(buffer.trim());
  }

  return chunks;
}

export function extractDate(text: string): string | undefined {
  const yearMonthDay = text.match(/(20\d{2})[年/-](\d{1,2})(?:[月/-](\d{1,2})日?)?/);
  if (yearMonthDay) {
    const [, year, month, day = '1'] = yearMonthDay;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const relative = text.match(/(今年|去年|上个月|本月|最近|近期)/);
  return relative ? relative[1] : undefined;
}

function detectCompany(text: string): string | undefined {
  return text.match(COMPANY_REGEX)?.[1];
}

function detectOrgUnit(text: string): string | undefined {
  ORG_REGEX.lastIndex = 0;
  return ORG_REGEX.exec(text)?.[1];
}

function detectFunction(orgName: string): string | undefined {
  if (/产品/.test(orgName)) return '产品';
  if (/销售|商业|市场|客户|渠道/.test(orgName)) return '商业化';
  if (/研发|技术|算法|数据|平台/.test(orgName)) return '研发技术';
  if (/人力|HR|招聘/.test(orgName)) return '人力资源';
  if (/财务|法务|合规/.test(orgName)) return '职能';
  return undefined;
}

function makeCandidate<TPayload extends AnyCandidatePayload>(
  kind: CandidateKind,
  payload: TPayload,
  evidence: EvidenceChunk,
  confidence: number,
  reason: string,
): CandidateRecord<TPayload> {
  return {
    id: createId('cand'),
    kind,
    status: 'pending',
    confidence: clamp(confidence, 0.2, 0.98),
    payload,
    evidenceId: evidence.id,
    evidenceText: evidence.text,
    sourceName: evidence.sourceName,
    createdAt: nowIso(),
    reason,
  };
}

function uniqueCandidates(
  candidates: CandidateRecord<AnyCandidatePayload>[],
): CandidateRecord<AnyCandidatePayload>[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const signature = `${candidate.kind}:${JSON.stringify(candidate.payload)}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

export function extractCandidatesFromEvidence(
  evidence: EvidenceChunk,
): CandidateRecord<AnyCandidatePayload>[] {
  const text = evidence.text;
  const candidates: CandidateRecord<AnyCandidatePayload>[] = [];
  const company = detectCompany(text);
  const date = extractDate(text);

  ORG_REGEX.lastIndex = 0;
  for (const orgMatch of text.matchAll(ORG_REGEX)) {
    const name = orgMatch[1];
    const payload: OrgUnitCandidatePayload = {
      name,
      company,
      function: detectFunction(name),
    };
    candidates.push(makeCandidate('orgUnit', payload, evidence, 0.72, '识别到组织/部门关键词'));
  }

  const roleRegex = new RegExp(
    `(${CHINESE_NAME})(?:目前|现在|现任|任|担任|负责|是|为|加入后任|加入后负责)\\s*([\\u4e00-\\u9fa5A-Za-z0-9（）()·\\-/]{0,28}(?:${TITLE_WORDS}))`,
    'gi',
  );
  for (const match of text.matchAll(roleRegex)) {
    const personName = match[1];
    const title = match[2].replace(/^的/, '').trim();
    const orgUnitName = detectOrgUnit(text);
    const payload: RoleCandidatePayload = {
      personName,
      title,
      orgUnitName,
      company,
      effectiveDate: date,
    };
    candidates.push(makeCandidate('roleAssignment', payload, evidence, 0.84, '识别到任职/负责表达'));
    candidates.push(
      makeCandidate(
        'person',
        { name: personName, company, title, department: orgUnitName } satisfies PersonCandidatePayload,
        evidence,
        0.78,
        '从任职表达中识别到人员',
      ),
    );
  }

  const compactRoleRegex = new RegExp(
    `(${CHINESE_NAME})[，,、 ]+([\\u4e00-\\u9fa5A-Za-z0-9（）()·\\-/]{2,28}(?:${TITLE_WORDS}))`,
    'gi',
  );
  for (const match of text.matchAll(compactRoleRegex)) {
    if (/汇报|下属|离职|加入|调任/.test(match[0])) continue;
    const payload: RoleCandidatePayload = {
      personName: match[1],
      title: match[2],
      orgUnitName: detectOrgUnit(text),
      company,
      effectiveDate: date,
    };
    candidates.push(makeCandidate('roleAssignment', payload, evidence, 0.62, '识别到姓名+职位组合'));
  }

  const reportsToRegex = new RegExp(`(${CHINESE_NAME})\\s*(?:汇报给|向|report(?:s)? to)\\s*(${CHINESE_NAME})`, 'gi');
  for (const match of text.matchAll(reportsToRegex)) {
    const payload: ReportingCandidatePayload = {
      subordinateName: match[1],
      managerName: match[2],
      relationType: 'reports-to',
    };
    candidates.push(makeCandidate('reportingLine', payload, evidence, 0.9, '识别到直接汇报表达'));
  }

  const managesRegex = new RegExp(`(${CHINESE_NAME})(?:下面|下属|管理|带了|带着|负责管理)\\s*(${CHINESE_NAME})`, 'gi');
  for (const match of text.matchAll(managesRegex)) {
    const payload: ReportingCandidatePayload = {
      subordinateName: match[2],
      managerName: match[1],
      relationType: 'manages',
    };
    candidates.push(makeCandidate('reportingLine', payload, evidence, 0.72, '识别到管理/下属表达'));
  }

  const resignationRegex = new RegExp(`(${CHINESE_NAME})(?:已经|已|目前)?(?:离职|离开|走了|跳槽)`, 'gi');
  for (const match of text.matchAll(resignationRegex)) {
    const payload: ChangeCandidatePayload = {
      personName: match[1],
      type: 'resigned',
      date,
      description: `${match[1]}可能已离职或离开原组织`,
    };
    candidates.push(makeCandidate('changeEvent', payload, evidence, 0.82, '识别到离职/离开表达'));
  }

  const transferRegex = new RegExp(`(${CHINESE_NAME})(?:从([\\u4e00-\\u9fa5A-Za-z0-9（）()·\\-/]{2,28}))?(?:加入|去了|调任|转到|转入)\\s*([\\u4e00-\\u9fa5A-Za-z0-9（）()·\\-/]{2,36})`, 'gi');
  for (const match of text.matchAll(transferRegex)) {
    const destination = match[3].replace(/[。；;，,].*$/, '');
    const payload: ChangeCandidatePayload = {
      personName: match[1],
      type: 'transfer',
      date,
      description: `${match[1]}${match[2] ? `从${match[2]}` : ''}加入/转入${destination}`,
    };
    candidates.push(makeCandidate('changeEvent', payload, evidence, 0.74, '识别到加入/调任表达'));
  }

  return uniqueCandidates(candidates);
}

export function buildImportExtraction(
  source: SourceDocument,
  rawChunks: string[],
): Pick<ImportResult, 'evidence' | 'candidates'> {
  const extractedAt = nowIso();
  const evidence: EvidenceChunk[] = rawChunks.map((chunk, index) => ({
    id: createId('ev'),
    sourceDocumentId: source.id,
    sourceName: source.fileName,
    location: source.type === 'pptx' ? `PPT片段 ${index + 1}` : `文本片段 ${index + 1}`,
    text: chunk,
    extractedAt,
    date: extractDate(chunk),
    confidence: 0.68,
    candidateIds: [],
  }));

  const candidates = evidence.flatMap((chunk) => extractCandidatesFromEvidence(chunk));
  const candidateIdsByEvidence = new Map<string, string[]>();

  for (const candidate of candidates) {
    const ids = candidateIdsByEvidence.get(candidate.evidenceId) ?? [];
    ids.push(candidate.id);
    candidateIdsByEvidence.set(candidate.evidenceId, ids);
  }

  for (const chunk of evidence) {
    chunk.candidateIds = candidateIdsByEvidence.get(chunk.id) ?? [];
    if (chunk.candidateIds.length > 0) {
      chunk.confidence = Math.max(
        chunk.confidence,
        ...candidates
          .filter((candidate) => candidate.evidenceId === chunk.id)
          .map((candidate) => candidate.confidence),
      );
    }
  }

  return { evidence, candidates };
}
