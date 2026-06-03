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
import { clamp, createId, normalizeName, nowIso } from './ids';

const PERSON_NAME = '[\\u4e00-\\u9fa5]{2,4}\\d?';
const PERSON_CAPTURE = `(${PERSON_NAME})`;
const PERSON_VALUE = /^[\u4e00-\u9fa5]{2,4}\d?$/;
const PERSON_PREFIX_BOUNDARY = '(?:^|[，。；;：:、\\s（(])';
const PERSON_SUFFIX_BOUNDARY = '(?=$|[，。；;：:、\\s）)])';

const TITLE_SUFFIXES = [
  'CEO',
  'CTO',
  'CFO',
  'COO',
  'CHRO',
  'CPO',
  'VP',
  'SVP',
  '总裁',
  '副总裁',
  '总经理',
  '副总经理',
  '负责人',
  '总监',
  '副总监',
  '经理',
  '主管',
  '总助',
  'HRD',
  'HRBP',
  'Head',
  'Director',
  'Leader',
  'Owner',
  '专家',
  '架构师',
  '工程师',
];

const LEADER_TITLE_SUFFIXES = ['负责人', '总裁', '副总裁', '总经理', '副总经理', '总监', '副总监', 'Head', 'Director', 'Leader', 'Owner'];

const ORG_SUFFIXES = [
  '事业群',
  '事业部',
  '部门',
  '中心',
  '团队',
  'BU',
  '平台',
  '平台部',
  '产品部',
  '销售部',
  '研发部',
  '算法部',
  '数据部',
  '人力资源部',
  'HR部',
  '财务部',
  '市场部',
  '运营部',
  '设计部',
  '引擎部',
  '评测平台部',
  '合作部',
  '内容部',
  '安全部',
  '合规部',
  '治理部',
  '策略部',
  '小组',
  '组',
];

const PERSON_STOPWORDS = new Set([
  '现任',
  '目前',
  '现在',
  '担任',
  '负责',
  '加入',
  '离职',
  '候选',
  '候选人',
  '上级',
  '下属',
  '团队',
  '部门',
  '岗位',
  '公司',
  '集团',
  '科技',
  '平台',
  '业务',
  '组织',
  '人工',
]);

const PERSON_INVALID_PARTS = [
  '最近',
  '汇报',
  'report',
  '口径',
  '团队',
  '部门',
  '公司',
  '组织',
  '项目',
  '其中',
  '我们',
  '你们',
  '现在',
  '目前',
  '现任',
  '一号位',
  '上级',
  '下级',
  '截图',
  '调整',
  '扩编',
  '暂时',
  '调岗',
  '借调',
  '支援',
  '一级',
  '二级',
  '三级',
  'headcount',
  '压力测试',
  '原岗位',
  '众包平台',
  '我们团队',
  '你们团队',
];

const COMPANY_INVALID_FRAGMENTS = ['真实公司', '任何真实公司', '虚拟脏数据', '测试上传解析', '截图型组织图'];

const TITLE_WORDS = TITLE_SUFFIXES.map(escapeRegExp).join('|');
const LEADER_TITLE_WORDS = LEADER_TITLE_SUFFIXES.map(escapeRegExp).join('|');
const ORG_SUFFIX_WORDS = ORG_SUFFIXES.map(escapeRegExp).join('|');
const ORG_WITH_SUFFIX = `([\\u4e00-\\u9fa5A-Za-z0-9（）()·/\\-]{2,30}(?:${ORG_SUFFIX_WORDS}))`;
const TITLE_CAPTURE = `([^，。；;：:\\n]{1,30}(?:${TITLE_WORDS}))`;

const COMPANY_REGEX = /([\u4e00-\u9fa5A-Za-z0-9（）()·/-]{2,30}(?:有限责任公司|有限公司|公司|集团|科技|智能|网络|控股|股份))(?:（虚拟）)?/g;
const ORG_REGEX = new RegExp(ORG_WITH_SUFFIX, 'g');

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanFragment(value: string): string {
  return value
    .trim()
    .replace(/^[，。、；;：:\-—\s]+/, '')
    .replace(/[，。、；;：:\-—\s]+$/, '')
    .replace(/\s{2,}/g, ' ');
}

