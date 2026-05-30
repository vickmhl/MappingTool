import type { AppState, Person } from '../types';
import { createId, nowIso } from '../lib/ids';

function normalizeCanvasView(value: unknown): AppState['project']['settings']['activeCanvasView'] {
  return value === 'executive' || value === 'recruiting' || value === 'detail' || value === 'mindmap'
    ? value
    : 'executive';
}

export function createEmptyState(): AppState {
  const timestamp = nowIso();

  return {
    project: {
      id: createId('project'),
      name: '竞对组织架构 Mapping',
      companies: [],
      updatedAt: timestamp,
      settings: {
        anonymizeExports: false,
        exportPrivacy: {
          names: false,
          companies: false,
          sources: false,
          notes: false,
        },
        staleAfterDays: 180,
        defaultVisibleNodeLimit: 96,
        activeCanvasView: 'executive',
        orgChartMode: 'formal',
        orgChartExportFormat: 'ppt16x9',
        reportTemplate: 'recruiting',
        sensitivityLevel: 'internal',
        sourceCredibility: {
          text: 86,
          markdown: 84,
          pptx: 78,
          ocr: 52,
          project: 90,
        },
        insightWeights: {
          coverage: 32,
          confidence: 28,
          freshness: 24,
          confirmation: 16,
        },
      },
    },
    sources: [],
    evidence: [],
    candidates: [],
    people: [],
    orgUnits: [],
    roleAssignments: [],
    reportingLines: [],
    changeEvents: [],
    canvasLayouts: {},
    auditLog: [],
  };
}

export function ensureStateShape(state: AppState): AppState {
  return {
    ...state,
    project: {
      ...state.project,
      settings: {
        anonymizeExports: state.project.settings?.anonymizeExports ?? false,
        exportPrivacy: {
          names:
            state.project.settings?.exportPrivacy?.names ??
            state.project.settings?.anonymizeExports ??
            false,
          companies: state.project.settings?.exportPrivacy?.companies ?? false,
          sources: state.project.settings?.exportPrivacy?.sources ?? false,
          notes: state.project.settings?.exportPrivacy?.notes ?? false,
        },
        staleAfterDays: state.project.settings?.staleAfterDays ?? 180,
        defaultVisibleNodeLimit: state.project.settings?.defaultVisibleNodeLimit ?? 300,
        activeCanvasView: normalizeCanvasView(state.project.settings?.activeCanvasView),
        orgChartMode: state.project.settings?.orgChartMode ?? 'formal',
        orgChartExportFormat: state.project.settings?.orgChartExportFormat ?? 'ppt16x9',
        reportTemplate: state.project.settings?.reportTemplate ?? 'recruiting',
        sensitivityLevel: state.project.settings?.sensitivityLevel ?? 'internal',
        sourceCredibility: {
          text: state.project.settings?.sourceCredibility?.text ?? 86,
          markdown: state.project.settings?.sourceCredibility?.markdown ?? 84,
          pptx: state.project.settings?.sourceCredibility?.pptx ?? 78,
          ocr: state.project.settings?.sourceCredibility?.ocr ?? 52,
          project: state.project.settings?.sourceCredibility?.project ?? 90,
        },
        insightWeights: {
          coverage: state.project.settings?.insightWeights?.coverage ?? 32,
          confidence: state.project.settings?.insightWeights?.confidence ?? 28,
          freshness: state.project.settings?.insightWeights?.freshness ?? 24,
          confirmation: state.project.settings?.insightWeights?.confirmation ?? 16,
        },
      },
    },
    canvasLayouts: state.canvasLayouts ?? {},
    auditLog: state.auditLog ?? [],
  };
}

