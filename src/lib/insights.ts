import type { AppState, Person, ReportTemplateKey, SourceType } from '../types';
import { normalizeName } from './ids';

export type InsightTone = 'good' | 'warning' | 'danger';

export interface SpanInsight {
  name: string;
  count: number;
  department?: string;
}

export interface OrgInsightMetrics {
  companyCount: number;
  peopleCount: number;
  activePeopleCount: number;
  orgUnitCount: number;
  roleAssignmentCount: number;
  reportingLineCount: number;
  pendingCandidateCount: number;
  acceptedFactCount: number;
  evidenceCount: number;
  strongEvidenceCount: number;
  weakSignalCount: number;
  weakSignalRatio: number;
  averageConfidence: number;
  stalePeopleCount: number;
  staleRatio: number;
  talentCount: number;
  leadershipCount: number;
  managersCount: number;
  averageSpan: number;
  maxSpan: number;
  wideSpanManagers: SpanInsight[];
  orphanPeopleCount: number;
  orphanRatio: number;
  conflictCount: number;
  recentChangeCount: number;
  roleCoverageScore: number;
  lineCoverageScore: number;
  evidenceCoverageScore: number;
  coverageScore: number;
  confidenceScore: number;
  freshnessScore: number;
  confirmationScore: number;
  readinessScore: number;
  readinessLabel: string;
  normalizedWeights: {
    coverage: number;
    confidence: number;
    freshness: number;
    confirmation: number;
  };
}

export interface ExecutiveRisk {
  title: string;
  body: string;
  tone: InsightTone;
}

export interface BusinessSignal {
  title: string;
  interpretation: string;
  recommendedAction: string;
  impact: '高' | '中' | '低';
  tone: InsightTone;
}

export interface BusinessLineInsight {
  name: string;
  strategicTag: string;
  peopleCount: number;
  managerCount: number;
  talentCount: number;
  note: string;
  tone: InsightTone;
}

export interface PositionGap {
  area: string;
  gap: string;
  evidence: string;
  recommendedAction: string;
  priority: 'P0' | 'P1' | 'P2';
}

export interface MovementHeatmapRow {
  label: string;
  newCount: number;
  transferCount: number;
  resignedCount: number;
  reportingChangeCount: number;
  total: number;
}

export interface ComparisonRow {
  name: string;
  peopleCount: number;
  orgUnitCount: number;
  reportingLineCount: number;
  talentCount: number;
  staleCount: number;
  densityLabel: string;
}

export interface RecruitingAction {
  personName: string;
  level: string;
  department: string;
  title: string;
  priority: '高' | '中' | '低';
  reason: string;
  nextStep: string;
}

export interface ChangeAlert {
  title: string;
  detail: string;
  ownerHint: string;
  tone: InsightTone;
}

export interface ImportQualityRow {
  sourceName: string;
  type: SourceType;
  evidenceCount: number;
  candidateCount: number;
  warningCount: number;
  qualityScore: number;
  suggestion: string;
}