function cleanCompanyName(value: string): string | undefined {
  const cleaned = cleanFragment(value)
    .replace(new RegExp(`^[\\u4e00-\\u9fa5]{2,4}\\d?(?:现任|目前|现在|在|于|是|为)`), '')
    .replace(/^(?:当前|正式|候选人说|电话里听到的口径)/, '')
    .replace(/（虚拟）$/, '');
  if (!cleaned || COMPANY_INVALID_FRAGMENTS.some((fragment) => cleaned.includes(fragment))) {
    return undefined;
  }
  if (/(?:现任|目前|现在|汇报|离职|加入|截图|逐字稿)/.test(cleaned)) return undefined;
  return cleaned;
}

function cleanOrgName(value: string): string | undefined {
  const cleaned = cleanFragment(
    cleanFragment(value)
      .replace(new RegExp(`^[\\u4e00-\\u9fa5]{2,4}\\d?(?:现任|目前|现在|在|于|是|为)`), '')
      .replace(/^[\u4e00-\u9fa5]{2,4}\d?(?:在|于)/, '')
      .replace(/^(?:目前|现在|现任|由|把)/, '')
      .replace(/^(?:负责|担任|加入后负责|加入后任|做|任)/, '')
      .replace(/^(?:下面|上面|当前|正式|一级|二级|三级|八个一级)/, '')
      .replace(/(?:做|担任|负责|汇报给|汇报|加入|离职|调任|转到|转入|去了|最近|report(?:s)? to).*$/i, '')
      .replace(/(?:下面有|下有|下属有|下属包括|团队下有).*$/, '')
      .replace(/^的/, ''),
  );

  if (!cleaned || cleaned.length < 2) return undefined;
  if (/^(?:现任|目前|现在|负责|担任|汇报|离职|加入|候选人|都向|其中|截图型|组织调整)/.test(cleaned)) return undefined;
  if (/(?:汇报|report|最近|截图|逐字稿)/i.test(cleaned)) return undefined;
  if (/^(?:下面|上面|一级|二级|三级|八个一级|部门都|团队都)/.test(cleaned)) return undefined;
  if (/^(?:一级部门|二级部门|三级部门|八个一级部门|组织调整|调岗与)$/i.test(cleaned)) return undefined;
  return cleaned;
}

function cleanTitle(value: string, company?: string): string | undefined {
  let cleaned = cleanFragment(value).replace(/^的/, '');
  if (company && cleaned.startsWith(company)) {
    cleaned = cleaned.slice(company.length);
  }
  cleaned = cleanFragment(cleaned);
  if (!cleaned) return undefined;
  if (/(?:汇报给|report(?:s)? to|离职|加入)/i.test(cleaned)) return undefined;
  return cleaned;
}

function cleanPersonName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = cleanFragment(value)
    .replace(/^(?:其中|还有|以及|还有个|还有位|然后是|再就是|目前是|现在是|一号位是|上级是|下级是)/, '')
    .replace(/^(?:说是|叫做|就是|还是|仍然是|仍是|是|由)/, '')
    .replace(/(?:已经|已|目前)$/, '')
    .replace(/[，。；;：:（(].*$/, '');

  if (!cleaned) return undefined;
  if (/^(?:我|你|他|她|其|谁|该|这|那)/.test(cleaned)) return undefined;
  if (PERSON_INVALID_PARTS.some((part) => cleaned.toLowerCase().includes(part.toLowerCase()))) return undefined;
  if (/(?:现|汇|被|说|到|给|的|还|岗|部|队|组|口|调|借|支|都)$/.test(cleaned)) return undefined;
  return cleaned;
}