export function createDemoState(): AppState {
  const state = createEmptyState();
  const timestamp = nowIso();
  const evidenceId = createId('ev');
  const sourceId = createId('src');

  state.project.name = '样例：星河科技 mapping';
  state.project.companies = ['星河科技', '北辰智能'];
  state.sources.push({
    id: sourceId,
    fileName: 'demo-call-transcript.txt',
    type: 'text',
    importedAt: timestamp,
    hash: 'demo',
    textPreview: '王敏现任星河科技商业化事业部总经理，李然汇报给王敏。',
    totalChunks: 1,
  });
  state.evidence.push({
    id: evidenceId,
    sourceDocumentId: sourceId,
    sourceName: 'demo-call-transcript.txt',
    location: '文本片段 1',
    text: '王敏现任星河科技商业化事业部总经理，李然汇报给王敏。赵婧从北辰智能加入星河科技平台产品部。',
    extractedAt: timestamp,
    confidence: 0.92,
    candidateIds: [],
  });
  state.orgUnits.push(
    {
      id: createId('org'),
      company: '星河科技',
      name: '商业化事业部',
      function: '业务',
      status: 'active',
      evidenceIds: [evidenceId],
      updatedAt: timestamp,
    },
    {
      id: createId('org'),
      company: '星河科技',
      name: '平台产品部',
      function: '产品',
      status: 'active',
      evidenceIds: [evidenceId],
      updatedAt: timestamp,
    },
  );
  state.people.push(
    {
      id: createId('person'),
      name: '王敏',
      aliases: [],
      company: '星河科技',
      currentTitle: '总经理',
      currentDepartment: '商业化事业部',
      tags: ['样例'],
      status: 'active',
      evidenceIds: [evidenceId],
      updatedAt: timestamp,
    },
    {
      id: createId('person'),
      name: '李然',
      aliases: [],
      company: '星河科技',
      currentTitle: '销售负责人',
      currentDepartment: '商业化事业部',
      tags: ['样例'],
      status: 'active',
      evidenceIds: [evidenceId],
      updatedAt: timestamp,
    },
    {
      id: createId('person'),
      name: '赵婧',
      aliases: [],
      company: '星河科技',
      currentTitle: '产品负责人',
      currentDepartment: '平台产品部',
      tags: ['样例'],
      status: 'active',
      evidenceIds: [evidenceId],
      updatedAt: timestamp,
    },
  );
  state.reportingLines.push({
    id: createId('line'),
    subordinateName: '李然',
    managerName: '王敏',
    relationType: 'reports-to',
    confidence: 0.92,
    evidenceIds: [evidenceId],
    isCurrent: true,
    updatedAt: timestamp,
  });
  state.roleAssignments.push({
    id: createId('role'),
    personName: '王敏',
    title: '商业化事业部总经理',
    orgUnitName: '商业化事业部',
    company: '星河科技',
    status: 'current',
    evidenceIds: [evidenceId],
    updatedAt: timestamp,
  });
  state.changeEvents.push({
    id: createId('change'),
    personName: '赵婧',
    type: 'transfer',
    description: '赵婧从北辰智能加入星河科技平台产品部',
    sourceName: 'demo-call-transcript.txt',
    evidenceIds: [evidenceId],
    createdAt: timestamp,
  });

  return state;
}

