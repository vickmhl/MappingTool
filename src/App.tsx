import {
  BriefcaseBusiness,
  Check,
  Download,
  GitBranch,
  ImageDown,
  Inbox,
  Lock,
  Maximize2,
  MoreHorizontal,
  Move,
  Network,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
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
import { clearPersistedState, loadPersistedState, persistState } from './lib/idb';
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
  OrgChartExportFormat,
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
  { key: 'import', label: '瀵煎叆', icon: Inbox },
  { key: 'review', label: '纭', icon: Check },
  { key: 'map', label: '缁勭粐鍥?, icon: Network },
  { key: 'export', label: '瀵煎嚭', icon: Download },
];

const kindLabel: Record<CandidateKind, string> = {
  person: '浜哄憳',
  orgUnit: '缁勭粐',
  roleAssignment: '浠昏亴',
  reportingLine: '姹囨姤绾?,
  changeEvent: '鍙樻洿',
};

const defaultFilters: OrgMapFilters = {
  company: '',
  search: '',
  focusPersonName: '',
  minConfidence: 0.72,
  visibleLimit: 28,
  maxDepth: 2,
};

const canvasPresets: Record<
  CanvasViewKey,
  {
    template: AppState['project']['settings']['reportTemplate'];
    chartMode: OrgChartMode;
    filters: Pick<OrgMapFilters, 'minConfidence' | 'visibleLimit' | 'maxDepth'>;
  }
> = {
  executive: { template: 'executive', chartMode: 'formal', filters: { minConfidence: 0.72, visibleLimit: 28, maxDepth: 2 } },
  mindmap: { template: 'executive', chartMode: 'formal', filters: { minConfidence: 0.72, visibleLimit: 28, maxDepth: 2 } },
  recruiting: { template: 'recruiting', chartMode: 'explore', filters: { minConfidence: 0.55, visibleLimit: 72, maxDepth: 2 } },
  detail: { template: 'recruiting', chartMode: 'formal', filters: { minConfidence: 0.55, visibleLimit: 84, maxDepth: 2 } },
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
    executive: '姹囨姤妯″紡 路 甯歌鏋舵瀯鍥?,
    mindmap: '姹囨姤妯″紡 路 鏍戠姸鍥?,
    recruiting: '鎷涜仒妯″紡 路 甯歌鏋舵瀯鍥?,
    detail: '鎷涜仒妯″紡 路 鏍戠姸鍥?,
  }[view];
}

const DEMO_LAYOUT_STORAGE_KEY = 'mapping-tool-demo-layouts-v3';
const LEGACY_DEMO_LAYOUT_STORAGE_KEYS = ['mapping-tool-demo-layouts-v1', 'mapping-tool-demo-layouts-v2'];

function sanitizeDemoCanvasLayouts(layouts: AppState['canvasLayouts'] | undefined): AppState['canvasLayouts'] | undefined {
  if (!layouts || typeof layouts !== 'object') return undefined;
  const allowedLayoutIds = new Set([
    layoutIdForCanvasView('executive'),
    layoutIdForCanvasView('mindmap'),
    layoutIdForCanvasView('recruiting'),
    layoutIdForCanvasView('detail'),
  ]);
  const nextLayouts: AppState['canvasLayouts'] = {};

  for (const [layoutId, layout] of Object.entries(layouts)) {
    if (!allowedLayoutIds.has(layoutId) || !layout || typeof layout !== 'object' || !layout.nodes) continue;
    nextLayouts[layoutId] = layout;
  }

  return Object.keys(nextLayouts).length > 0 ? nextLayouts : undefined;
}

function loadDemoCanvasLayouts(): AppState['canvasLayouts'] | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    for (const legacyKey of LEGACY_DEMO_LAYOUT_STORAGE_KEYS) {
      window.localStorage.removeItem(legacyKey);
    }
    const raw = window.localStorage.getItem(DEMO_LAYOUT_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    return sanitizeDemoCanvasLayouts(parsed as AppState['canvasLayouts']);
  } catch {
    return undefined;
  }
}