function isLikelyPersonName(value: string | undefined): value is string {
  const cleaned = cleanPersonName(value);
  if (!cleaned) return false;
  if (!PERSON_VALUE.test(cleaned)) return false;
  if (PERSON_INVALID_PARTS.some((part) => cleaned.toLowerCase().includes(part.toLowerCase()))) return false;
  return !PERSON_STOPWORDS.has(cleaned);
}

function isLikelyOrgName(value: string | undefined): value is string {
  if (!value) return false;
  const cleaned = cleanOrgName(value);
  if (!cleaned) return false;
  return /[\u4e00-\u9fa5A-Za-z]/.test(cleaned);
}

function splitPossibleNamesFromList(value: string): string[] {
  const listPart = value.split(/(?:其中|不过|但是|但|最近|Q[1-4]|另外|另有)/)[0] ?? value;
  return listPart
    .split(/[、，,\/和及]/)
    .map((part) => cleanPersonName(part))
    .filter((part): part is string => Boolean(part))
    .filter((part) => isLikelyPersonName(part));
}

function detectFunction(orgName: string): string | undefined {
  if (/产品|体验|设计/.test(orgName)) return '产品设计';
  if (/销售|商业|市场|客户|渠道|会员/.test(orgName)) return '商业增长';
  if (/研发|技术|算法|数据|平台|引擎|搜索|AI|评测/.test(orgName)) return '研发技术';
  if (/人力|HR|招聘|人才/.test(orgName)) return '人力资源';
  if (/财务|法务|合规|安全/.test(orgName)) return '职能治理';
  return undefined;
}

export function splitIntoChunks(text: string, maxLength = 420): string[] {
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) return [];

  const sentences = normalized
    .split(/(?<=[。！？；;])|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buffer = '';

  for (const sentence of sentences) {
    if (sentence.length > maxLength) {
      const smallerParts = sentence
        .split(/(?<=[，、,])/)
        .map((part) => part.trim())
        .filter(Boolean);

      for (const smallerPart of smallerParts) {
        if ((buffer + smallerPart).length > maxLength && buffer) {
          chunks.push(buffer.trim());
          buffer = '';
        }
        buffer = `${buffer}${buffer ? ' ' : ''}${smallerPart}`;
      }
      continue;
    }

    if ((buffer + sentence).length > maxLength && buffer) {
      chunks.push(buffer.trim());
      buffer = '';
    }
    buffer = `${buffer}${buffer ? ' ' : ''}${sentence}`;
  }

  if (buffer.trim()) {
    chunks.push(buffer.trim());
  }

  return chunks;
}