export function createMapBusinessDemoState(): AppState {
  const state = createEmptyState();
  const timestamp = nowIso();
  const evidenceId = createId('ev');
  const sourceId = createId('src');
  const mainCompany = '云图地图科技（虚拟）';
  const partnerCompanies = ['星桥出行（虚拟）', '北斗数据服务（虚拟）'];

  state.project.name = '大规模样例：地图平台事业群 mapping';
  state.project.companies = [mainCompany, ...partnerCompanies];
  state.project.settings.defaultVisibleNodeLimit = 96;
  state.project.settings.reportTemplate = 'executive';
  state.project.settings.activeCanvasView = 'executive';
  state.project.settings.orgChartMode = 'formal';
  state.project.settings.orgChartExportFormat = 'ppt16x9';
  state.project.settings.sourceCredibility.text = 96;
  state.sources.push({
    id: sourceId,
    fileName: 'virtual-map-business-sample.txt',
    type: 'text',
    importedAt: timestamp,
    hash: 'virtual-map-business-sample',
    textPreview:
      '虚拟样例，不对应真实百度地图组织。覆盖地图数据、导航路线、本地生活搜索、车载生态、商业化、AI平台等方向。',
    totalChunks: 5,
    warnings: ['此样例为功能测试用虚拟数据，不代表任何真实公司的组织架构。'],
  });
  state.evidence.push({
    id: evidenceId,
    sourceDocumentId: sourceId,
    sourceName: 'virtual-map-business-sample.txt',
    location: '虚拟样例生成',
    text: '以大型互联网地图业务为参考生成的虚拟组织：包含产品、研发、算法、数据、运营、商业化、车载生态、质量安全与HRBP等多职能团队。',
    extractedAt: timestamp,
    confidence: 0.95,
    candidateIds: [],
  });

  const surnames = [
    '赵',
    '钱',
    '孙',
    '李',
    '周',
    '吴',
    '郑',
    '王',
    '冯',
    '陈',
    '褚',
    '卫',
    '蒋',
    '沈',
    '韩',
    '杨',
    '朱',
    '秦',
    '尤',
    '许',
    '何',
    '吕',
    '施',
    '张',
    '孔',
    '曹',
    '严',
    '华',
    '金',
    '魏',
    '陶',
    '姜',
  ];
  const given = [
    '亦航',
    '景然',
    '思远',
    '明澈',
    '知行',
    '雨桐',
    '星野',
    '清越',
    '安和',
    '嘉宁',
    '云舒',
    '若溪',
    '子墨',
    '沐阳',
    '书言',
    '承泽',
    '念真',
    '修远',
    '可欣',
    '怀瑾',
    '启明',
    '以宁',
    '远洲',
    '南乔',
    '北辰',
    '知夏',
    '予安',
    '洛川',
    '宁川',
    '锦程',
    '映雪',
    '言蹊',
    '青岚',
    '初尧',
    '芷涵',
    '辰溪',
  ];
  let nameIndex = 0;
  const nextName = () => {
    const namePoolSize = surnames.length * given.length;
    const poolRound = Math.floor(nameIndex / namePoolSize);
    const name = `${surnames[nameIndex % surnames.length]}${given[Math.floor(nameIndex / surnames.length) % given.length]}${poolRound > 0 ? poolRound + 1 : ''}`;
    nameIndex += 1;
    return name;
  };

  const addOrgUnit = (name: string, fn: string, parentId?: string) => {
    const unit = {
      id: createId('org'),
      company: mainCompany,
      name,
      parentId,
      function: fn,
      status: 'active' as const,
      evidenceIds: [evidenceId],
      updatedAt: timestamp,
    };
    state.orgUnits.push(unit);
    return unit;
  };

  const addPerson = (name: string, title: string, department: string, tags: string[] = []): Person => {
    const person: Person = {
      id: createId('person'),
      name,
      aliases: [],
      company: mainCompany,
      currentTitle: title,
      currentDepartment: department,
      tags: ['虚拟样例', ...tags],
      status: 'active',
      evidenceIds: [evidenceId],
      updatedAt: timestamp,
    };
    state.people.push(person);
    state.roleAssignments.push({
      id: createId('role'),
      personId: person.id,
      personName: name,
      title,
      orgUnitName: department,
      company: mainCompany,
      status: 'current',
      evidenceIds: [evidenceId],
      updatedAt: timestamp,
    });
    return person;
  };

  const addLine = (subordinateName: string, managerName: string, confidence = 0.91) => {
    state.reportingLines.push({
      id: createId('line'),
      subordinateName,
      managerName,
      relationType: 'reports-to',
      confidence,
      evidenceIds: [evidenceId],
      isCurrent: true,
      updatedAt: timestamp,
    });
  };

  const president = addPerson('林澈', '地图平台事业群总经理', '地图平台事业群', ['高管', '核心目标']);
  const businessUnits = [
    {
      name: '地图数据与采集平台',
      fn: '数据',
      leadTitle: '数据平台副总裁',
      departments: ['地图生产平台部', '道路与POI数据部', '众包采集运营部', '数据质量治理部'],
    },
    {
      name: '导航与路线规划',
      fn: '算法',
      leadTitle: '导航算法副总裁',
      departments: ['路线规划算法部', '实时路况引擎部', '公交骑行导航部', '仿真评测平台部'],
    },
    {
      name: '本地生活搜索',
      fn: '产品',
      leadTitle: '搜索产品副总裁',
      departments: ['地点搜索产品部', '商户内容生态部', '评价与推荐部', '搜索增长部'],
    },
    {
      name: '车载与出行生态',
      fn: '生态',
      leadTitle: '车载生态副总裁',
      departments: ['车机产品部', '主机厂合作部', '自动驾驶地图部', '出行服务接入部'],
    },
    {
      name: '商业化与行业解决方案',
      fn: '商业化',
      leadTitle: '商业化副总裁',
      departments: ['广告商业产品部', '政企解决方案部', '渠道与客户成功部', '收入运营部'],
    },
    {
      name: '基础平台与AI能力',
      fn: '研发技术',
      leadTitle: '平台技术副总裁',
      departments: ['地图渲染引擎部', '位置服务平台部', '时空AI平台部', '端云基础架构部'],
    },
    {
      name: '用户增长与运营',
      fn: '运营',
      leadTitle: '增长运营副总裁',
      departments: ['用户增长部', '内容运营部', '活动与会员部', '渠道投放部'],
    },
    {
      name: '质量安全与隐私合规',
      fn: '风控合规',
      leadTitle: '安全合规负责人',
      departments: ['地图内容安全部', '隐私合规部', '质量评测部', '应急保障部'],
    },
    {
      name: '产品设计与体验',
      fn: '体验设计',
      leadTitle: '产品体验负责人',
      departments: ['地图核心产品部', '交互体验设计部', '视觉语言设计部', '用户研究部'],
    },
    {
      name: '组织与人才发展',
      fn: '人力资源',
      leadTitle: 'HRBP负责人',
      departments: ['HRBP团队', '招聘配置部', '人才发展部', '组织效能部'],
    },
  ];
  const squadNames = ['平台', '策略', '交付'];
  const icRoles = ['高级工程师', '产品经理', '算法工程师', '数据分析师', '运营专家', '解决方案顾问'];

  for (const unit of businessUnits) {
    const unitOrg = addOrgUnit(unit.name, unit.fn);
    const unitLead = addPerson(nextName(), unit.leadTitle, unit.name, ['一级负责人']);
    addLine(unitLead.name, president.name, 0.94);

    unit.departments.forEach((departmentName, departmentIndex) => {
      const departmentOrg = addOrgUnit(departmentName, unit.fn, unitOrg.id);
      const departmentLead = addPerson(nextName(), `${departmentName}负责人`, departmentName, ['二级负责人']);
      addLine(departmentLead.name, unitLead.name, 0.92);

      squadNames.forEach((squadName, squadIndex) => {
        const squadFullName = `${departmentName}${squadName}组`;
        addOrgUnit(squadFullName, unit.fn, departmentOrg.id);
        const squadLead = addPerson(nextName(), `${squadFullName}负责人`, squadFullName, ['三级负责人']);
        addLine(squadLead.name, departmentLead.name, 0.9);

        for (let memberIndex = 0; memberIndex < 41; memberIndex += 1) {
          const role = icRoles[(departmentIndex + squadIndex + memberIndex) % icRoles.length];
          const member = addPerson(nextName(), role, squadFullName, ['关键人才池']);
          addLine(member.name, squadLead.name, 0.91);
        }
      });
    });
  }

  const movers = state.people.filter((person) => person.tags.includes('关键人才池')).slice(0, 18);
  movers.forEach((person, index) => {
    const fromCompany = partnerCompanies[index % partnerCompanies.length];
    state.changeEvents.push({
      id: createId('change'),
      personName: person.name,
      type: index % 3 === 0 ? 'transfer' : 'new',
      description: `${person.name}从${fromCompany}加入${mainCompany}，当前在${person.currentDepartment}担任${person.currentTitle}`,
      date: `2026-${String((index % 5) + 1).padStart(2, '0')}-${String((index % 24) + 1).padStart(2, '0')}`,
      sourceName: 'virtual-map-business-sample.txt',
      evidenceIds: [evidenceId],
      createdAt: timestamp,
    });
  });

  return state;
}