function persistDemoCanvasLayouts(layouts: AppState['canvasLayouts'] | undefined): void {
  if (typeof window === 'undefined') return;
  try {
    if (!layouts || Object.keys(layouts).length === 0) {
      window.localStorage.removeItem(DEMO_LAYOUT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(DEMO_LAYOUT_STORAGE_KEY, JSON.stringify(layouts));
  } catch {
    // Demo layouts are a convenience cache; failing to save them must not block editing.
  }
}

function isVirtualDemoState(state: AppState): boolean {
  return (
    state.sources.length > 0 &&
    state.sources.every((source) => source.hash === 'virtual-map-business-sample' || source.fileName === 'virtual-map-business-sample.txt') &&
    state.people.length > 0
  );
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
  const demoSession = useRef(false);

  useEffect(() => {
    loadPersistedState()
      .then((persisted) => {
        if (!persisted) return;
        const hydrated = ensureStateShape(persisted);
        if (isVirtualDemoState(hydrated)) {
          demoSession.current = false;
          void clearPersistedState();
          return;
        }
        setState(hydrated);
        setFilters((current) => ({
          ...current,
          visibleLimit: hydrated.project.settings.defaultVisibleNodeLimit,
        }));
      })
      .catch((error) => setToast(`鏈湴搴撹鍙栧け璐ワ細${error instanceof Error ? error.message : String(error)}`))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (demoSession.current || isVirtualDemoState(state)) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      persistState(state).catch((error) =>
        setToast(`鏈湴淇濆瓨澶辫触锛?{error instanceof Error ? error.message : String(error)}`),
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
          appendAudit(addImportResult(current, result), 'import', `瀵煎叆 ${file.name}`, {
            entityCount: result.candidates.length,
            view: 'import',
            sourceName: file.name,
          }),
        );
      } catch (error) {
        setToast(`${file.name} 瀵煎叆澶辫触锛?{error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (candidateCount > 0) {
      demoSession.current = false;
      setToast(`宸茬敓鎴?${candidateCount} 鏉″€欓€塦);
      setOpenManualRepair(false);
      setActiveView('review');
    } else {
      setToast(enableOcr ? '鏈瘑鍒埌鍊欓€夛紝璇锋墜鍔ㄨˉ鍏? : '鏈瘑鍒埌鍊欓€夛紝鍙紑鍚?OCR 鍚庨噸璇曪紝鎴栨墜鍔ㄨˉ鍏?);
      setOpenManualRepair(true);
      setActiveView('map');
    }
  }

  function loadMapBusinessDemo(): void {
    demoSession.current = true;
    const demo = createMapBusinessDemoState();
    demo.project.settings.activeCanvasView = 'executive';
    demo.project.settings.orgChartMode = 'formal';
    demo.project.settings.defaultVisibleNodeLimit = canvasPresets.executive.filters.visibleLimit;
    demo.project.settings.reportTemplate = 'executive';
    demo.canvasLayouts = loadDemoCanvasLayouts();
    setState(appendAudit(demo, 'demo-loaded', '杞藉叆澶ц妯″湴鍥句笟鍔¤櫄鎷熸牱渚?, { entityCount: demo.people.length, view: 'map' }));
    setFilters({ ...defaultFilters, ...canvasPresets.executive.filters });
    setOpenManualRepair(false);
    setActiveView('map');
    setToast('宸茶浇鍏ヨ櫄鎷熸紨绀篋emo');
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
        `${status === 'accepted' ? '纭' : '蹇界暐'} ${selectedPendingCount} 鏉″€欓€塦,
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
      setState((current) => appendAudit(current, 'export', '瀵煎嚭鍔犲瘑椤圭洰鍖?, { view: 'export' }));
      setToast('宸插鍑哄姞瀵嗛」鐩寘');
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }

  async function importPackage(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const imported = ensureStateShape(await importEncryptedProjectPackage(file, password));
      setState(appendAudit(imported, 'project-imported', `瀵煎叆椤圭洰鍖?${file.name}`, { view: 'export', sourceName: file.name }));
      setActiveView('map');
      setToast('椤圭洰鍖呭凡瀵煎叆');
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
          downloadBlob(blob, `${state.project.name}-${state.project.settings.orgChartExportFormat}.png`);
          setState((current) => appendAudit(current, 'export', '瀵煎嚭缁勭粐鍥?PNG', { entityCount: graph.nodes.length, view: 'export' }));
        });
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }

  async function exportPptx(): Promise<void> {
    try {
      await exportReportPptx(state, filters);
      setState((current) => appendAudit(current, 'export', '瀵煎嚭 PPTX', { entityCount: graph.nodes.length, view: 'export' }));
      setToast('PPTX 宸茬敓鎴?);
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }

  function setExportFormat(format: OrgChartExportFormat): void {
    setState((current) => ({
      ...current,
      project: {
        ...current.project,
        updatedAt: new Date().toISOString(),
        settings: {
          ...current.project.settings,
          orgChartExportFormat: format,
        },
      },
    }));
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">
            <GitBranch size={20} />
          </div>
          <div>
            <strong>Mapping 宸ュ叿</strong>
            <span>鏈湴缁勭粐鍥剧敓鎴愬櫒</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="涓诲鑸?>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={activeView === item.key ? 'nav-item active' : 'nav-item'}
                type="button"
                aria-label={item.label}
                title={item.label}
                onClick={() => setActiveView(item.key)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

      </aside>

      <main className="workspace">
        {toast && (
          <div className="toast" role="status">
            <span>{toast}</span>
            <button type="button" onClick={() => setToast('')} aria-label="鍏抽棴鎻愮ず">
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
            onImport={() => setActiveView('import')}
            loadMapBusinessDemo={loadMapBusinessDemo}
          />
        )}

        {activeView === 'export' && (
          <ExportView
            state={state}
            filters={filters}
            password={password}
            setPassword={setPassword}
            setExportFormat={setExportFormat}
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
      <div className="import-entry-grid import-entry-compact">
        <section className="entry-card upload-card">
          <div className="entry-icon">
            <Upload size={24} />
          </div>
          <h2>涓婁紶璧勬枡</h2>
          <label className="file-button large-file-button">
            <Inbox size={16} />
            閫夋嫨 TXT / PPTX / 鍥剧墖
            <input
              type="file"
              multiple
              accept=".txt,.md,.pptx,.png,.jpg,.jpeg,.webp,.bmp"
              onChange={(event) => void onFiles(event.target.files)}
              aria-label="閫夋嫨璧勬枡鏂囦欢"
            />
          </label>
          <label className="toggle-line">
            <input type="checkbox" checked={enableOcr} onChange={(event) => setEnableOcr(event.target.checked)} />
            <span>鏈湴 OCR</span>
          </label>
        </section>

        <section className="entry-card demo-card">
          <div className="entry-icon">
            <Network size={24} />
          </div>
          <h2>铏氭嫙婕旂ずDemo</h2>
          <button type="button" className="primary-button demo-entry-button" onClick={loadMapBusinessDemo}>
            鎵撳紑婕旂ず缁勭粐鍥?          </button>
        </section>
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
          <h2>纭璇嗗埆缁撴灉</h2>
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
          鍏ㄩ儴
        </button>
        <button type="button" className="primary-button" onClick={() => onAccept(allIds)} disabled={!allIds.length}>
          <Check size={16} />
          鍏ㄩ儴纭
        </button>
        <button type="button" className="secondary-button" onClick={() => onReject(allIds)} disabled={!allIds.length}>
          <X size={16} />
          鍏ㄩ儴蹇界暐
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
                纭
              </button>
              <button type="button" className="secondary-button" onClick={() => onReject([candidate.id])}>
                蹇界暐
              </button>
            </div>
          </article>
        ))}
        {visibleCandidates.length === 0 && <EmptyState title="娌℃湁寰呯‘璁ゅ€欓€? body="涓婁紶璧勬枡鍚庝細鍦ㄨ繖閲岀‘璁や汉鍛樸€佺粍缁囧拰姹囨姤绾裤€? />}
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
      { key: 'name', label: '濮撳悕', value: data.name },
      { key: 'company', label: '鍏徃', value: data.company },
      { key: 'title', label: '宀椾綅', value: data.title },
      { key: 'department', label: '閮ㄩ棬', value: data.department },
    );
  }
  if (candidate.kind === 'orgUnit') {
    const data = payload as OrgUnitCandidatePayload;
    fields.push(
      { key: 'name', label: '缁勭粐', value: data.name },
      { key: 'company', label: '鍏徃', value: data.company },
      { key: 'function', label: '鑱岃兘', value: data.function },
      { key: 'parentName', label: '涓婄骇缁勭粐', value: data.parentName },
    );
  }
  if (candidate.kind === 'roleAssignment') {
    const data = payload as RoleCandidatePayload;
    fields.push(
      { key: 'personName', label: '濮撳悕', value: data.personName },
      { key: 'title', label: '宀椾綅', value: data.title },
      { key: 'orgUnitName', label: '閮ㄩ棬', value: data.orgUnitName },
      { key: 'company', label: '鍏徃', value: data.company },
    );
  }
  if (candidate.kind === 'reportingLine') {
    const data = payload as ReportingCandidatePayload;
    fields.push(
      { key: 'managerName', label: '涓婄骇', value: data.managerName },
      { key: 'subordinateName', label: '涓嬬骇', value: data.subordinateName },
      { key: 'relationType', label: '鍏崇郴', value: data.relationType },
    );
  }
  if (candidate.kind === 'changeEvent') {
    const data = payload as ChangeCandidatePayload;
    fields.push(
      { key: 'personName', label: '浜哄憳', value: data.personName },
      { key: 'type', label: '绫诲瀷', value: data.type },
      { key: 'description', label: '鎻忚堪', value: data.description },
      { key: 'date', label: '鏃ユ湡', value: data.date },
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
  onImport,
  loadMapBusinessDemo,
}: {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState>>;
  filters: OrgMapFilters;
  setFilters: (filters: OrgMapFilters) => void;
  graph: ReturnType<typeof buildOrgGraph>;
  openManualRepair: boolean;
  onManualRepairOpened: () => void;
  onImport: () => void;
  loadMapBusinessDemo: () => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [showManualRepair, setShowManualRepair] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
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
  const hasOrgData = state.people.length > 0 || state.reportingLines.length > 0 || state.orgUnits.length > 0;
  const activeFilterCount = [
    filters.company,
    filters.search.trim(),
    filters.minConfidence !== canvasPresets[activeView].filters.minConfidence,
    filters.visibleLimit !== canvasPresets[activeView].filters.visibleLimit,
    filters.maxDepth !== canvasPresets[activeView].filters.maxDepth,
  ].filter(Boolean).length;

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
      if (isVirtualDemoState(next)) persistDemoCanvasLayouts(next.canvasLayouts);
      next.project.updatedAt = timestamp;
      return appendAudit(next, 'canvas-layout-saved', `淇濆瓨${canvasViewLabel(activeView)}鐢诲竷`, {
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
      if (isVirtualDemoState(next)) persistDemoCanvasLayouts(next.canvasLayouts);
      next.project.updatedAt = new Date().toISOString();
      return appendAudit(next, 'canvas-layout-reset', `閲嶇疆${canvasViewLabel(activeView)}鐢诲竷`, { view: 'map' });
    });
  };

  const upsertManualPerson = () => {
    const name = manualPerson.name.trim();
    if (!name) return;
    const timestamp = new Date().toISOString();
    setState((current) => {
      const next: AppState = structuredClone(current);
      const existing = next.people.find((person) => normalizeName(person.name) === normalizeName(name));
      const company = manualPerson.company.trim() || existing?.company || next.project.companies[0] || '寰呯‘璁ゅ叕鍙?;
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
          tags: ['鎵嬪姩琛ュ綍'],
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
      return appendAudit(next, 'talent-updated', `鎵嬪姩琛ュ綍浜哄憳 ${name}`, { view: 'map' });
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
            company: next.project.companies[0] || '寰呯‘璁ゅ叕鍙?,
            tags: ['鎵嬪姩琛ュ綍'],
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
      return appendAudit(next, 'talent-updated', `鎵嬪姩鏂板姹囨姤绾?${subordinate} -> ${manager}`, { view: 'map' });
    });
    setManualLine({ manager: '', subordinate: '' });
  };

  const graphNodes: Node[] = useMemo(
    () =>
      graph.nodes.map((node) => {
        const departmentLabel = node.department ?? node.company ?? '鏈綊灞為儴闂?;
        const reportCount = Math.max(node.descendantCount, node.span, node.visibleSpan);
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
                  isReportMode ? `report-depth-${Math.min(node.depth, 3)}` : '',
                  isReportMode && node.changeCount > 0 ? 'has-change-note' : '',
                  isReportMode && node.hiddenDirectCount > 0 ? 'has-hidden-team' : '',
                  isTree && node.mindMapSide ? `mindmap-${node.mindMapSide}` : '',
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
                      <small>{node.depth === 0 ? '闆嗗洟' : `L${node.depth}`}</small>
                    </div>
                    <span>涓€鍙蜂綅 {node.label}</span>
                    <em>{node.title ?? '璐熻矗浜哄緟纭'}</em>
                    <div className="report-node-metrics">
                      <b>{reportCount} 浜?/b>
                      <i>{node.visibleSpan} 鐩村睘</i>
                      {node.hiddenDirectCount > 0 && <i>+{node.hiddenDirectCount} 鏀惰捣</i>}
                    </div>
                    <button
                      type="button"
                      className="node-note-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedNodeId(node.id);
                      }}
                    >
                      鏌ョ湅澶囨敞{noteCount > 0 ? ` ${noteCount}` : ''}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flow-node-top">
                      <strong>{node.label}</strong>
                      <small>{node.levelLabel}</small>
                    </div>
                    <span>{node.title ?? '宀椾綅寰呯‘璁?}</span>
                    <em>{node.department ?? node.company ?? '缁勭粐寰呯‘璁?}</em>
                    <div className="flow-node-meta">
                      {node.isTalent && <b className="talent-pill">閲嶇偣</b>}
                      {node.span > 0 && <b>{node.visibleSpan}/{node.span} 涓嬪睘</b>}
                      {node.hiddenDirectCount > 0 && <b>+{node.hiddenDirectCount} 鏀惰捣</b>}
                      {node.changeCount > 0 && <b>鍙樻洿 {node.changeCount}</b>}
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
            stroke: edge.confidence < 0.72 ? '#d92d20' : isTree ? '#7d8da1' : '#8da2bf',
            strokeWidth: isTree ? 1.35 : 1.7,
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

  useEffect(() => {
    if (!flowInstance || nodes.length === 0 || editMode) return;
    const timer = window.setTimeout(() => {
      if (savedCount > 0) {
        void flowInstance.fitView({ duration: 260, padding: isTree ? 0.12 : 0.08, includeHiddenNodes: false });
        return;
      }

      if (isTree) {
        void flowInstance.fitView({ duration: 260, padding: 0.12, includeHiddenNodes: false });
        return;
      }

      if (isReportMode) {
        void flowInstance.fitView({ duration: 260, padding: 0.12, includeHiddenNodes: false });
        return;
      }

      const rootGraphNode = graph.nodes.find((node) => node.depth === 0);
      if (!rootGraphNode) {
        void flowInstance.fitView({ duration: 260, padding: 0.08, includeHiddenNodes: false });
        return;
      }

      const zoom = 0.7;
      void flowInstance.setCenter(rootGraphNode.x + 120, rootGraphNode.y + (isReportMode ? 210 : 260), {
        zoom,
        duration: 260,
      });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [editMode, flowInstance, graph.nodes, isReportMode, isTree, nodes.length, savedCount]);

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
      if (isVirtualDemoState(next)) persistDemoCanvasLayouts(next.canvasLayouts);
      next.project.updatedAt = timestamp;
      return next;
    });
  };

  const selectedDepartment = selectedGraphNode?.department ?? selectedGraphNode?.company ?? '鏈綊灞為儴闂?;
  const selectedPersonRecord = selectedGraphNode
    ? state.people.find((person) => normalizeName(person.name) === normalizeName(selectedGraphNode.label))
    : undefined;
  const selectedManager = selectedGraphNode
    ? state.reportingLines.find(
        (line) =>
          line.isCurrent &&
          normalizeName(line.subordinateName) === normalizeName(selectedGraphNode.label),
      )?.managerName
    : undefined;
  const selectedDirectReports = selectedGraphNode
    ? state.reportingLines
        .filter(
          (line) =>
            line.isCurrent &&
            normalizeName(line.managerName) === normalizeName(selectedGraphNode.label),
        )
        .map((line) => line.subordinateName)
        .slice(0, 8)
    : [];
  const selectedRemarks = selectedGraphNode
    ? [
        ...(selectedPersonRecord?.sensitiveNote ? [selectedPersonRecord.sensitiveNote] : []),
        ...state.changeEvents
          .filter((event) => {
            const samePerson = event.personName && normalizeName(event.personName) === normalizeName(selectedGraphNode.label);
            const sameDepartment = selectedGraphNode.department && event.description.includes(selectedGraphNode.department);
            return samePerson || sameDepartment;
          })
          .slice(0, 6)
          .map((event) => event.description),
        ...(selectedGraphNode.averageConfidence < 0.75 ? ['瀛樺湪浣庣疆淇″害鏉ユ簮锛屾寮忔眹鎶ュ墠寤鸿澶嶆牳銆?] : []),
        ...(selectedGraphNode.hiddenDirectCount > 0 ? [`褰撳墠宸叉敹璧?${selectedGraphNode.hiddenDirectCount} 涓笅閽讳汉鍛樸€俙] : []),
        ...(selectedGraphNode.span === 0 ? ['鏆傛湭璇嗗埆鍒扮洿灞炰笅灞炪€?] : []),
      ]
    : [];

  return (
    <section className="map-layout">
      {!hasOrgData ? (
        <section className="empty-map-panel">
          <Network size={30} />
          <h2>杩樻病鏈夌粍缁囧浘</h2>
          <div className="empty-map-actions">
            <button type="button" className="primary-button" onClick={onImport}>
              <Upload size={16} />
              涓婁紶璧勬枡
            </button>
            <button type="button" className="secondary-button" onClick={loadMapBusinessDemo}>
              <Network size={16} />
              铏氭嫙婕旂ずDemo
            </button>
          </div>
        </section>
      ) : (
        <>
      <div className="canvas-command-bar" aria-label="鐢诲竷宸ュ叿鏍?>
        <div className="segmented-control" role="group" aria-label="涓氬姟妯″紡">
          {([
            ['report', '姹囨姤妯″紡'],
            ['recruiting', '鎷涜仒妯″紡'],
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
        <div className="segmented-control" role="group" aria-label="鍥惧舰鏍峰紡">
          {([
            ['regular', '甯歌鏋舵瀯鍥?],
            ['tree', '鏍戠姸鍥?],
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
        <label className="canvas-search-field">
          <Search size={16} />
          <input
            value={filters.search}
            placeholder="鎼滅储濮撳悕 / 宀椾綅 / 閮ㄩ棬"
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
        </label>
        <div className="canvas-actions primary-canvas-actions">
          <button
            type="button"
            className={showFilters || activeFilterCount > 0 ? 'secondary-button active-filter' : 'secondary-button'}
            onClick={() => setShowFilters((value) => !value)}
          >
            <SlidersHorizontal size={16} />
            {showFilters ? '鏀惰捣绛涢€? : activeFilterCount > 0 ? `绛涢€?${activeFilterCount}` : '绛涢€?}
          </button>
          {businessMode === 'recruiting' && (
            <>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setFilters({
                    ...filters,
                    maxDepth: Math.min(filters.maxDepth + 1, 8),
                    visibleLimit: Math.min(filters.visibleLimit + 36, 240),
                  })
                }
              >
                <Maximize2 size={16} />
                灞曞紑鏇村
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setFilters({
                    ...filters,
                    maxDepth: canvasPresets[activeView].filters.maxDepth,
                    visibleLimit: canvasPresets[activeView].filters.visibleLimit,
                    focusPersonName: '',
                  })
                }
              >
                <RotateCcw size={16} />
                鎶樺彔閮ㄩ棬
              </button>
            </>
          )}
          <button type="button" className="secondary-button" onClick={() => flowInstance?.fitView({ duration: 260 })}>
            <Maximize2 size={16} />
            閫傞厤鐢诲竷
          </button>
          <button
            type="button"
            className={editMode ? 'secondary-button active-filter' : 'secondary-button'}
            onClick={() => setEditMode((value) => !value)}
          >
            {editMode ? <Lock size={16} /> : <Move size={16} />}
            {editMode ? '缁撴潫缂栬緫' : '缂栬緫甯冨眬'}
          </button>
          {editMode && (
            <button type="button" className="secondary-button" onClick={saveVisibleLayout}>
              <Save size={16} />
              淇濆瓨甯冨眬
            </button>
          )}
          <details className="canvas-more-actions">
            <summary>
              <MoreHorizontal size={16} />
              鏇村
            </summary>
            <div>
              <button
                type="button"
                className={showManualRepair ? 'secondary-button active-filter' : 'secondary-button'}
                onClick={() => setShowManualRepair((value) => !value)}
              >
                <Users size={16} />
                鎵嬪姩琛ュ厖
              </button>
              <button
                type="button"
                className={showAdvancedFilters ? 'secondary-button active-filter' : 'secondary-button'}
                onClick={() => setShowAdvancedFilters((value) => !value)}
              >
                <SlidersHorizontal size={16} />
                {showAdvancedFilters ? '鏀惰捣楂樼骇' : '楂樼骇绛涢€?}
              </button>
              <button type="button" className="secondary-button" onClick={resetLayout} disabled={savedCount === 0}>
                <RotateCcw size={16} />
                閲嶆柊甯冨眬
              </button>
            </div>
          </details>
        </div>
      </div>

      {showFilters && (
        <div className="map-controls primary-map-controls">
          <label>
            鍏徃
            <select value={filters.company} onChange={(event) => setFilters({ ...filters, company: event.target.value })}>
              <option value="">鍏ㄩ儴</option>
              {state.project.companies.map((company) => (
                <option key={company} value={company}>
                  {company}
                </option>
              ))}
            </select>
          </label>
          <label>
            缃俊搴?{Math.round(filters.minConfidence * 100)}%
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
            鑺傜偣涓婇檺
            <input
              type="number"
              min="20"
              max="600"
              value={filters.visibleLimit}
              onChange={(event) => setFilters({ ...filters, visibleLimit: Number(event.target.value) })}
            />
          </label>
          <label>
            灞傜骇
            <input
              type="number"
              min="1"
              max="8"
              value={filters.maxDepth}
              onChange={(event) => setFilters({ ...filters, maxDepth: Number(event.target.value) })}
            />
          </label>
        </div>
      )}

      {showFilters && showAdvancedFilters && (
        <div className="map-controls advanced-map-controls">
          <label>
            璐熻矗浜鸿仛鐒?            <input
              value={filters.focusPersonName}
              placeholder="杈撳叆濮撳悕鑱氱劍涓婁笅绾ч摼璺?
              onChange={(event) => setFilters({ ...filters, focusPersonName: event.target.value })}
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setFilters({ ...canvasPresets[activeView].filters, company: '', search: '', focusPersonName: '' })}
          >
            <RotateCcw size={16} />
            閲嶇疆绛涢€?          </button>
        </div>
      )}

      {showManualRepair && (
        <section className="tool-panel manual-repair-panel">
          <div className="manual-repair-grid">
            <div>
              <h3>鏂板/鏇存柊浜哄憳</h3>
              <div className="candidate-fields">
                <Field label="濮撳悕" value={manualPerson.name} onChange={(value) => setManualPerson((current) => ({ ...current, name: value }))} />
                <Field label="宀椾綅" value={manualPerson.title} onChange={(value) => setManualPerson((current) => ({ ...current, title: value }))} />
                <Field label="閮ㄩ棬" value={manualPerson.department} onChange={(value) => setManualPerson((current) => ({ ...current, department: value }))} />
                <Field label="鍏徃" value={manualPerson.company} onChange={(value) => setManualPerson((current) => ({ ...current, company: value }))} />
              </div>
              <button type="button" className="primary-button" onClick={upsertManualPerson}>
                淇濆瓨浜哄憳
              </button>
            </div>
            <div>
              <h3>鏂板姹囨姤绾?/h3>
              <div className="candidate-fields compact-fields">
                <Field label="涓婄骇" value={manualLine.manager} onChange={(value) => setManualLine((current) => ({ ...current, manager: value }))} />
                <Field label="涓嬬骇" value={manualLine.subordinate} onChange={(value) => setManualLine((current) => ({ ...current, subordinate: value }))} />
              </div>
              <button type="button" className="primary-button" onClick={addManualLine}>
                杩炴帴涓婁笅绾?              </button>
            </div>
          </div>
        </section>
      )}

      {graph.truncated && <div className="inline-warning">褰撳墠绛涢€夊懡涓?{graph.totalBeforeLimit} 浜猴紝浠呮覆鏌撳墠 {filters.visibleLimit} 涓妭鐐广€?/div>}

      <div className={selectedGraphNode ? 'map-canvas-shell has-inspector' : 'map-canvas-shell'}>
        <div className={isTree ? 'flow-surface mindmap-surface' : 'flow-surface formal-surface'}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            fitViewOptions={{ padding: isTree ? 0.12 : 0.08, includeHiddenNodes: false }}
            minZoom={isTree ? 0.06 : 0.22}
            maxZoom={1.6}
            nodesDraggable={editMode}
            elementsSelectable={editMode}
            panOnDrag={!editMode}
            selectionOnDrag={editMode}
            onInit={setFlowInstance}
            onNodesChange={onNodesChange}
            onNodeDragStop={saveNodePosition}
            onPaneClick={() => setSelectedNodeId('')}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
              const graphNode = graph.nodes.find((item) => item.id === node.id);
              if (graphNode && businessMode === 'recruiting' && !editMode) {
                setFilters({ ...filters, focusPersonName: graphNode.label });
              }
            }}
          >
            {businessMode === 'recruiting' && <MiniMap pannable zoomable />}
            <Controls />
          </ReactFlow>
        </div>

        {selectedGraphNode && (
          <aside className="org-inspector">
            <div className="org-inspector-head">
              <div>
                <span>{selectedDepartment}</span>
                <h2>{selectedGraphNode.label}</h2>
                <p>{selectedGraphNode.title ?? '宀椾綅寰呯‘璁?}</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setSelectedNodeId('')} aria-label="鍏抽棴璇︽儏">
                <X size={16} />
              </button>
            </div>

            <div className="org-inspector-grid">
              <span>
                <strong>灞傜骇</strong>
                L{selectedGraphNode.depth}
              </span>
              <span>
                <strong>鍥㈤槦瑙勬ā</strong>
                {Math.max(selectedGraphNode.descendantCount, selectedGraphNode.span, selectedGraphNode.visibleSpan)}
              </span>
              <span>
                <strong>鐩村睘</strong>
                {selectedGraphNode.visibleSpan}
              </span>
              <span>
                <strong>涓婄骇</strong>
                {selectedManager ?? '椤跺眰璐熻矗浜?}
              </span>
              <span>
                <strong>璇佹嵁</strong>
                {selectedPersonRecord?.evidenceIds.length ?? selectedGraphNode.evidenceCount}
              </span>
              <span>
                <strong>鏇存柊</strong>
                {formatDate(selectedGraphNode.updatedAt)}
              </span>
            </div>

            {selectedDirectReports.length > 0 && (
              <div className="org-inspector-section">
                <h3>鐩村睘鍥㈤槦</h3>
                <div className="org-chip-grid">
                  {selectedDirectReports.map((name) => (
                    <span key={name}>{name}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="org-inspector-section">
              <h3>澶囨敞涓庡彉鏇?/h3>
              <div className="node-remarks">
                {(selectedRemarks.length > 0 ? selectedRemarks : ['鏆傛棤澶囨敞']).map((remark, index) => (
                  <p key={`${remark}-${index}`}>{remark}</p>
                ))}
              </div>
            </div>
          </aside>
        )}
      </div>
        </>
      )}
    </section>
  );
}

function ExportView({
  state,
  filters,
  password,
  setPassword,
  setExportFormat,
  exportPackage,
  importPackage,
  exportPng,
  exportPptx,
}: {
  state: AppState;
  filters: OrgMapFilters;
  password: string;
  setPassword: (value: string) => void;
  setExportFormat: (format: OrgChartExportFormat) => void;
  exportPackage: () => void;
  importPackage: (file: File | undefined) => void;
  exportPng: () => void;
  exportPptx: () => void;
}) {
  const previewGraph = useMemo(() => buildOrgGraph(state, filters), [state, filters]);
  const exportFormat = state.project.settings.orgChartExportFormat;
  const previewImage = useMemo(() => {
    if (previewGraph.nodes.length === 0) return '';
    try {
      return exportOrgGraphPng(state, filters, undefined, exportFormat);
    } catch {
      return '';
    }
  }, [exportFormat, filters, previewGraph.nodes.length, state]);

  return (
    <section className="view-stack">
      <div className="export-grid">
        <section className="tool-panel">
          <div className="section-heading">
            <h2>瀵煎嚭</h2>
            <span className="small-badge">{canvasViewLabel(state.project.settings.activeCanvasView)}</span>
          </div>
          <div className="button-row export-format-row">
            {([
              ['ppt16x9', 'PPT 16:9'],
              ['a4Landscape', 'A4 妯増'],
              ['longImage', '闀垮浘'],
            ] as Array<[OrgChartExportFormat, string]>).map(([format, label]) => (
              <button
                key={format}
                type="button"
                className={exportFormat === format ? 'secondary-button export-format-chip active' : 'secondary-button export-format-chip'}
                onClick={() => setExportFormat(format)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="button-row">
            <button type="button" className="primary-button" onClick={exportPptx}>
              <Download size={16} />
              瀵煎嚭 PPTX
            </button>
            <button type="button" className="secondary-button" onClick={exportPng}>
              <ImageDown size={16} />
              瀵煎嚭 PNG
            </button>
          </div>
          <div className="export-preview">
            <div className="preview-meta">
              <span>{previewGraph.nodes.length} 涓妭鐐?路 {previewGraph.edges.length} 鏉＄嚎</span>
              <strong>浣跨敤褰撳墠鐢诲竷甯冨眬</strong>
            </div>
            {previewImage ? (
              <>
                <img src={previewImage} alt="瀵煎嚭棰勮" className="export-preview-image" />
                <p>褰撳墠妯″紡銆佺瓫閫夋潯浠跺拰鎵嬪姩甯冨眬浼氱洿鎺ヨ繘鍏ュ鍑虹粨鏋溿€?/p>
              </>
            ) : (
              <p>鏆傛棤鍙鍑虹殑缁勭粐鍥撅紝璇峰厛涓婁紶璧勬枡鎴栨墦寮€铏氭嫙婕旂ずDemo銆?/p>
            )}
          </div>
        </section>

        <section className="tool-panel">
          <div className="section-heading">
            <h2>椤圭洰鍖?/h2>
            <span className="small-badge">.mapping.zip</span>
          </div>
          <label className="field wide">
            <span>瀵嗙爜</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="鑷冲皯 6 涓瓧绗? />
          </label>
          <div className="button-row">
            <button type="button" className="primary-button" onClick={exportPackage}>
              <ShieldCheck size={16} />
              瀵煎嚭鍔犲瘑鍖?            </button>
            <label className="file-button">
              <Upload size={16} />
              瀵煎叆鍔犲瘑鍖?              <input type="file" accept=".zip,.mapping.zip" onChange={(event) => void importPackage(event.target.files?.[0])} />
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