export interface ExecutiveNarrative {
  headline: string;
  summaryBullets: string[];
  nextActions: string[];
  risks: ExecutiveRisk[];
  businessSignals: BusinessSignal[];
  businessLines: BusinessLineInsight[];
  positionGaps: PositionGap[];
  movementHeatmap: MovementHeatmapRow[];
  comparisonRows: ComparisonRow[];
  recruitingActions: RecruitingAction[];
  changeAlerts: ChangeAlert[];
  importQuality: ImportQualityRow[];
  assumptions: string[];
  storyline: string[];
  metrics: OrgInsightMetrics;
  evidenceBuckets: Array<{ label: string; value: number; tone: InsightTone }>;
  templateAdvice: {
    template: ReportTemplateKey;
    reason: string;
  };
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function safeRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function average(values: number[], fallback = 0): number {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return fallback;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function normalizeInsightWeights(state: AppState): OrgInsightMetrics['normalizedWeights'] {
  const configured = state.project.settings.insightWeights ?? {
    coverage: 32,
    confidence: 28,
    freshness: 24,
    confirmation: 16,
  };
  const raw = {
    coverage: Math.max(0, configured.coverage),
    confidence: Math.max(0, configured.confidence),
    freshness: Math.max(0, configured.freshness),
    confirmation: Math.max(0, configured.confirmation),
  };
  const total = raw.coverage + raw.confidence + raw.freshness + raw.confirmation || 100;
  return {
    coverage: raw.coverage / total,
    confidence: raw.confidence / total,
    freshness: raw.freshness / total,
    confirmation: raw.confirmation / total,
  };
}

function sourceCredibility(state: AppState, type: SourceType | undefined): number {
  const defaults: Record<SourceType, number> = {
    text: 86,
    markdown: 84,
    pptx: 78,
    ocr: 52,
    project: 90,
  };
  return (type ? state.project.settings.sourceCredibility?.[type] : undefined) ?? (type ? defaults[type] : 75);
}

function evidenceCredibilityFactor(state: AppState, evidenceId: string): number {
  const evidence = state.evidence.find((item) => item.id === evidenceId);
  const source = evidence ? state.sources.find((item) => item.id === evidence.sourceDocumentId) : undefined;
  return sourceCredibility(state, source?.type) / 100;
}

function daysSince(value?: string): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

function isLeadership(person: Person): boolean {
  const title = person.currentTitle ?? '';
  return (
    person.tags.some((tag) => ['高管', '一级负责人', '核心目标'].includes(tag)) ||
    /总经理|副总裁|负责人|总裁|VP|Head/i.test(title)
  );
}

export function calculateOrgInsights(state: AppState): OrgInsightMetrics {
  const normalizedWeights = normalizeInsightWeights(state);
  const activePeople = state.people.filter((person) => person.status !== 'left');
  const currentLines = state.reportingLines.filter((line) => line.isCurrent);
  const pendingCandidates = state.candidates.filter((candidate) => candidate.status === 'pending');
  const weakPendingCandidates = pendingCandidates.filter((candidate) => candidate.confidence < 0.65).length;
  const weakEvidence = state.evidence.filter((item) => item.confidence < 0.65).length;
  const strongEvidence = state.evidence.filter((item) => item.confidence >= 0.85).length;
  const stalePeople = activePeople.filter((person) => {
    const days = daysSince(person.updatedAt);
    return days === null || days > state.project.settings.staleAfterDays;
  });

  const rolePersonNames = new Set(state.roleAssignments.map((role) => normalizeName(role.personName)));
  const linePersonNames = new Set<string>();
  const managerSpans = new Map<string, number>();
  for (const line of currentLines) {
    const managerName = normalizeName(line.managerName);
    const subordinateName = normalizeName(line.subordinateName);
    linePersonNames.add(managerName);
    linePersonNames.add(subordinateName);
    managerSpans.set(line.managerName, (managerSpans.get(line.managerName) ?? 0) + 1);
  }

  const topSpans = [...managerSpans.entries()]
    .map(([name, count]) => ({
      name,
      count,
      department: state.people.find((person) => normalizeName(person.name) === normalizeName(name))?.currentDepartment,
    }))
    .sort((a, b) => b.count - a.count);

  const orphanPeopleCount = activePeople.filter((person) => !linePersonNames.has(normalizeName(person.name))).length;
  const roleConflictCount = [...state.roleAssignments.reduce((map, role) => {
    const rows = map.get(role.personName) ?? new Set<string>();
    if (role.status === 'current') {
      rows.add(`${role.title}|${role.orgUnitName ?? ''}|${role.company ?? ''}`);
    }
    map.set(role.personName, rows);
    return map;
  }, new Map<string, Set<string>>()).values()].filter((signatures) => signatures.size > 1).length;
  const conflictCount =
    roleConflictCount + state.changeEvents.filter((event) => event.type === 'conflict').length;
  const recentChangeCount = state.changeEvents.filter((event) => {
    const time = new Date(event.date ?? event.createdAt).getTime();
    return Number.isFinite(time) && Date.now() - time <= 90 * 86_400_000;
  }).length;

  const roleCoverageScore = clampScore(safeRatio(rolePersonNames.size, activePeople.length) * 100);
  const lineCoverageScore = clampScore(safeRatio(linePersonNames.size, activePeople.length) * 100);
  const evidenceCoverageScore = clampScore(
    safeRatio(activePeople.filter((person) => person.evidenceIds.length > 0).length, activePeople.length) * 100,
  );
  const coverageScore = clampScore(
    roleCoverageScore * 0.34 + lineCoverageScore * 0.36 + evidenceCoverageScore * 0.3,
  );
  const weightedEvidenceConfidence = state.evidence.map((item) => {
    const source = state.sources.find((sourceItem) => sourceItem.id === item.sourceDocumentId);
    return item.confidence * (sourceCredibility(state, source?.type) / 100);
  });
  const weightedLineConfidence = currentLines.map((line) => {
    const relationCredibility = average(line.evidenceIds.map((evidenceId) => evidenceCredibilityFactor(state, evidenceId)), 0.75);
    return line.confidence * relationCredibility;
  });
  const averageConfidence = average([...weightedEvidenceConfidence, ...weightedLineConfidence], 0) * 100;
  const confidenceScore = clampScore(averageConfidence);
  const hasPeople = activePeople.length > 0;
  const freshnessScore = hasPeople ? clampScore((1 - safeRatio(stalePeople.length, activePeople.length)) * 100) : 0;
  const acceptedFactCount =
    state.people.length + state.orgUnits.length + state.roleAssignments.length + state.reportingLines.length;
  const hasSignals = acceptedFactCount + pendingCandidates.length > 0;
  const confirmationScore = hasSignals
    ? clampScore((1 - safeRatio(pendingCandidates.length, acceptedFactCount + pendingCandidates.length)) * 100)
    : 0;
  const readinessScore = hasPeople
    ? clampScore(
        coverageScore * normalizedWeights.coverage +
          confidenceScore * normalizedWeights.confidence +
          freshnessScore * normalizedWeights.freshness +
          confirmationScore * normalizedWeights.confirmation,
      )
    : 0;

  return {
    companyCount: state.project.companies.length,
    peopleCount: state.people.length,
    activePeopleCount: activePeople.length,
    orgUnitCount: state.orgUnits.length,
    roleAssignmentCount: state.roleAssignments.length,
    reportingLineCount: currentLines.length,
    pendingCandidateCount: pendingCandidates.length,
    acceptedFactCount,
    evidenceCount: state.evidence.length,
    strongEvidenceCount: strongEvidence,
    weakSignalCount: weakEvidence + weakPendingCandidates,
    weakSignalRatio: safeRatio(weakEvidence + weakPendingCandidates, state.evidence.length + pendingCandidates.length),
    averageConfidence: clampScore(averageConfidence),
    stalePeopleCount: stalePeople.length,
    staleRatio: safeRatio(stalePeople.length, activePeople.length),
    talentCount: state.people.filter((person) => person.tags.includes('关键人才池')).length,
    leadershipCount: state.people.filter(isLeadership).length,
    managersCount: managerSpans.size,
    averageSpan: Math.round(average([...managerSpans.values()], 0) * 10) / 10,
    maxSpan: topSpans[0]?.count ?? 0,
    wideSpanManagers: topSpans.filter((item) => item.count >= 12).slice(0, 5),
    orphanPeopleCount,
    orphanRatio: safeRatio(orphanPeopleCount, activePeople.length),
    conflictCount,
    recentChangeCount,
    roleCoverageScore,
    lineCoverageScore,
    evidenceCoverageScore,
    coverageScore,
    confidenceScore,
    freshnessScore,
    confirmationScore,
    readinessScore,
    readinessLabel:
      readinessScore >= 82 ? '可进入管理汇报' : readinessScore >= 62 ? '可汇报但需标注口径' : '先补证据再汇报',
    normalizedWeights,
  };
}

function buildBusinessSignals(metrics: OrgInsightMetrics): BusinessSignal[] {
  const signals: BusinessSignal[] = [];

  if (metrics.peopleCount === 0) {
    return [
      {
        title: '尚无业务解释基础',
        interpretation: '当前没有已结构化人员和汇报线，无法判断组织扩张、关键岗位或人才流动。',
        recommendedAction: '先导入转写资料或 PPTX，并确认第一批人员、岗位和汇报关系。',
        impact: '高',
        tone: 'warning',
      },
    ];
  }

  if (metrics.wideSpanManagers.length > 0) {
    const top = metrics.wideSpanManagers[0];
    signals.push({
      title: '管理跨度压力',
      interpretation: `${top.name} 可见直属下级 ${top.count} 人，可能意味着组织快速扩张、二级负责人缺失，或资料尚未拆到真实管理层级。`,
      recommendedAction: '在组织图中聚焦该负责人，补齐二级负责人和关键岗位，再决定是否作为挖猎入口。',
      impact: top.count >= 18 ? '高' : '中',
      tone: top.count >= 18 ? 'danger' : 'warning',
    });
  }

  if (metrics.talentCount === 0) {
    signals.push({
      title: '重点人才池缺口',
      interpretation: '当前没有标记重点人才，招聘 mapping 仍停留在组织梳理层，难以形成可执行目标名单。',
      recommendedAction: '按高管、一级负责人、核心技术/产品/商业岗位先标记 20-50 位重点人才。',
      impact: '高',
      tone: 'warning',
    });
  } else if (metrics.talentCount < Math.max(8, metrics.peopleCount * 0.03)) {
    signals.push({
      title: '重点人才池偏薄',
      interpretation: `重点人才池 ${metrics.talentCount} 人，占总人员约 ${Math.round((metrics.talentCount / metrics.peopleCount) * 100)}%，可能不足以支撑高招漏斗。`,
      recommendedAction: '按 BU 和职能补齐目标人才，至少覆盖每个核心团队负责人和关键 IC。',
      impact: '中',
      tone: 'warning',
    });
  } else {
    signals.push({
      title: '招聘目标池可用',
      interpretation: `已标记 ${metrics.talentCount} 位重点人才，可以支持按团队、岗位和汇报线做定向触达讨论。`,
      recommendedAction: '进入招聘版模板，按团队焦点导出目标名单和组织图。',
      impact: '中',
      tone: 'good',
    });
  }

  if (metrics.recentChangeCount >= 8) {
    signals.push({
      title: '人才流动信号较强',
      interpretation: `近 90 天识别到 ${metrics.recentChangeCount} 条变更，可能存在组织调整、业务收缩/扩张或关键人迁移。`,
      recommendedAction: '把变更时间线与重点人才池交叉查看，优先复核离职、调岗和汇报线变化。',
      impact: '高',
      tone: 'warning',
    });
  }

  if (metrics.orphanRatio >= 0.12) {
    signals.push({
      title: '组织图断点偏多',
      interpretation: `${metrics.orphanPeopleCount} 位人员没有接入当前汇报线，当前图谱对真实组织关系的解释力有限。`,
      recommendedAction: '先补上级、部门和任职来源，再进入管理层汇报。',
      impact: metrics.orphanRatio >= 0.25 ? '高' : '中',
      tone: metrics.orphanRatio >= 0.25 ? 'danger' : 'warning',
    });
  }

  if (metrics.conflictCount > 0) {
    signals.push({
      title: '岗位口径不一致',
      interpretation: `${metrics.conflictCount} 处口径冲突会影响对组织权责、岗位层级和目标人选的判断。`,
      recommendedAction: '使用候选确认页保留可信来源，必要时把冲突保留为管理简报风险说明。',
      impact: '高',
      tone: 'danger',
    });
  }

  if (metrics.stalePeopleCount > 0) {
    signals.push({
      title: '信息时效影响决策',
      interpretation: `${metrics.stalePeopleCount} 位人员超过时效阈值未更新，高招触达前存在职位或汇报线已变化的风险。`,
      recommendedAction: '优先复核重点人才池和高层节点，低层节点可在详细版中分批处理。',
      impact: metrics.staleRatio >= 0.2 ? '高' : '中',
      tone: metrics.staleRatio >= 0.2 ? 'danger' : 'warning',
    });
  }

  if (signals.length === 0) {
    signals.push({
      title: '组织解释力较完整',
      interpretation: '当前结构、证据和时效没有明显阻断项，可以进入领导汇报或招聘 mapping 执行。',
      recommendedAction: '保存高层版画布，并按目标受众选择领导版或外发脱敏版导出。',
      impact: '低',
      tone: 'good',
    });
  }

  return signals.slice(0, 6);
}

function functionForPerson(state: AppState, person: Person): string {
  const matchedUnit = state.orgUnits.find((unit) => unit.name === person.currentDepartment);
  if (matchedUnit?.function) return matchedUnit.function;
  const text = `${person.currentDepartment ?? ''}${person.currentTitle ?? ''}`;
  if (/商业|销售|收入|客户|渠道/.test(text)) return '商业化';
  if (/算法|AI|模型|路线|导航|推荐/.test(text)) return '算法';
  if (/数据|采集|治理|质量/.test(text)) return '数据';
  if (/产品|搜索|体验|设计/.test(text)) return '产品体验';
  if (/运营|增长|内容|活动/.test(text)) return '增长运营';
  if (/车载|出行|生态|合作/.test(text)) return '生态合作';
  if (/安全|隐私|合规|风控/.test(text)) return '风险合规';
  if (/HR|人才|招聘|组织|人力/.test(text)) return '组织能力';
  return '待归类';
}

function strategicTagForFunction(functionName: string): string {
  if (/商业/.test(functionName)) return '收入增长';
  if (/算法|研发|技术|AI/.test(functionName)) return '技术护城河';
  if (/数据/.test(functionName)) return '数据资产';
  if (/产品|体验/.test(functionName)) return '用户体验';
  if (/运营|增长/.test(functionName)) return '规模增长';
  if (/生态|出行|车载/.test(functionName)) return '生态合作';
  if (/合规|风控|安全/.test(functionName)) return '风险防线';
  if (/组织|人力|HR/.test(functionName)) return '组织能力';
  return '待判断';
}

function inferLevel(person: Person): string {
  const text = `${person.currentTitle ?? ''}${person.tags.join(' ')}`;
  if (/总经理|总裁|副总裁|VP|高管|一级负责人/i.test(text)) return '高管/一级负责人';
  if (/负责人|总监|Head|二级负责人/i.test(text)) return '负责人/总监';
  if (/经理|主管|三级负责人|Lead/i.test(text)) return '经理/组长';
  if (/专家|高级|资深|架构|算法|工程师|顾问/i.test(text)) return '核心IC';
  return '待判断';
}

function buildBusinessLines(state: AppState, metrics: OrgInsightMetrics): BusinessLineInsight[] {
  const managers = new Set(state.reportingLines.filter((line) => line.isCurrent).map((line) => normalizeName(line.managerName)));
  const rows = new Map<string, { people: Person[]; managerCount: number; talentCount: number }>();
  for (const person of state.people.filter((item) => item.status !== 'left')) {
    const fn = functionForPerson(state, person);
    const current = rows.get(fn) ?? { people: [], managerCount: 0, talentCount: 0 };
    current.people.push(person);
    if (managers.has(normalizeName(person.name))) current.managerCount += 1;
    if (person.tags.includes('关键人才池')) current.talentCount += 1;
    rows.set(fn, current);
  }

  return [...rows.entries()]
    .map(([name, row]) => {
      const talentRatio = safeRatio(row.talentCount, row.people.length);
      return {
        name,
        strategicTag: strategicTagForFunction(name),
        peopleCount: row.people.length,
        managerCount: row.managerCount,
        talentCount: row.talentCount,
        note:
          talentRatio === 0
            ? '尚未覆盖重点人才'
            : row.managerCount === 0
              ? '缺少管理节点'
              : `占总样本 ${Math.round(safeRatio(row.people.length, metrics.peopleCount) * 100)}%`,
        tone: talentRatio === 0 ? 'warning' : row.managerCount === 0 ? 'warning' : 'good',
      } satisfies BusinessLineInsight;
    })
    .sort((a, b) => b.peopleCount - a.peopleCount)
    .slice(0, 10);
}

function buildPositionGaps(metrics: OrgInsightMetrics, businessLines: BusinessLineInsight[]): PositionGap[] {
  const gaps: PositionGap[] = [];
  for (const line of businessLines) {
    if (line.talentCount === 0 && line.peopleCount >= 8) {
      gaps.push({
        area: line.name,
        gap: '重点人才池未覆盖',
        evidence: `${line.peopleCount} 人中暂无重点人才标记`,
        recommendedAction: '先标记负责人、关键IC和可替代岗位人选。',
        priority: line.peopleCount >= 30 ? 'P0' : 'P1',
      });
    }
    if (line.managerCount === 0 && line.peopleCount >= 6) {
      gaps.push({
        area: line.name,
        gap: '负责人或管理层级缺口',
        evidence: `${line.peopleCount} 人但没有可见管理节点`,
        recommendedAction: '补充上级、部门负责人和二级负责人信息。',
        priority: 'P1',
      });
    }
  }
  if (metrics.orphanPeopleCount > 0) {
    gaps.push({
      area: '全局汇报线',
      gap: '孤点人员未接入组织图',
      evidence: `${metrics.orphanPeopleCount} 位人员无当前汇报线`,
      recommendedAction: '按部门批量补齐上级，或在汇报中标记为未确认。',
      priority: metrics.orphanRatio >= 0.25 ? 'P0' : 'P1',
    });
  }
  if (metrics.stalePeopleCount > 0) {
    gaps.push({
      area: '信息时效',
      gap: '关键资料需要复核',
      evidence: `${metrics.stalePeopleCount} 位人员超过时效阈值`,
      recommendedAction: '优先复核高层节点和重点人才池。',
      priority: metrics.staleRatio >= 0.2 ? 'P0' : 'P2',
    });
  }
  return gaps.slice(0, 8);
}

function buildMovementHeatmap(state: AppState): MovementHeatmapRow[] {
  const rows = new Map<string, MovementHeatmapRow>();
  for (const event of state.changeEvents) {
    const person = event.personName
      ? state.people.find((item) => normalizeName(item.name) === normalizeName(event.personName ?? ''))
      : undefined;
    const label = person ? functionForPerson(state, person) : '待归类';
    const row =
      rows.get(label) ??
      { label, newCount: 0, transferCount: 0, resignedCount: 0, reportingChangeCount: 0, total: 0 };
    if (event.type === 'new') row.newCount += 1;
    if (event.type === 'transfer') row.transferCount += 1;
    if (event.type === 'resigned') row.resignedCount += 1;
    if (event.type === 'reporting-change') row.reportingChangeCount += 1;
    row.total += 1;
    rows.set(label, row);
  }
  return [...rows.values()].sort((a, b) => b.total - a.total).slice(0, 8);
}

function buildComparisonRows(state: AppState): ComparisonRow[] {
  return state.project.companies.map((company) => {
    const people = state.people.filter((person) => person.company === company);
    const orgUnits = state.orgUnits.filter((unit) => unit.company === company);
    const peopleNames = new Set(people.map((person) => normalizeName(person.name)));
    const reportingLineCount = state.reportingLines.filter(
      (line) =>
        peopleNames.has(normalizeName(line.managerName)) || peopleNames.has(normalizeName(line.subordinateName)),
    ).length;
    const staleCount = people.filter((person) => {
      const days = daysSince(person.updatedAt);
      return days === null || days > state.project.settings.staleAfterDays;
    }).length;
    const density = safeRatio(reportingLineCount, people.length);
    return {
      name: company,
      peopleCount: people.length,
      orgUnitCount: orgUnits.length,
      reportingLineCount,
      talentCount: people.filter((person) => person.tags.includes('关键人才池')).length,
      staleCount,
      densityLabel: density >= 0.9 ? '结构较完整' : density >= 0.55 ? '结构部分完整' : '结构稀疏',
    };
  });
}

function buildRecruitingActions(state: AppState): RecruitingAction[] {
  const managerNames = new Set(state.reportingLines.filter((line) => line.isCurrent).map((line) => normalizeName(line.managerName)));
  return state.people
    .filter((person) => person.status !== 'left')
    .map((person) => {
      const level = inferLevel(person);
      const isTalent = person.tags.includes('关键人才池');
      const isManager = managerNames.has(normalizeName(person.name));
      const priority: RecruitingAction['priority'] = isTalent || level === '高管/一级负责人' ? '高' : isManager ? '中' : '低';
      return {
        personName: person.name,
        level,
        department: person.currentDepartment ?? '部门待确认',
        title: person.currentTitle ?? '岗位待确认',
        priority,
        reason: isTalent ? '已在重点人才池' : isManager ? '组织图中有下级，可作为团队入口' : '可作为补充目标',
        nextStep: priority === '高' ? '复核最新任职与汇报线，进入高招短名单。' : '补充证据后再判断是否进入目标池。',
      };
    })
    .sort((a, b) => {
      const order = { 高: 0, 中: 1, 低: 2 };
      return order[a.priority] - order[b.priority];
    })
    .slice(0, 10);
}

function buildChangeAlerts(metrics: OrgInsightMetrics, movementHeatmap: MovementHeatmapRow[]): ChangeAlert[] {
  const alerts: ChangeAlert[] = [];
  const topMovement = movementHeatmap[0];
  if (topMovement && topMovement.total >= 3) {
    alerts.push({
      title: '变更集中',
      detail: `${topMovement.label} 出现 ${topMovement.total} 条变更，建议作为本轮复核重点。`,
      ownerHint: 'HRBP / 招聘负责人',
      tone: 'warning',
    });
  }
  if (metrics.weakSignalCount > 0) {
    alerts.push({
      title: '弱信号待清理',
      detail: `${metrics.weakSignalCount} 条弱信号可能影响汇报可信度。`,
      ownerHint: '资料整理负责人',
      tone: 'warning',
    });
  }
  if (metrics.conflictCount > 0) {
    alerts.push({
      title: '口径冲突',
      detail: `${metrics.conflictCount} 处冲突需要人工裁决后再外发。`,
      ownerHint: 'HRD',
      tone: 'danger',
    });
  }
  if (metrics.readinessScore >= 82 && alerts.length === 0) {
    alerts.push({
      title: '可进入汇报',
      detail: '当前没有明显阻断项，可以保存画布并导出管理版本。',
      ownerHint: '项目负责人',
      tone: 'good',
    });
  }
  return alerts.slice(0, 6);
}

function buildImportQuality(state: AppState): ImportQualityRow[] {
  return state.sources.map((source) => {
    const evidenceCount = state.evidence.filter((item) => item.sourceDocumentId === source.id).length;
    const candidateCount = state.candidates.filter((candidate) => candidate.sourceName === source.fileName).length;
    const warningCount = source.warnings?.length ?? 0;
    const base = Math.min(45, evidenceCount * 8) + Math.min(35, candidateCount * 4) + Math.min(20, source.totalChunks * 3);
    const qualityScore = clampScore(base - warningCount * 12 + sourceCredibility(state, source.type) * 0.25);
    return {
      sourceName: source.fileName,
      type: source.type,
      evidenceCount,
      candidateCount,
      warningCount,
      qualityScore,
      suggestion:
        source.type === 'ocr'
          ? 'OCR资料建议逐条复核关键岗位和姓名'
          : warningCount > 0
            ? '先处理导入警告，再批量确认候选'
            : qualityScore >= 75
              ? '可作为本轮汇报主要证据'
              : '建议补充更多上下文或来源',
    };
  });
}

function buildAssumptions(state: AppState, metrics: OrgInsightMetrics): string[] {
  const weights = metrics.normalizedWeights;
  return [
    `准备度权重：覆盖 ${Math.round(weights.coverage * 100)}%，可信 ${Math.round(weights.confidence * 100)}%，时效 ${Math.round(weights.freshness * 100)}%，确认 ${Math.round(weights.confirmation * 100)}%。`,
    `过期阈值：${state.project.settings.staleAfterDays} 天未更新即进入复核提醒。`,
    `来源可信度：文本 ${state.project.settings.sourceCredibility.text}，PPTX ${state.project.settings.sourceCredibility.pptx}，OCR ${state.project.settings.sourceCredibility.ocr}。`,
    `隐私分级：${state.project.settings.sensitivityLevel}；导出脱敏由当前模板和细粒度开关共同决定。`,
    '所有自动判断均保留来源证据，最终汇报以人工确认后的结构化数据为准。',
  ];
}

function buildStoryline(template: ReportTemplateKey): string[] {
  const lines: Record<ReportTemplateKey, string[]> = {
    executive: ['管理结论', '组织图', '关键风险', '业务解释', '下一步决策'],
    recruiting: ['目标团队', '重点人才池', '汇报关系', '高招作战清单', '复核事项'],
    diagnostic: ['数据质量', '组织断点', '冲突与过期', '业务线对比', '修复计划'],
    external: ['脱敏概览', '组织结构', '风险摘要', '证据口径', '可公开结论'],
  };
  return lines[template] ?? lines.recruiting;
}

export function buildExecutiveNarrative(state: AppState): ExecutiveNarrative {
  const metrics = calculateOrgInsights(state);
  const risks: ExecutiveRisk[] = [];

  if (metrics.pendingCandidateCount > 0) {
    risks.push({
      title: '候选未闭环',
      body: `仍有 ${metrics.pendingCandidateCount} 条候选待确认，管理汇报中应标注为未定稿范围。`,
      tone: metrics.pendingCandidateCount > 50 ? 'danger' : 'warning',
    });
  }
  if (metrics.weakSignalRatio >= 0.18 || metrics.weakSignalCount > 0) {
    risks.push({
      title: '证据强度',
      body: `弱证据/弱候选 ${metrics.weakSignalCount} 条，占全部信号 ${Math.round(metrics.weakSignalRatio * 100)}%。`,
      tone: metrics.weakSignalRatio >= 0.28 ? 'danger' : 'warning',
    });
  }
  if (metrics.stalePeopleCount > 0) {
    risks.push({
      title: '时效风险',
      body: `${metrics.stalePeopleCount} 位人员超过 ${state.project.settings.staleAfterDays} 天未更新，需在高招动作前复核。`,
      tone: metrics.staleRatio >= 0.2 ? 'danger' : 'warning',
    });
  }
  if (metrics.wideSpanManagers.length > 0) {
    const top = metrics.wideSpanManagers[0];
    risks.push({
      title: '管理跨度',
      body: `${top.name} 当前可见直属下级 ${top.count} 人，适合进一步拆解二级负责人和关键岗位。`,
      tone: top.count >= 18 ? 'danger' : 'warning',
    });
  }
  if (metrics.orphanRatio >= 0.12) {
    risks.push({
      title: '结构覆盖',
      body: `${metrics.orphanPeopleCount} 位人员暂未接入汇报线，组织图可能存在孤点或缺失上级。`,
      tone: metrics.orphanRatio >= 0.25 ? 'danger' : 'warning',
    });
  }
  if (metrics.conflictCount > 0) {
    risks.push({
      title: '口径冲突',
      body: `${metrics.conflictCount} 处任职或变更冲突需要确认，否则不建议进入外发版本。`,
      tone: 'danger',
    });
  }
  if (risks.length === 0) {
    risks.push({
      title: '主要风险可控',
      body: '当前样本在覆盖、证据强度和时效性上没有明显阻断项，可进入汇报排版。',
      tone: 'good',
    });
  }

  const summaryBullets = [
    `覆盖 ${metrics.companyCount} 家公司、${metrics.peopleCount} 位人员、${metrics.orgUnitCount} 个组织单元。`,
    `已形成 ${metrics.reportingLineCount} 条当前汇报线，管理者 ${metrics.managersCount} 人，平均管理跨度 ${metrics.averageSpan}。`,
    `整体汇报准备度 ${metrics.readinessScore} 分：覆盖 ${metrics.coverageScore}、可信度 ${metrics.confidenceScore}、时效 ${metrics.freshnessScore}。`,
    `重点人才池 ${metrics.talentCount} 人，近期变更 ${metrics.recentChangeCount} 条，可用于高招 mapping 与流动观察。`,
  ];

  const nextActions: string[] = [];
  if (metrics.peopleCount === 0) nextActions.push('先导入转写文本或 PPTX，建立第一批人员、岗位和证据。');
  if (metrics.pendingCandidateCount > 0) nextActions.push('先处理待确认候选，优先关闭强证据与关键岗位。');
  if (metrics.stalePeopleCount > 0) nextActions.push('对超期人员设置复核清单，避免沿用过期组织关系。');
  if (metrics.orphanPeopleCount > 0) nextActions.push('补齐孤点人员的上级或部门归属，提高组织图可读性。');
  if (metrics.talentCount === 0 && metrics.peopleCount > 0) nextActions.push('标记关键人才池，让招聘侧能直接筛选目标人群。');
  if (metrics.wideSpanManagers.length > 0) nextActions.push('对大跨度管理者展开二级组织，降低单屏汇报认知负荷。');
  if (nextActions.length === 0) nextActions.push('进入组织图画布，保存管理层视图并导出 PPTX。');

  const templateAdvice =
    metrics.readinessScore >= 82 && metrics.pendingCandidateCount === 0
      ? { template: 'executive' as const, reason: '准备度较高，适合生成高层汇报口径。' }
      : metrics.weakSignalRatio > 0.2 || metrics.pendingCandidateCount > 0
        ? { template: 'diagnostic' as const, reason: '仍需复核证据和孤点，建议先用诊断版。' }
        : { template: 'recruiting' as const, reason: '结构已可用，适合继续做重点人才筛选。' };

  const businessSignals = buildBusinessSignals(metrics);
  const businessLines = buildBusinessLines(state, metrics);
  const positionGaps = buildPositionGaps(metrics, businessLines);
  const movementHeatmap = buildMovementHeatmap(state);
  const comparisonRows = buildComparisonRows(state);
  const recruitingActions = buildRecruitingActions(state);
  const changeAlerts = buildChangeAlerts(metrics, movementHeatmap);
  const importQuality = buildImportQuality(state);
  const assumptions = buildAssumptions(state, metrics);
  const storyline = buildStoryline(state.project.settings.reportTemplate);

  return {
    headline:
      metrics.peopleCount === 0
        ? '当前项目尚未形成可汇报组织数据，建议先完成资料导入和候选确认。'
        : metrics.readinessScore >= 82
          ? '组织 mapping 已具备管理汇报基础，下一步聚焦关键岗位与人才机会。'
          : metrics.readinessScore >= 62
            ? '组织 mapping 可用于内部讨论，但需要保留证据强度和时效标注。'
            : '当前 mapping 仍处于资料整理阶段，建议先补齐证据、岗位和汇报线。',
    summaryBullets,
    nextActions: nextActions.slice(0, 5),
    risks: risks.slice(0, 6),
    businessSignals,
    businessLines,
    positionGaps,
    movementHeatmap,
    comparisonRows,
    recruitingActions,
    changeAlerts,
    importQuality,
    assumptions,
    storyline,
    metrics,
    evidenceBuckets: [
      { label: '强证据', value: metrics.strongEvidenceCount, tone: 'good' },
      { label: '弱信号', value: metrics.weakSignalCount, tone: metrics.weakSignalCount > 0 ? 'warning' : 'good' },
      { label: '超期人员', value: metrics.stalePeopleCount, tone: metrics.stalePeopleCount > 0 ? 'warning' : 'good' },
      { label: '口径冲突', value: metrics.conflictCount, tone: metrics.conflictCount > 0 ? 'danger' : 'good' },
    ],
    templateAdvice,
  };
}