export function extractDate(text: string): string | undefined {
  const yearMonthDay = text.match(/(20\d{2})[年./-](\d{1,2})(?:[月./-](\d{1,2})日?)?/);
  if (yearMonthDay) {
    const [, year, month, day = '1'] = yearMonthDay;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const quarter = text.match(/(20\d{2})?\s*Q([1-4])/i);
  if (quarter) {
    const year = quarter[1] ?? String(new Date().getFullYear());
    const month = String((Number(quarter[2]) - 1) * 3 + 1).padStart(2, '0');
    return `${year}-${month}-01`;
  }

  const relative = text.match(/(今年|去年|上个月|本月|最近|近期)/);
  return relative ? relative[1] : undefined;
}

function detectCompany(text: string): string | undefined {
  const matches = [...text.matchAll(COMPANY_REGEX)];
  for (const match of matches) {
    const company = cleanCompanyName(match[1]);
    if (company) return company;
  }
  return undefined;
}

function collectOrgNamesFromText(text: string): string[] {
  const orgNames = new Map<string, string>();

  for (const match of text.matchAll(ORG_REGEX)) {
    const orgName = cleanOrgName(match[1]);
    if (!isLikelyOrgName(orgName)) continue;
    orgNames.set(normalizeName(orgName), orgName);
  }

  return [...orgNames.values()];
}

function inferOrgFromTitle(title: string, company?: string): string | undefined {
  const cleanedTitle = cleanTitle(title, company);
  if (!cleanedTitle) return undefined;

  const orgFromLeaderTitle = cleanedTitle.match(
    new RegExp(`^(.{2,24}?)(?:${LEADER_TITLE_WORDS})$`, 'i'),
  )?.[1];
  const orgName = cleanOrgName(orgFromLeaderTitle ?? '');
  if (!isLikelyOrgName(orgName)) return undefined;
  if (/(?:高级|资深|专家|架构师|工程师|HRBP|HRD|HRG)/.test(orgName)) return undefined;
  return orgName;
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
  const explicitOrgNames = collectOrgNamesFromText(text);
  const orgNames = new Map<string, string>(explicitOrgNames.map((orgName) => [normalizeName(orgName), orgName]));
  const rolePeople = new Set<string>();

  const addOrgCandidate = (orgName: string | undefined, confidence: number, reason: string) => {
    if (!isLikelyOrgName(orgName)) return;
    const cleaned = cleanOrgName(orgName);
    if (!cleaned) return;
    orgNames.set(normalizeName(cleaned), cleaned);
    const payload: OrgUnitCandidatePayload = {
      name: cleaned,
      company,
      function: detectFunction(cleaned),
    };
    candidates.push(makeCandidate('orgUnit', payload, evidence, confidence, reason));
  };

  for (const orgName of explicitOrgNames) {
    addOrgCandidate(orgName, 0.72, '识别到组织/部门关键词');
  }

  const addRoleCandidate = (
    personName: string | undefined,
    titleText: string | undefined,
    confidence: number,
    reason: string,
    explicitOrgName?: string,
  ) => {
    const cleanedPersonName = cleanPersonName(personName);
    if (!isLikelyPersonName(cleanedPersonName)) return;
    const title = cleanTitle(titleText ?? '', company);
    if (!title) return;

    const orgUnitName =
      cleanOrgName(explicitOrgName ?? '') ??
      inferOrgFromTitle(title, company) ??
      explicitOrgNames[0];

    if (orgUnitName) {
      addOrgCandidate(orgUnitName, Math.max(0.62, confidence - 0.08), '从岗位信息推断组织');
    }

    const payload: RoleCandidatePayload = {
      personName: cleanedPersonName,
      title,
      orgUnitName,
      company,
      effectiveDate: date,
    };
    candidates.push(makeCandidate('roleAssignment', payload, evidence, confidence, reason));
    candidates.push(
      makeCandidate(
        'person',
        {
          name: cleanedPersonName,
          company,
          title,
          department: orgUnitName,
        } satisfies PersonCandidatePayload,
        evidence,
        Math.max(0.58, confidence - 0.06),
        '从任职表达中识别到人员',
      ),
    );
    rolePeople.add(normalizeName(cleanedPersonName));
  };

  const explicitOrgRoleRegex = new RegExp(
    `${PERSON_PREFIX_BOUNDARY}(${PERSON_NAME})(?=在|于)(?:在|于)${ORG_WITH_SUFFIX}(?:做|任|担任)?${TITLE_CAPTURE}`,
    'gi',
  );
  for (const match of text.matchAll(explicitOrgRoleRegex)) {
    addRoleCandidate(match[1], match[3], 0.9, '识别到“在某部门做某岗位”表达', match[2]);
  }

  const explicitRoleRegex = new RegExp(
    `${PERSON_PREFIX_BOUNDARY}(${PERSON_NAME})(?=目前|现在担任|现在|现任|担任)(?:目前|现在担任|现在|现任|担任)\\s*${TITLE_CAPTURE}`,
    'gi',
  );
  for (const match of text.matchAll(explicitRoleRegex)) {
    addRoleCandidate(match[1], match[2], 0.86, '识别到任职/现任表达');
  }

  const shortVerbRoleRegex = new RegExp(
    `${PERSON_PREFIX_BOUNDARY}(${PERSON_NAME})(?=任|是|为)(?:任|是|为)\\s*${TITLE_CAPTURE}`,
    'gi',
  );
  for (const match of text.matchAll(shortVerbRoleRegex)) {
    addRoleCandidate(match[1], match[2], 0.8, '识别到简写任职表达');
  }

  const compactRoleRegex = new RegExp(
    `${PERSON_PREFIX_BOUNDARY}(${PERSON_NAME})(?=[，,、:： ])(?:[，,、:： ]+)${TITLE_CAPTURE}`,
    'gi',
  );
  for (const match of text.matchAll(compactRoleRegex)) {
    if (/(?:汇报给|report(?:s)? to|离职|加入)/i.test(match[0])) continue;
    addRoleCandidate(match[1], match[2], 0.7, '识别到“姓名 + 岗位”组合');
  }

  const responsibilityRegex = new RegExp(
    `${PERSON_PREFIX_BOUNDARY}(${PERSON_NAME})(?=(?:目前|现在|现任)?负责)(?:目前|现在|现任)?负责\\s*([^，。；;：:\\n]{2,24})`,
    'gi',
  );
  for (const match of text.matchAll(responsibilityRegex)) {
    const personName = match[1];
    if (rolePeople.has(normalizeName(personName))) continue;
    const orgName = cleanOrgName(match[2]);
    if (!isLikelyOrgName(orgName)) continue;
    addRoleCandidate(personName, `${orgName}负责人`, 0.72, '识别到“负责某组织”表达', orgName);
  }

  const reportsToRegex = new RegExp(
    `${PERSON_PREFIX_BOUNDARY}(${PERSON_NAME})(?=\\s*(?:汇报给|向|直接汇报给|直属上级是|老板是|report(?:s)? to))\\s*(?:汇报给|向|直接汇报给|直属上级是|老板是|report(?:s)? to)\\s*(${PERSON_NAME})${PERSON_SUFFIX_BOUNDARY}`,
    'gi',
  );
  for (const match of text.matchAll(reportsToRegex)) {
    if (!isLikelyPersonName(match[1]) || !isLikelyPersonName(match[2])) continue;
    const payload: ReportingCandidatePayload = {
      subordinateName: cleanPersonName(match[1])!,
      managerName: cleanPersonName(match[2])!,
      relationType: 'reports-to',
    };
    candidates.push(makeCandidate('reportingLine', payload, evidence, 0.9, '识别到直接汇报表达'));
  }

  const conflictingReportRegex = new RegExp(
    `${PERSON_PREFIX_BOUNDARY}(${PERSON_NAME})[^。；;\\n]{0,16}?(?:直属上级|汇报线)[^。；;\\n]{0,16}?一说是(${PERSON_NAME})[^。；;\\n]{0,12}?一说是(${PERSON_NAME})`,
    'gi',
  );
  for (const match of text.matchAll(conflictingReportRegex)) {
    const subordinateName = cleanPersonName(match[1]);
    const managerA = cleanPersonName(match[2]);
    const managerB = cleanPersonName(match[3]);
    if (!isLikelyPersonName(subordinateName) || !isLikelyPersonName(managerA) || !isLikelyPersonName(managerB)) continue;

    candidates.push(
      makeCandidate(
        'person',
        { name: subordinateName, company } satisfies PersonCandidatePayload,
        evidence,
        0.58,
        '从冲突汇报表达中识别到人员',
      ),
    );
    candidates.push(
      makeCandidate(
        'person',
        { name: managerA, company } satisfies PersonCandidatePayload,
        evidence,
        0.56,
        '从冲突汇报表达中识别到上级',
      ),
    );
    candidates.push(
      makeCandidate(
        'person',
        { name: managerB, company } satisfies PersonCandidatePayload,
        evidence,
        0.56,
        '从冲突汇报表达中识别到上级',
      ),
    );
    candidates.push(
      makeCandidate(
        'reportingLine',
        {
          subordinateName,
          managerName: managerA,
          relationType: 'reports-to',
        } satisfies ReportingCandidatePayload,
        evidence,
        0.54,
        '识别到存在两个上级口径的冲突汇报表达',
      ),
    );
    candidates.push(
      makeCandidate(
        'reportingLine',
        {
          subordinateName,
          managerName: managerB,
          relationType: 'reports-to',
        } satisfies ReportingCandidatePayload,
        evidence,
        0.54,
        '识别到存在两个上级口径的冲突汇报表达',
      ),
    );
  }

  const managesRegex = new RegExp(
    `${PERSON_PREFIX_BOUNDARY}(${PERSON_NAME})(?=(?:下面有|下属包括|管理|带着|带了))(?:下面有|下属包括|管理|带着|带了)\\s*(${PERSON_NAME})${PERSON_SUFFIX_BOUNDARY}`,
    'gi',
  );
  for (const match of text.matchAll(managesRegex)) {
    if (!isLikelyPersonName(match[1]) || !isLikelyPersonName(match[2])) continue;
    const payload: ReportingCandidatePayload = {
      subordinateName: cleanPersonName(match[2])!,
      managerName: cleanPersonName(match[1])!,
      relationType: 'manages',
    };
    candidates.push(makeCandidate('reportingLine', payload, evidence, 0.72, '识别到管理/下属表达'));
  }

  const subordinateListRegex = new RegExp(
    `${PERSON_PREFIX_BOUNDARY}(${PERSON_NAME})[^。；;\\n]{0,40}?(?:下面有|下有|下属有|下属包括|团队下有)\\s*([^。；;\\n]{4,80})`,
    'gi',
  );
  for (const match of text.matchAll(subordinateListRegex)) {
    const managerName = cleanPersonName(match[1]);
    if (!isLikelyPersonName(managerName)) continue;

    const names = splitPossibleNamesFromList(match[2]).filter(
      (name) => normalizeName(name) !== normalizeName(managerName),
    );

    const uniqueNames = [...new Set(names)];
    for (const subordinateName of uniqueNames) {
      const payload: ReportingCandidatePayload = {
        subordinateName,
        managerName,
        relationType: 'manages',
      };
      candidates.push(makeCandidate('reportingLine', payload, evidence, 0.68, '识别到管理者后接多人列表'));
      candidates.push(
        makeCandidate(
          'person',
          { name: subordinateName, company } satisfies PersonCandidatePayload,
          evidence,
          0.56,
          '从下属列表中识别到人员',
        ),
      );
    }
  }

  const resignationRegex = new RegExp(
    `${PERSON_PREFIX_BOUNDARY}(${PERSON_NAME})(?=(?:已经离职|已离职|目前离职|离职|离开|走了|跳槽))(?:已经|已|目前)?(?:离职|离开|走了|跳槽)`,
    'gi',
  );
  for (const match of text.matchAll(resignationRegex)) {
    const personName = cleanPersonName(match[1]);
    if (!isLikelyPersonName(personName)) continue;
    const payload: ChangeCandidatePayload = {
      personName,
      type: 'resigned',
      date,
      description: `${personName}可能已离职或离开原组织`,
    };
    candidates.push(makeCandidate('changeEvent', payload, evidence, 0.82, '识别到离职/离开表达'));
  }

  const transferRegex = new RegExp(
    `${PERSON_PREFIX_BOUNDARY}(${PERSON_NAME})(?=(?:从[^，。；;：:\\n]{2,20})?(?:加入|去了|调任|转到|转入))(?:从([^，。；;：:\\n]{2,20}))?(?:加入|去了|调任|转到|转入)\\s*([^，。；;：:\\n]{2,36})`,
    'gi',
  );
  for (const match of text.matchAll(transferRegex)) {
    const personName = cleanPersonName(match[1]);
    if (!isLikelyPersonName(personName)) continue;
    const destination = cleanFragment(match[3]);
    const sourceOrg = cleanFragment(match[2] ?? '');
    const payload: ChangeCandidatePayload = {
      personName,
      type: 'transfer',
      date,
      description: `${personName}${sourceOrg ? `从${sourceOrg}` : ''}加入或转入${destination}`,
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
    location: source.type === 'pptx' ? `PPT 片段 ${index + 1}` : `文本片段 ${index + 1}`,
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
