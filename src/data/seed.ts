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
      name: '?????? Mapping',
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

  state.project.name = '??????? mapping';
  state.project.companies = ['????', '????'];
  state.sources.push({
    id: sourceId,
    fileName: 'demo-call-transcript.txt',
    type: 'text',
    importedAt: timestamp,
    hash: 'demo',
    textPreview: '??????????????????????????',
    totalChunks: 1,
  });
  state.evidence.push({
    id: evidenceId,
    sourceDocumentId: sourceId,
    sourceName: 'demo-call-transcript.txt',
    location: '???? 1',
    text: '?????????????????????????????????????????????',
    extractedAt: timestamp,
    confidence: 0.92,
    candidateIds: [],
  });
  state.orgUnits.push(
    {
      id: createId('org'),
      company: '????',
      name: '??????',
      function: '??',
      status: 'active',
      evidenceIds: [evidenceId],
      updatedAt: timestamp,
    },
    {
      id: createId('org'),
      company: '????',
      name: '?????',
      function: '??',
      status: 'active',
      evidenceIds: [evidenceId],
      updatedAt: timestamp,
    },
  );
  state.people.push(
    {
      id: createId('person'),
      name: '??',
      aliases: [],
      company: '????',
      currentTitle: '???',
      currentDepartment: '??????',
      tags: ['??'],
      status: 'active',
      evidenceIds: [evidenceId],
      updatedAt: timestamp,
    },
    {
      id: createId('person'),
      name: '??',
      aliases: [],
      company: '????',
      currentTitle: '?????',
      currentDepartment: '??????',
      tags: ['??'],
      status: 'active',
      evidenceIds: [evidenceId],
      updatedAt: timestamp,
    },
    {
      id: createId('person'),
      name: '??',
      aliases: [],
      company: '????',
      currentTitle: '?????',
      currentDepartment: '?????',
      tags: ['??'],
      status: 'active',
      evidenceIds: [evidenceId],
      updatedAt: timestamp,
    },
  );
  state.reportingLines.push({
    id: createId('line'),
    subordinateName: '??',
    managerName: '??',
    relationType: 'reports-to',
    confidence: 0.92,
    evidenceIds: [evidenceId],
    isCurrent: true,
    updatedAt: timestamp,
  });
  state.roleAssignments.push({
    id: createId('role'),
    personName: '??',
    title: '?????????',
    orgUnitName: '??????',
    company: '????',
    status: 'current',
    evidenceIds: [evidenceId],
    updatedAt: timestamp,
  });
  state.changeEvents.push({
    id: createId('change'),
    personName: '??',
    type: 'transfer',
    description: '??????????????????',
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
  const mainCompany = '??????????';
  const partnerCompanies = ['????????', '??????????'];

  state.project.name = '????????????? mapping';
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
      '?????????????????????????????????????????????AI??????',
    totalChunks: 5,
    warnings: ['?????????????????????????????'],
  });
  state.evidence.push({
    id: evidenceId,
    sourceDocumentId: sourceId,
    sourceName: 'virtual-map-business-sample.txt',
    location: '??????',
    text: '????????????????????????????????????????????????????HRBP???????',
    extractedAt: timestamp,
    confidence: 0.95,
    candidateIds: [],
  });

  const surnames = [
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
    '?',
  ];
  const given = [
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
    '??',
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
      tags: ['????', ...tags],
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

  const president = addPerson('??', '??????????', '???????', ['??', '????']);
  const businessUnits = [
    {
      name: '?????????',
      fn: '??',
      leadTitle: '???????',
      departments: ['???????', '???POI???', '???????', '???????'],
    },
    {
      name: '???????',
      fn: '??',
      leadTitle: '???????',
      departments: ['???????', '???????', '???????', '???????'],
    },
    {
      name: '??????',
      fn: '??',
      leadTitle: '???????',
      departments: ['???????', '???????', '??????', '?????'],
    },
    {
      name: '???????',
      fn: '??',
      leadTitle: '???????',
      departments: ['?????', '??????', '???????', '???????'],
    },
    {
      name: '??????????',
      fn: '???',
      leadTitle: '??????',
      departments: ['???????', '???????', '????????', '?????'],
    },
    {
      name: '?????AI??',
      fn: '????',
      leadTitle: '???????',
      departments: ['???????', '???????', '??AI???', '???????'],
    },
    {
      name: '???????',
      fn: '??',
      leadTitle: '???????',
      departments: ['?????', '?????', '??????', '?????'],
    },
    {
      name: '?????????',
      fn: '????',
      leadTitle: '???????',
      departments: ['???????', '?????', '?????', '?????'],
    },
    {
      name: '???????',
      fn: '????',
      leadTitle: '???????',
      departments: ['???????', '???????', '???????', '?????'],
    },
    {
      name: '???????',
      fn: '????',
      leadTitle: 'HRBP???',
      departments: ['HRBP??', '?????', '?????', '?????'],
    },
  ];
  const squadNames = ['??', '??', '??'];
  const icRoles = ['?????', '????', '?????', '?????', '????', '??????'];

  for (const unit of businessUnits) {
    const unitOrg = addOrgUnit(unit.name, unit.fn);
    const unitLead = addPerson(nextName(), unit.leadTitle, unit.name, ['?????']);
    addLine(unitLead.name, president.name, 0.94);

    unit.departments.forEach((departmentName, departmentIndex) => {
      const departmentOrg = addOrgUnit(departmentName, unit.fn, unitOrg.id);
      const departmentLead = addPerson(nextName(), `${departmentName}???`, departmentName, ['?????']);
      addLine(departmentLead.name, unitLead.name, 0.92);

      squadNames.forEach((squadName, squadIndex) => {
        const squadFullName = `${departmentName}${squadName}?`;
        addOrgUnit(squadFullName, unit.fn, departmentOrg.id);
        const squadLead = addPerson(nextName(), `${squadFullName}???`, squadFullName, ['?????']);
        addLine(squadLead.name, departmentLead.name, 0.9);

        for (let memberIndex = 0; memberIndex < 41; memberIndex += 1) {
          const role = icRoles[(departmentIndex + squadIndex + memberIndex) % icRoles.length];
          const member = addPerson(nextName(), role, squadFullName, ['?????']);
          addLine(member.name, squadLead.name, 0.91);
        }
      });
    });
  }

  const movers = state.people.filter((person) => person.tags.includes('?????')).slice(0, 18);
  movers.forEach((person, index) => {
    const fromCompany = partnerCompanies[index % partnerCompanies.length];
    state.changeEvents.push({
      id: createId('change'),
      personName: person.name,
      type: index % 3 === 0 ? 'transfer' : 'new',
      description: `${person.name}?${fromCompany}??${mainCompany}????${person.currentDepartment}??${person.currentTitle}`,
      date: `2026-${String((index % 5) + 1).padStart(2, '0')}-${String((index % 24) + 1).padStart(2, '0')}`,
      sourceName: 'virtual-map-business-sample.txt',
      evidenceIds: [evidenceId],
      createdAt: timestamp,
    });
  });

  return state;
}
