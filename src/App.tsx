import {
  BriefcaseBusiness,
  Check,
  Download,
  GitBranch,
  ImageDown,
  Inbox,
  Lock,
  Maximize2,
  Move,
  Network,
  RotateCcw,
  Save,
  ShieldCheck,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyNodeChanges,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import { createEmptyState, createMapBusinessDemoState, ensureStateShape } from './data/seed';
import { buildOrgGraph, layoutIdForCanvasView } from './lib/graph';
import { importSourceFile } from './lib/importer';
import { loadPersistedState, persistState } from './lib/idb';
import { addImportResult, updateCandidateStatus } from './lib/merge';
import { exportEncryptedProjectPackage, importEncryptedProjectPackage } from './lib/projectPackage';
import { downloadBlob, exportOrgGraphPng, exportReportPptx } from './lib/exporters';
import { createId, normalizeName } from './lib/ids';
import type {
  AnyCandidatePayload,
  AppState,
  AuditAction,
  CandidateKind,
  CandidateRecord,
  ChangeCandidatePayload,
  OrgChartMode,
  OrgMapFilters,
  OrgUnitCandidatePayload,
  PersonCandidatePayload,
  ReportingCandidatePayload,
  RoleCandidatePayload,
} from './types';

type ViewKey = 'import' | 'review' | 'map' | 'export';
type OrgBusinessMode = 'report' | 'recruiting';
type OrgChartStyle = 'regular' | 'tree';
type CanvasViewKey = AppState['project']['settings']['activeCanvasView'];

const navItems: Array<{ key: ViewKey; label: string; icon: typeof Inbox }> = [
  { key: 'import', label: '??', icon: Inbox },
  { key: 'review', label: '??', icon: Check },
  { key: 'map', label: '???', icon: Network },
  { key: 'export', label: '??', icon: Download },
];

const kindLabel: Record<CandidateKind, string> = {
  person: '??',
  orgUnit: '??',
  roleAssignment: '??',
  reportingLine: '???',
  changeEvent: '??',
};

const defaultFilters: OrgMapFilters = {
  company: '',
  search: '',
  focusPersonName: '',
  minConfidence: 0.72,
  visibleLimit: 96,
  maxDepth: 3,
};

const canvasPresets: Record<
  CanvasViewKey,
  {
    template: AppState['project']['settings']['reportTemplate'];
    chartMode: OrgChartMode;
    filters: Pick<OrgMapFilters, 'minConfidence' | 'visibleLimit' | 'maxDepth'>;
  }
> = {
  executive: { template: 'executive', chartMode: 'formal', filters: { minConfidence: 0.72, visibleLimit: 96, maxDepth: 3 } },
  mindmap: { template: 'executive', chartMode: 'formal', filters: { minConfidence: 0.72, visibleLimit: 96, maxDepth: 3 } },
  recruiting: { template: 'recruiting', chartMode: 'explore', filters: { minConfidence: 0.55, visibleLimit: 360, maxDepth: 6 } },
  detail: { template: 'recruiting', chartMode: 'formal', filters: { minConfidence: 0.55, visibleLimit: 360, maxDepth: 6 } },
};

function canvasViewForMode(mode: OrgBusinessMode, style: OrgChartStyle): CanvasViewKey {
  if (mode === 'report') return style === 'tree' ? 'mindmap' : 'executive';
  return style === 'tree' ? 'detail' : 'recruiting';
}

function businessModeForView(view: CanvasViewKey): OrgBusinessMode {
  return view === 'recruiting' || view === 'detail' ? 'recruiting' : 'report';
}

function chartStyleForView(view: CanvasViewKey): OrgChartStyle {
  return view === 'mindmap' || view === 'detail' ? 'tree' : 'regular';
}

function canvasViewLabel(view: CanvasViewKey): string {
  return {
    executive: '???? ? ?????',
    mindmap: '???? ? ???',
    recruiting: '???? ? ?????',
    detail: '???? ? ???',
  }[view];
}

function appendAudit(
  current: AppState,
  action: AuditAction,
  description: string,
  options: { entityCount?: number; view?: ViewKey | string; sourceName?: string } = {},
): AppState {
  const timestamp = new Date().toISOString();
  return {
    ...current,
    project: { ...current.project, updatedAt: timestamp },
    auditLog: [
      {
        id: createId('audit'),
        action,
        description,
        createdAt: timestamp,
        actor: 'local-hr' as const,
        entityCount: options.entityCount,
        view: options.view,
        sourceName: options.sourceName,
      },
      ...(current.auditLog ?? []),
    ].slice(0, 120),
  };
}

function candidateSummary(candidate: CandidateRecord<AnyCandidatePayload>): string {
  const payload = candidate.payload;
  if ('personName' in payload && 'title' in payload) return `${payload.personName} / ${payload.title}`;
  if ('subordinateName' in payload) return `${payload.subordinateName} -> ${payload.managerName}`;
  if ('description' in payload) return payload.description;
  if ('name' in payload) return payload.name;
  return kindLabel[candidate.kind];
}

function formatDate(value?: string): string {
  if (!value) return '-';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function App() {
  const [state, setState] = useState<AppState>(() => createEmptyState());
  const [activeView, setActiveView] = useState<ViewKey>('import');
  const [loaded, setLoaded] = useState(false);
  const [enableOcr, setEnableOcr] = useState(false);
  const [filters, setFilters] = useState<OrgMapFilters>(defaultFilters);
  const [password, setPassword] = useState('');
  const [toast, setToast] = useState('');
  const [openManualRepair, setOpenManualRepair] = useState(false);
  const saveTimer = useRef<number | undefined>();

  useEffect(() => {
    loadPersistedState()
      .then((persisted) => {
        if (!persisted) return;
        const hydrated = ensureStateShape(persisted);
        setState(hydrated);
        setFilters((current) => ({
          ...current,
          visibleLimit: hydrated.project.settings.defaultVisibleNodeLimit,
        }));
      })
      .catch((error) => setToast(`????????${error instanceof Error ? error.message : String(error)}`))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      persistState(state).catch((error) =>
        setToast(`???????${error instanceof Error ? error.message : String(error)}`),
      );
    }, 350);
  }, [loaded, state]);

  const pendingCandidates = useMemo(
    () => state.candidates.filter((candidate) => candidate.status === 'pending'),
    [state.candidates],
  );
  const graph = useMemo(() => buildOrgGraph(state, filters), [state, filters]);

  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files?.length) return;
    let candidateCount = 0;

    for (const file of [...files]) {
      try {
        const result = await importSourceFile(file, { enableOcr });
        candidateCount += result.candidates.length;
        setState((current) =>
          appendAudit(addImportResult(current, result), 'import', `?? ${file.name}`, {
            entityCount: result.candidates.length,
            view: 'import',
            sourceName: file.name,
          }),
        );
      } catch (error) {
        setToast(`${file.name} ?????${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (candidateCount > 0) {
      setToast(`??? ${candidateCount} ???`);
      setOpenManualRepair(false);
      setActiveView('review');
    } else {
      setToast(enableOcr ? '????????????' : '?????????? OCR ?????????');
      setOpenManualRepair(true);
      setActiveView('map');
    }
  }

  function loadMapBusinessDemo(): void {
    const demo = createMapBusinessDemoState();
    setState(appendAudit(demo, 'demo-loaded', '?????????????', { entityCount: demo.people.length, view: 'map' }));
    setFilters({ ...defaultFilters, visibleLimit: 96, maxDepth: 3, minConfidence: 0.72 });
    setOpenManualRepair(false);
    setActiveView('map');
    setToast('???????Demo');
  }

  function decideCandidates(candidateIds: string[], status: 'accepted' | 'rejected'): void {
    let shouldOpenMap = false;
    setState((current) => {
      const selectedPendingCount = candidateIds.filter((id) =>
        current.candidates.some((candidate) => candidate.id === id && candidate.status === 'pending'),
      ).length;
      if (selectedPendingCount === 0) return current;
      const next = updateCandidateStatus(current, candidateIds, status);
      shouldOpenMap = next.candidates.every((candidate) => candidate.status !== 'pending');
      return appendAudit(
        next,
        status === 'accepted' ? 'candidate-accepted' : 'candidate-rejected',
        `${status === 'accepted' ? '??' : '??'} ${selectedPendingCount} ???`,
        { entityCount: selectedPendingCount, view: 'review' },
      );
    });
    window.setTimeout(() => {
      if (shouldOpenMap) setActiveView('map');
    }, 0);
  }

  function updateCandidatePayload(candidateId: string, field: string, value: string): void {
    setState((current) => {
      const next: AppState = structuredClone(current);
      const candidate = next.candidates.find((item) => item.id === candidateId);
      if (candidate && candidate.status === 'pending') {
        candidate.payload = { ...candidate.payload, [field]: value } as AnyCandidatePayload;
      }
      return next;
    });
  }

  async function exportPackage(): Promise<void> {
    try {
      const blob = await exportEncryptedProjectPackage(state, password);
      downloadBlob(blob, `${state.project.name}.mapping.zip`);
      setState((current) => appendAudit(current, 'export', '???????', { view: 'export' }));
      setToast('????????');
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }

  async function importPackage(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const imported = ensureStateShape(await importEncryptedProjectPackage(file, password));
      setState(appendAudit(imported, 'project-imported', `????? ${file.name}`, { view: 'export', sourceName: file.name }));
      setActiveView('map');
      setToast('??????');
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }

  function exportPng(): void {
    try {
      const dataUrl = exportOrgGraphPng(state, filters);
      fetch(dataUrl)
        .then((response) => response.blob())
        .then((blob) => {
          downloadBlob(blob, `${state.project.name}-org-map.png`);
          setState((current) => appendAudit(current, 'export', '????? PNG', { entityCount: graph.nodes.length, view: 'export' }));
        });
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }

  async function exportPptx(): Promise<void> {
    try {
      await exportReportPptx(state, filters);
      setState((current) => appendAudit(current, 'export', '?? PPTX', { entityCount: graph.nodes.length, view: 'export' }));
      setToast('PPTX ???');
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">
            <GitBranch size={20} />
          </div>
          <div>
            <strong>Mapping ??</strong>
            <span>????????</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="???">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={activeView === item.key ? 'nav-item active' : 'nav-item'}
                type="button"
                onClick={() => setActiveView(item.key)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="privacy-box">
          <ShieldCheck size={18} />
          <div>
            <strong>????</strong>
            <span>???????? IndexedDB?</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        {toast && (
          <div className="toast" role="status">
            <span>{toast}</span>
            <button type="button" onClick={() => setToast('')} aria-label="????">
              <X size={16} />
            </button>
          </div>
        )}

        {activeView === 'import' && (
          <ImportView enableOcr={enableOcr} setEnableOcr={setEnableOcr} onFiles={handleFiles} loadMapBusinessDemo={loadMapBusinessDemo} />
        )}

        {activeView === 'review' && (
          <ReviewView
            candidates={pendingCandidates}
            onAccept={(ids) => decideCandidates(ids, 'accepted')}
            onReject={(ids) => decideCandidates(ids, 'rejected')}
            onFieldChange={updateCandidatePayload}
          />
        )}

        {activeView === 'map' && (
          <OrgMapView
            state={state}
            setState={setState}
            filters={filters}
            setFilters={setFilters}
            graph={graph}
            openManualRepair={openManualRepair}
            onManualRepairOpened={() => setOpenManualRepair(false)}
          />
        )}

        {activeView === 'export' && (
          <ExportView
            state={state}
            filters={filters}
            password={password}
            setPassword={setPassword}
            exportPackage={exportPackage}
            importPackage={importPackage}
            exportPng={exportPng}
            exportPptx={exportPptx}
          />
        )}
      </main>
    </div>
  );
}

function ImportView({
  enableOcr,
  setEnableOcr,
  onFiles,
  loadMapBusinessDemo,
}: {
  enableOcr: boolean;
  setEnableOcr: (value: boolean) => void;
  onFiles: (files: FileList | null) => void;
  loadMapBusinessDemo: () => void;
}) {
  return (
    <section className="view-stack">
      <div className="import-entry-grid">
        <div className="drop-zone">
          <Upload size={30} />
          <h2>????</h2>
          <input
            type="file"
            multiple
            accept=".txt,.md,.pptx,.png,.jpg,.jpeg,.webp,.bmp"
            onChange={(event) => void onFiles(event.target.files)}
            aria-label="??????"
          />
          <label className="toggle-line">
            <input type="checkbox" checked={enableOcr} onChange={(event) => setEnableOcr(event.target.checked)} />
            <span>?? OCR</span>
          </label>
        </div>

        <aside className="demo-data-panel">
          <button type="button" className="primary-button" onClick={loadMapBusinessDemo}>
            <Network size={16} />
            ????Demo
          </button>
        </aside>
      </div>
    </section>
  );
}

function ReviewView({
  candidates,
  onAccept,
  onReject,
  onFieldChange,
}: {
  candidates: CandidateRecord<AnyCandidatePayload>[];
  onAccept: (ids: string[]) => void;
  onReject: (ids: string[]) => void;
  onFieldChange: (candidateId: string, field: string, value: string) => void;
}) {
  const [kindFilter, setKindFilter] = useState<CandidateKind | 'all'>('all');
  const allIds = candidates.map((candidate) => candidate.id);
  const visibleCandidates = candidates
    .filter((candidate) => kindFilter === 'all' || candidate.kind === kindFilter)
    .slice(0, 160);
  const counts = (Object.keys(kindLabel) as CandidateKind[]).map((kind) => ({
    kind,
    label: kindLabel[kind],
    count: candidates.filter((candidate) => candidate.kind === kind).length,
  }));

  return (
    <section className="view-stack">
      <section className="tool-panel recognition-preview">
        <div className="section-heading">
          <h2>??????</h2>
          <span className="small-badge">{candidates.length}</span>
        </div>
        <div className="recognition-grid">
          {counts.map((item) => (
            <button
              key={item.kind}
              type="button"
              className={kindFilter === item.kind ? 'active' : ''}
              onClick={() => setKindFilter(item.kind)}
            >
              <strong>{item.count}</strong>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="toolbar">
        <button type="button" className="secondary-button" onClick={() => setKindFilter('all')}>
          ??
        </button>
        <button type="button" className="primary-button" onClick={() => onAccept(allIds)} disabled={!allIds.length}>
          <Check size={16} />
          ????
        </button>
        <button type="button" className="secondary-button" onClick={() => onReject(allIds)} disabled={!allIds.length}>
          <X size={16} />
          ????
        </button>
      </div>

      <div className="candidate-list">
        {visibleCandidates.map((candidate) => (
          <article className="candidate-card" key={candidate.id}>
            <div className="candidate-main">
              <div className="candidate-title">
                <span className="kind-pill">{kindLabel[candidate.kind]}</span>
                <strong>{candidateSummary(candidate)}</strong>
                <em>{Math.round(candidate.confidence * 100)}%</em>
              </div>
              <CandidateEditor candidate={candidate} onFieldChange={onFieldChange} />
              <blockquote>{candidate.evidenceText}</blockquote>
              <small>{candidate.sourceName}</small>
            </div>
            <div className="candidate-actions">
              <button type="button" className="primary-button" onClick={() => onAccept([candidate.id])}>
                ??
              </button>
              <button type="button" className="secondary-button" onClick={() => onReject([candidate.id])}>
                ??
              </button>
            </div>
          </article>
        ))}
        {visibleCandidates.length === 0 && <EmptyState title="???????" body="?????????????????????" />}
      </div>
    </section>
  );
}

function CandidateEditor({
  candidate,
  onFieldChange,
}: {
  candidate: CandidateRecord<AnyCandidatePayload>;
  onFieldChange: (candidateId: string, field: string, value: string) => void;
}) {
  const payload = candidate.payload;
  const fields: Array<{ key: string; label: string; value?: string }> = [];

  if (candidate.kind === 'person') {
    const data = payload as PersonCandidatePayload;
    fields.push(
      { key: 'name', label: '??', value: data.name },
      { key: 'company', label: '??', value: data.company },
      { key: 'title', label: '??', value: data.title },
      { key: 'department', label: '??', value: data.department },
    );
  }
  if (candidate.kind === 'orgUnit') {
    const data = payload as OrgUnitCandidatePayload;
    fields.push(
      { key: 'name', label: '??', value: data.name },
      { key: 'company', label: '??', value: data.company },
      { key: 'function', label: '??', value: data.function },
      { key: 'parentName', label: '????', value: data.parentName },
    );
  }
  if (candidate.kind === 'roleAssignment') {
    const data = payload as RoleCandidatePayload;
    fields.push(
      { key: 'personName', label: '??', value: data.personName },
      { key: 'title', label: '??', value: data.title },
      { key: 'orgUnitName', label: '??', value: data.orgUnitName },
      { key: 'company', label: '??', value: data.company },
    );
  }
  if (candidate.kind === 'reportingLine') {
    const data = payload as ReportingCandidatePayload;
    fields.push(
      { key: 'managerName', label: '??', value: data.managerName },
      { key: 'subordinateName', label: '??', value: data.subordinateName },
      { key: 'relationType', label: '??', value: data.relationType },
    );
  }
  if (candidate.kind === 'changeEvent') {
    const data = payload as ChangeCandidatePayload;
    fields.push(
      { key: 'personName', label: '??', value: data.personName },
      { key: 'type', label: '??', value: data.type },
      { key: 'description', label: '??', value: data.description },
      { key: 'date', label: '??', value: data.date },
    );
  }

  return (
    <div className="candidate-fields">
      {fields.map((field) => (
        <label className="field" key={field.key}>
          <span>{field.label}</span>
          <input value={field.value ?? ''} onChange={(event) => onFieldChange(candidate.id, field.key, event.target.value)} />
        </label>
      ))}
    </div>
  );
}

function OrgMapView({
  state,
  setState,
  filters,
  setFilters,
  graph,
  openManualRepair,
  onManualRepairOpened,
}: {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState>>;
  filters: OrgMapFilters;
  setFilters: (filters: OrgMapFilters) => void;
  graph: ReturnType<typeof buildOrgGraph>;
  openManualRepair: boolean;
  onManualRepairOpened: () => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [showManualRepair, setShowManualRepair] = useState(false);
  const [manualPerson, setManualPerson] = useState({ name: '', title: '', department: '', company: '' });
  const [manualLine, setManualLine] = useState({ manager: '', subordinate: '' });
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);
  const activeView = state.project.settings.activeCanvasView;
  const businessMode = businessModeForView(activeView);
  const chartStyle = chartStyleForView(activeView);
  const isReportMode = businessMode === 'report';
  const isTree = chartStyle === 'tree';
  const layoutId = layoutIdForCanvasView(activeView);
  const savedPositions = state.canvasLayouts?.[layoutId]?.nodes ?? {};
  const savedCount = graph.nodes.filter((node) => savedPositions[node.id]).length;
  const selectedGraphNode = graph.nodes.find((node) => node.id === selectedNodeId);

  useEffect(() => {
    if (!openManualRepair) return;
    setShowManualRepair(true);
    onManualRepairOpened();
  }, [onManualRepairOpened, openManualRepair]);

  const applyCanvasView = (view: CanvasViewKey) => {
    const preset = canvasPresets[view];
    setFilters({ ...filters, ...preset.filters });
    setEditMode(false);
    setSelectedNodeId('');
    setState((current) => ({
      ...current,
      project: {
        ...current.project,
        updatedAt: new Date().toISOString(),
        settings: {
          ...current.project.settings,
          activeCanvasView: view,
          orgChartMode: preset.chartMode,
          defaultVisibleNodeLimit: preset.filters.visibleLimit,
          reportTemplate: preset.template,
        },
      },
    }));
    window.setTimeout(() => flowInstance?.fitView({ duration: 260 }), 60);
  };

  const saveVisibleLayout = () => {
    setState((current) => {
      const next: AppState = structuredClone(current);
      const timestamp = new Date().toISOString();
      const currentLayout = next.canvasLayouts?.[layoutId] ?? { nodes: {}, updatedAt: timestamp };
      const visiblePositions = Object.fromEntries(
        nodes.filter((node) => !String(node.id).startsWith('lane:')).map((node) => [
          node.id,
          {
            x: Math.round(node.position.x),
            y: Math.round(node.position.y),
            updatedAt: timestamp,
          },
        ]),
      );
      next.canvasLayouts = {
        ...(next.canvasLayouts ?? {}),
        [layoutId]: {
          nodes: { ...currentLayout.nodes, ...visiblePositions },
          updatedAt: timestamp,
        },
      };
      next.project.updatedAt = timestamp;
      return appendAudit(next, 'canvas-layout-saved', `??${canvasViewLabel(activeView)}??`, {
        entityCount: Object.keys(visiblePositions).length,
        view: 'map',
      });
    });
  };

  const resetLayout = () => {
    setState((current) => {
      const next: AppState = structuredClone(current);
      const layouts = { ...(next.canvasLayouts ?? {}) };
      delete layouts[layoutId];
      next.canvasLayouts = layouts;
      next.project.updatedAt = new Date().toISOString();
      return appendAudit(next, 'canvas-layout-reset', `??${canvasViewLabel(activeView)}??`, { view: 'map' });
    });
  };

  const upsertManualPerson = () => {
    const name = manualPerson.name.trim();
    if (!name) return;
    const timestamp = new Date().toISOString();
    setState((current) => {
      const next: AppState = structuredClone(current);
      const existing = next.people.find((person) => normalizeName(person.name) === normalizeName(name));
      const company = manualPerson.company.trim() || existing?.company || next.project.companies[0] || '?????';
      const department = manualPerson.department.trim() || existing?.currentDepartment;
      const title = manualPerson.title.trim() || existing?.currentTitle;
      if (existing) {
        existing.company = company;
        existing.currentDepartment = department;
        existing.currentTitle = title;
        existing.updatedAt = timestamp;
      } else {
        next.people.push({
          id: createId('person'),
          name,
          aliases: [],
          company,
          currentTitle: title,
          currentDepartment: department,
          tags: ['????'],
          status: 'active',
          evidenceIds: [],
          updatedAt: timestamp,
        });
      }
      if (company && !next.project.companies.includes(company)) next.project.companies.push(company);
      if (department && !next.orgUnits.some((unit) => unit.company === company && unit.name === department)) {
        next.orgUnits.push({
          id: createId('org'),
          company,
          name: department,
          status: 'active',
          evidenceIds: [],
          updatedAt: timestamp,
        });
      }
      if (title && !next.roleAssignments.some((role) => normalizeName(role.personName) === normalizeName(name) && role.title === title)) {
        next.roleAssignments.push({
          id: createId('role'),
          personName: name,
          title,
          orgUnitName: department,
          company,
          status: 'current',
          evidenceIds: [],
          updatedAt: timestamp,
        });
      }
      next.project.updatedAt = timestamp;
      return appendAudit(next, 'talent-updated', `?????? ${name}`, { view: 'map' });
    });
    setManualPerson({ name: '', title: '', department: '', company: '' });
  };

  const addManualLine = () => {
    const manager = manualLine.manager.trim();
    const subordinate = manualLine.subordinate.trim();
    if (!manager || !subordinate || normalizeName(manager) === normalizeName(subordinate)) return;
    const timestamp = new Date().toISOString();
    setState((current) => {
      const next: AppState = structuredClone(current);
      for (const name of [manager, subordinate]) {
        if (!next.people.some((person) => normalizeName(person.name) === normalizeName(name))) {
          next.people.push({
            id: createId('person'),
            name,
            aliases: [],
            company: next.project.companies[0] || '?????',
            tags: ['????'],
            status: 'active',
            evidenceIds: [],
            updatedAt: timestamp,
          });
        }
      }
      const existing = next.reportingLines.find(
        (line) =>
          normalizeName(line.managerName) === normalizeName(manager) &&
          normalizeName(line.subordinateName) === normalizeName(subordinate),
      );
      if (existing) {
        existing.confidence = 1;
        existing.isCurrent = true;
        existing.updatedAt = timestamp;
      } else {
        next.reportingLines.push({
          id: createId('line'),
          subordinateName: subordinate,
          managerName: manager,
          relationType: 'reports-to',
          confidence: 1,
          evidenceIds: [],
          isCurrent: true,
          updatedAt: timestamp,
        });
      }
      next.project.updatedAt = timestamp;
      return appendAudit(next, 'talent-updated', `??????? ${subordinate} -> ${manager}`, { view: 'map' });
    });
    setManualLine({ manager: '', subordinate: '' });
  };

  const graphNodes: Node[] = useMemo(
    () =>
      graph.nodes.map((node) => {
        const departmentLabel = node.department ?? node.company ?? '?????';
        const reportCount = Math.max(node.span, node.visibleSpan);
        const noteCount = node.changeCount + (node.averageConfidence < 0.75 ? 1 : 0) + (node.hiddenDirectCount > 0 ? 1 : 0);
        return {
          id: node.id,
          position: { x: node.x, y: node.y },
          data: {
            label: (
              <div
                className={[
                  'flow-node',
                  isReportMode ? 'business-report' : 'business-recruiting',
                  isTree ? 'mindmap' : 'formal',
                  isTree && node.depth === 0 ? 'mindmap-root' : '',
                  isTree && node.depth === 1 ? 'mindmap-branch' : '',
                  isTree && node.depth >= 2 ? 'mindmap-leaf' : '',
                  selectedNodeId === node.id ? 'selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {isTree && (
                  <>
                    <Handle id="source-left" type="source" position={Position.Left} className="mindmap-handle" />
                    <Handle id="source-right" type="source" position={Position.Right} className="mindmap-handle" />
                    <Handle id="target-left" type="target" position={Position.Left} className="mindmap-handle" />
                    <Handle id="target-right" type="target" position={Position.Right} className="mindmap-handle" />
                  </>
                )}
                {isReportMode ? (
                  <>
                    <div className="flow-node-top">
                      <strong>{departmentLabel}</strong>
                      <small>L{node.depth}</small>
                    </div>
                    <span>????{node.label}</span>
                    <em>{reportCount} ?</em>
                    <button
                      type="button"
                      className="node-note-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedNodeId(node.id);
                      }}
                    >
                      ??{noteCount > 0 ? ` ${noteCount}` : ''}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flow-node-top">
                      <strong>{node.label}</strong>
                      <small>{node.levelLabel}</small>
                    </div>
                    <span>{node.title ?? '?????'}</span>
                    <em>{node.department ?? node.company ?? '?????'}</em>
                    <div className="flow-node-meta">
                      <b>{Math.round(node.averageConfidence * 100)}%</b>
                      {node.span > 0 && <b>{node.visibleSpan}/{node.span} ??</b>}
                      {node.hiddenDirectCount > 0 && <b>+{node.hiddenDirectCount} ??</b>}
                    </div>
                  </>
                )}
              </div>
            ),
          },
          type: 'default',
          draggable: editMode,
          sourcePosition: isTree ? (node.mindMapSide === 'left' ? Position.Left : Position.Right) : Position.Bottom,
          targetPosition: isTree
            ? node.mindMapSide === 'left'
              ? Position.Right
              : node.mindMapSide === 'right'
                ? Position.Left
                : Position.Top
            : Position.Top,
        } satisfies Node;
      }),
    [editMode, graph.nodes, isReportMode, isTree, selectedNodeId],
  );
  const [nodes, setNodes] = useState<Node[]>(graphNodes);

  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((edge) => {
        const sourceNode = graph.nodes.find((node) => node.id === edge.source);
        const targetNode = graph.nodes.find((node) => node.id === edge.target);
        const targetSide = targetNode?.mindMapSide === 'left' || targetNode?.mindMapSide === 'right' ? targetNode.mindMapSide : undefined;
        const sourceSide =
          sourceNode?.depth === 0
            ? targetSide
            : sourceNode?.mindMapSide === 'left' || sourceNode?.mindMapSide === 'right'
              ? sourceNode.mindMapSide
              : undefined;
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: isTree && sourceSide ? `source-${sourceSide}` : undefined,
          targetHandle: isTree && targetSide === 'left' ? 'target-right' : isTree && targetSide === 'right' ? 'target-left' : undefined,
          type: isTree ? 'straight' : 'step',
          style: {
            stroke: edge.confidence < 0.72 ? '#d54941' : isTree ? '#1f2329' : '#1677ff',
            strokeWidth: isTree ? 1.05 : 1.35,
            strokeDasharray: edge.confidence < 0.75 || edge.relationType === 'dotted-line' ? '6 5' : undefined,
          },
          className: ['org-edge', isTree ? 'mindmap-edge' : 'formal-edge'].join(' '),
        };
      }),
    [graph.edges, graph.nodes, isTree],
  );

  useEffect(() => setNodes(graphNodes), [graphNodes]);
  useEffect(() => {
    if (selectedNodeId && !graph.nodes.some((node) => node.id === selectedNodeId)) setSelectedNodeId('');
  }, [graph.nodes, selectedNodeId]);

  const onNodesChange = (changes: NodeChange[]) => {
    if (!editMode) return;
    setNodes((current) => applyNodeChanges(changes, current));
  };

  const saveNodePosition = (_: unknown, node: Node) => {
    if (!editMode || String(node.id).startsWith('lane:')) return;
    setState((current) => {
      const next: AppState = structuredClone(current);
      const timestamp = new Date().toISOString();
      const currentLayout = next.canvasLayouts?.[layoutId] ?? { nodes: {}, updatedAt: timestamp };
      next.canvasLayouts = {
        ...(next.canvasLayouts ?? {}),
        [layoutId]: {
          nodes: {
            ...currentLayout.nodes,
            [node.id]: {
              x: Math.round(node.position.x),
              y: Math.round(node.position.y),
              updatedAt: timestamp,
            },
          },
          updatedAt: timestamp,
        },
      };
      next.project.updatedAt = timestamp;
      return next;
    });
  };

  const selectedDepartment = selectedGraphNode?.department ?? selectedGraphNode?.company ?? '?????';
  const selectedRemarks = selectedGraphNode
    ? [
        ...state.changeEvents
          .filter((event) => {
            const samePerson = event.personName && normalizeName(event.personName) === normalizeName(selectedGraphNode.label);
            const sameDepartment = selectedGraphNode.department && event.description.includes(selectedGraphNode.department);
            return samePerson || sameDepartment;
          })
          .slice(0, 5)
          .map((event) => event.description),
        ...(selectedGraphNode.averageConfidence < 0.75 ? ['????????????????'] : []),
        ...(selectedGraphNode.hiddenDirectCount > 0 ? [`??? ${selectedGraphNode.hiddenDirectCount} ??????`] : []),
        ...(selectedGraphNode.span === 0 ? ['??????????'] : []),
      ]
    : [];

  return (
    <section className="map-layout">
      <div className="canvas-command-bar" aria-label="?????">
        <div className="segmented-control" role="group" aria-label="????">
          {([
            ['report', '????'],
            ['recruiting', '????'],
          ] as Array<[OrgBusinessMode, string]>).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={businessMode === mode ? 'active' : ''}
              onClick={() => applyCanvasView(canvasViewForMode(mode, chartStyle))}
            >
              {mode === 'report' ? <BriefcaseBusiness size={16} /> : <Users size={16} />}
              {label}
            </button>
          ))}
        </div>
        <div className="segmented-control" role="group" aria-label="????">
          {([
            ['regular', '?????'],
            ['tree', '???'],
          ] as Array<[OrgChartStyle, string]>).map(([style, label]) => (
            <button
              key={style}
              type="button"
              className={chartStyle === style ? 'active' : ''}
              onClick={() => applyCanvasView(canvasViewForMode(businessMode, style))}
            >
              {style === 'regular' ? <Network size={16} /> : <GitBranch size={16} />}
              {label}
            </button>
          ))}
        </div>
        <div className="canvas-actions">
          {businessMode === 'recruiting' && (
            <>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setFilters({ ...filters, maxDepth: Math.min(filters.maxDepth + 1, 8), visibleLimit: Math.min(filters.visibleLimit + 120, 600) })}
              >
                <Maximize2 size={16} />
                ????
              </button>
              <button type="button" className="secondary-button" onClick={() => setFilters({ ...filters, maxDepth: 2, visibleLimit: 160 })}>
                <RotateCcw size={16} />
                ????
              </button>
            </>
          )}
          <button type="button" className="secondary-button" onClick={saveVisibleLayout} disabled={!editMode}>
            <Save size={16} />
            ????
          </button>
          <button
            type="button"
            className={editMode ? 'secondary-button active-filter' : 'secondary-button'}
            onClick={() => setEditMode((value) => !value)}
          >
            {editMode ? <Lock size={16} /> : <Move size={16} />}
            {editMode ? '????' : '????'}
          </button>
          <button
            type="button"
            className={showManualRepair ? 'secondary-button active-filter' : 'secondary-button'}
            onClick={() => setShowManualRepair((value) => !value)}
          >
            <Users size={16} />
            ????
          </button>
          <button type="button" className="secondary-button" onClick={() => flowInstance?.fitView({ duration: 260 })}>
            <Maximize2 size={16} />
            ????
          </button>
          <button type="button" className="secondary-button" onClick={resetLayout} disabled={savedCount === 0}>
            <RotateCcw size={16} />
            ????
          </button>
        </div>
      </div>

      <div className="map-controls">
        <label>
          ??
          <select value={filters.company} onChange={(event) => setFilters({ ...filters, company: event.target.value })}>
            <option value="">??</option>
            {state.project.companies.map((company) => (
              <option key={company} value={company}>
                {company}
              </option>
            ))}
          </select>
        </label>
        <label>
          ??
          <input value={filters.search} placeholder="??/??/??" onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
        </label>
        <label>
          ???
          <input
            value={filters.focusPersonName}
            placeholder="??"
            onChange={(event) => setFilters({ ...filters, focusPersonName: event.target.value })}
          />
        </label>
        <label>
          ??? {Math.round(filters.minConfidence * 100)}%
          <input
            type="range"
            min="0"
            max="0.95"
            step="0.05"
            value={filters.minConfidence}
            onChange={(event) => setFilters({ ...filters, minConfidence: Number(event.target.value) })}
          />
        </label>
        <label>
          ????
          <input
            type="number"
            min="30"
            max="600"
            value={filters.visibleLimit}
            onChange={(event) => setFilters({ ...filters, visibleLimit: Number(event.target.value) })}
          />
        </label>
        <label>
          ??
          <input
            type="number"
            min="1"
            max="8"
            value={filters.maxDepth}
            onChange={(event) => setFilters({ ...filters, maxDepth: Number(event.target.value) })}
          />
        </label>
      </div>

      {showManualRepair && (
        <section className="tool-panel manual-repair-panel">
          <div className="manual-repair-grid">
            <div>
              <h3>??/????</h3>
              <div className="candidate-fields">
                <Field label="??" value={manualPerson.name} onChange={(value) => setManualPerson((current) => ({ ...current, name: value }))} />
                <Field label="??" value={manualPerson.title} onChange={(value) => setManualPerson((current) => ({ ...current, title: value }))} />
                <Field label="??" value={manualPerson.department} onChange={(value) => setManualPerson((current) => ({ ...current, department: value }))} />
                <Field label="??" value={manualPerson.company} onChange={(value) => setManualPerson((current) => ({ ...current, company: value }))} />
              </div>
              <button type="button" className="primary-button" onClick={upsertManualPerson}>
                ????
              </button>
            </div>
            <div>
              <h3>?????</h3>
              <div className="candidate-fields compact-fields">
                <Field label="??" value={manualLine.manager} onChange={(value) => setManualLine((current) => ({ ...current, manager: value }))} />
                <Field label="??" value={manualLine.subordinate} onChange={(value) => setManualLine((current) => ({ ...current, subordinate: value }))} />
              </div>
              <button type="button" className="primary-button" onClick={addManualLine}>
                ?????
              </button>
            </div>
          </div>
        </section>
      )}

      {graph.truncated && <div className="inline-warning">?????? {graph.totalBeforeLimit} ?????? {filters.visibleLimit} ????</div>}

      <div className={isTree ? 'flow-surface mindmap-surface' : 'flow-surface formal-surface'}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: isTree ? 0.12 : 0.025, includeHiddenNodes: false }}
          minZoom={isTree ? 0.05 : 0.14}
          maxZoom={1.6}
          nodesDraggable={editMode}
          elementsSelectable={editMode}
          panOnDrag={!editMode}
          selectionOnDrag={editMode}
          onInit={setFlowInstance}
          onNodesChange={onNodesChange}
          onNodeDragStop={saveNodePosition}
          onNodeClick={(_, node) => {
            if (isReportMode) {
              setSelectedNodeId(node.id);
              return;
            }
            const graphNode = graph.nodes.find((item) => item.id === node.id);
            if (graphNode && !editMode) setFilters({ ...filters, focusPersonName: graphNode.label });
          }}
        >
          {businessMode === 'recruiting' && <MiniMap pannable zoomable />}
          <Controls />
        </ReactFlow>
      </div>

      {isReportMode && selectedGraphNode && (
        <section className="tool-panel node-detail-panel">
          <div className="section-heading">
            <h2>{selectedDepartment}</h2>
            <button type="button" className="icon-button" onClick={() => setSelectedNodeId('')} aria-label="????">
              <X size={16} />
            </button>
          </div>
          <div className="node-detail-grid">
            <span>
              <strong>???</strong>
              {selectedGraphNode.label}
            </span>
            <span>
              <strong>????</strong>
              {Math.max(selectedGraphNode.span, selectedGraphNode.visibleSpan)}
            </span>
            <span>
              <strong>??</strong>
              L{selectedGraphNode.depth}
            </span>
          </div>
          <div className="node-remarks">
            {(selectedRemarks.length > 0 ? selectedRemarks : ['????']).map((remark, index) => (
              <p key={`${remark}-${index}`}>{remark}</p>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}

function ExportView({
  state,
  filters,
  password,
  setPassword,
  exportPackage,
  importPackage,
  exportPng,
  exportPptx,
}: {
  state: AppState;
  filters: OrgMapFilters;
  password: string;
  setPassword: (value: string) => void;
  exportPackage: () => void;
  importPackage: (file: File | undefined) => void;
  exportPng: () => void;
  exportPptx: () => void;
}) {
  const previewGraph = useMemo(() => buildOrgGraph(state, filters), [state, filters]);

  return (
    <section className="view-stack">
      <div className="export-grid">
        <section className="tool-panel">
          <div className="section-heading">
            <h2>??</h2>
            <span className="small-badge">{canvasViewLabel(state.project.settings.activeCanvasView)}</span>
          </div>
          <div className="button-row">
            <button type="button" className="primary-button" onClick={exportPptx}>
              <Download size={16} />
              ?? PPTX
            </button>
            <button type="button" className="secondary-button" onClick={exportPng}>
              <ImageDown size={16} />
              ?? PNG
            </button>
          </div>
          <div className="export-preview">
            <div className="preview-meta">
              {previewGraph.nodes.length} ??? ? {previewGraph.edges.length} ??
            </div>
          </div>
        </section>

        <section className="tool-panel">
          <div className="section-heading">
            <h2>???</h2>
            <span className="small-badge">.mapping.zip</span>
          </div>
          <label className="field wide">
            <span>??</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="?? 6 ???" />
          </label>
          <div className="button-row">
            <button type="button" className="primary-button" onClick={exportPackage}>
              <ShieldCheck size={16} />
              ?????
            </button>
            <label className="file-button">
              <Upload size={16} />
              ?????
              <input type="file" accept=".zip,.mapping.zip" onChange={(event) => void importPackage(event.target.files?.[0])} />
            </label>
          </div>
        </section>
      </div>
    </section>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}

export default App;
