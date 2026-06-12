import {
  AlertTriangle,
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
  PhoneCall,
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
import { clearPersistedState, loadPersistedState, persistState } from './lib/idb';
import { addImportResult, updateCandidateStatus } from './lib/merge';
import { buildReviewQueueBuckets, buildReviewSourceAlerts, candidateKindCounts, type ReviewQueueKey } from './lib/reviewQueue';
import { downloadBlob, exportOrgGraphPng, exportReportPptx } from './lib/exporters';
import { createId, normalizeName } from './lib/ids';
import {
  applyAcceptedMapPatch,
  buildFollowUpPrompts,
  buildInterviewArtifacts,
  getInterviewFieldValue,
  mergeInterviewFields,
  parseInterviewQuickNotes,
  suggestMountTargets,
  upsertInterviewField,
  type MountSuggestion,
} from './lib/interviewPatch';
import type {
  AnyCandidatePayload,
  AppState,
  AuditAction,
  CandidateKind,
  CandidateProfile,
  CandidateRecord,
  ChangeCandidatePayload,
  InterviewField,
  InterviewSession,
  MapPatch,
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
  { key: 'import', label: '导入', icon: Inbox },
  { key: 'review', label: '确认', icon: Check },
  { key: 'map', label: '组织图', icon: Network },
  { key: 'export', label: '导出', icon: Download },
];

const kindLabel: Record<CandidateKind, string> = {
  person: '人员',
  orgUnit: '组织',
  roleAssignment: '任职',
  reportingLine: '汇报线',
  changeEvent: '变更',
};

const defaultFilters: OrgMapFilters = {
  company: '',
  search: '',
  focusPersonName: '',
  minConfidence: 0.72,
  visibleLimit: 28,
  maxDepth: 2,
  onlyTalent: false,
  onlyRecentChanges: false,
  onlyManagers: false,
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
  recruiting: { template: 'recruiting', chartMode: 'formal', filters: { minConfidence: 0.55, visibleLimit: 48, maxDepth: 2 } },
  detail: { template: 'recruiting', chartMode: 'formal', filters: { minConfidence: 0.55, visibleLimit: 42, maxDepth: 2 } },
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
    executive: '汇报模式 · 常规架构图',
    mindmap: '汇报模式 · 树状图',
    recruiting: '招聘模式 · 常规架构图',
    detail: '招聘模式 · 树状图',
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

function mapPatchTypeLabel(type: MapPatch['type']): string {
  return {
    person: '新增人员',
    orgUnit: '新增部门',
    roleAssignment: '新增任职',
    reportingLine: '新增汇报线',
    changeEvent: '新增备注',
  }[type];
}

function mapPatchSummary(patch: MapPatch): string {
  const payload = patch.payload as Record<string, unknown>;
  switch (patch.type) {
    case 'person':
      return `${String(payload.name ?? '候选人')} 将进入组织图`;
    case 'orgUnit':
      return `补充部门 ${String(payload.name ?? '待确认部门')}`;
    case 'roleAssignment':
      return `${String(payload.personName ?? '候选人')} / ${String(payload.title ?? '岗位待确认')}`;
    case 'reportingLine':
      return `${String(payload.subordinateName ?? '候选人')} -> ${String(payload.managerName ?? '上级待确认')}`;
    case 'changeEvent':
      return String(payload.description ?? '补充通话备注');
    default:
      return '待确认补丁';
  }
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
      .catch((error) => setToast(`本地缓存读取失败：${error instanceof Error ? error.message : String(error)}`))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (demoSession.current || isVirtualDemoState(state)) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      persistState(state).catch((error) =>
        setToast(`本地保存失败：${error instanceof Error ? error.message : String(error)}`),
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
    const { importSourceFile } = await import('./lib/importer');

    for (const file of [...files]) {
      try {
        const result = await importSourceFile(file, { enableOcr });
        candidateCount += result.candidates.length;
        setState((current) =>
          appendAudit(addImportResult(current, result), 'import', `导入 ${file.name}`, {
            entityCount: result.candidates.length,
            view: 'import',
            sourceName: file.name,
          }),
        );
      } catch (error) {
        setToast(`${file.name} 导入失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (candidateCount > 0) {
      demoSession.current = false;
      setToast(`已生成 ${candidateCount} 条候选`);
      setOpenManualRepair(false);
      setActiveView('review');
    } else {
      setToast(enableOcr ? '未识别到候选，请手动补充。' : '未识别到候选，可开启 OCR 后重试，或手动补充。');
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
    setState(appendAudit(demo, 'demo-loaded', '载入大规模地图业务虚拟样例', { entityCount: demo.people.length, view: 'map' }));
    setFilters({ ...defaultFilters, ...canvasPresets.executive.filters });
    setOpenManualRepair(false);
    setActiveView('map');
    setToast('已载入虚拟演示 Demo');
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
        `${status === 'accepted' ? '确认' : '忽略'} ${selectedPendingCount} 条候选`,
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

  function openManualRepairFromReview(): void {
    setOpenManualRepair(true);
    setActiveView('map');
    setToast('请在组织图页补录截图中的人员和汇报线');
  }

  async function exportPackage(): Promise<void> {
    try {
      const { exportEncryptedProjectPackage } = await import('./lib/projectPackage');
      const blob = await exportEncryptedProjectPackage(state, password);
      downloadBlob(blob, `${state.project.name}.mapping.zip`);
      setState((current) => appendAudit(current, 'export', '导出加密项目包', { view: 'export' }));
      setToast('已导出加密项目包');
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }

  async function importPackage(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const { importEncryptedProjectPackage } = await import('./lib/projectPackage');
      const imported = ensureStateShape(await importEncryptedProjectPackage(file, password));
      setState(appendAudit(imported, 'project-imported', `导入项目包 ${file.name}`, { view: 'export', sourceName: file.name }));
      setActiveView('map');
      setToast('项目包已导入');
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
          setState((current) => appendAudit(current, 'export', '导出组织图 PNG', { entityCount: graph.nodes.length, view: 'export' }));
        });
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }

  async function exportPptx(): Promise<void> {
    try {
      await exportReportPptx(state, filters);
      setState((current) => appendAudit(current, 'export', '导出 PPTX', { entityCount: graph.nodes.length, view: 'export' }));
      setToast('PPTX 已生成');
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
            <strong>Mapping 工具</strong>
            <span>本地组织图生成器</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="主导航">
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
            <button type="button" onClick={() => setToast('')} aria-label="关闭提示">
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
            sources={state.sources}
            roleAssignments={state.roleAssignments}
            reportingLines={state.reportingLines}
            onAccept={(ids) => decideCandidates(ids, 'accepted')}
            onReject={(ids) => decideCandidates(ids, 'rejected')}
            onFieldChange={updateCandidatePayload}
            onOpenManualRepair={openManualRepairFromReview}
          />
        )}

        {activeView === 'map' && (
          <OrgMapView
            state={state}
            setState={setState}
            setToast={setToast}
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
          <h2>上传资料</h2>
          <label className="file-button large-file-button">
            <Inbox size={16} />
            选择 TXT / PPTX / 图片
            <input
              type="file"
              multiple
              accept=".txt,.md,.pptx,.png,.jpg,.jpeg,.webp,.bmp"
              onChange={(event) => void onFiles(event.target.files)}
              aria-label="选择资料文件"
            />
          </label>
          <label className="toggle-line">
            <input type="checkbox" checked={enableOcr} onChange={(event) => setEnableOcr(event.target.checked)} />
            <span>本地 OCR</span>
          </label>
        </section>

        <section className="entry-card demo-card">
          <div className="entry-icon">
            <Network size={24} />
          </div>
          <h2>虚拟演示 Demo</h2>
          <button type="button" className="primary-button demo-entry-button" onClick={loadMapBusinessDemo}>
            打开演示组织图
          </button>
        </section>
      </div>
    </section>
  );
}

function ReviewView({
  candidates,
  sources,
  roleAssignments,
  reportingLines,
  onAccept,
  onReject,
  onFieldChange,
  onOpenManualRepair,
}: {
  candidates: CandidateRecord<AnyCandidatePayload>[];
  sources: AppState['sources'];
  roleAssignments: AppState['roleAssignments'];
  reportingLines: AppState['reportingLines'];
  onAccept: (ids: string[]) => void;
  onReject: (ids: string[]) => void;
  onFieldChange: (candidateId: string, field: string, value: string) => void;
  onOpenManualRepair: () => void;
}) {
  const [queueFilter, setQueueFilter] = useState<ReviewQueueKey>('priority');
  const [kindFilter, setKindFilter] = useState<CandidateKind | 'all'>('all');
  const sourceAlerts = buildReviewSourceAlerts(sources);
  const queueBuckets = buildReviewQueueBuckets(candidates, sources, roleAssignments, reportingLines);
  const candidateIdsByQueue = new Map(queueBuckets.map((bucket) => [bucket.key, bucket.candidateIds]));
  const counts = candidateKindCounts(candidates).map((item) => ({
    ...item,
    label: kindLabel[item.kind],
  }));
  const activeQueue =
    queueBuckets.find((bucket) => bucket.key === queueFilter && (bucket.count > 0 || bucket.key === 'all')) ??
    queueBuckets.find((bucket) => bucket.key !== 'all' && bucket.count > 0) ??
    queueBuckets.find((bucket) => bucket.key === 'all')!;
  const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const queueCandidates = (candidateIdsByQueue.get(activeQueue.key) ?? [])
    .map((candidateId) => candidateMap.get(candidateId))
    .filter((candidate): candidate is CandidateRecord<AnyCandidatePayload> => Boolean(candidate));
  const queueSourceTasks = (activeQueue.sourceIds ?? [])
    .map((sourceId) => sourceMap.get(sourceId))
    .filter((source): source is AppState['sources'][number] => Boolean(source));
  const visibleCandidates = queueCandidates
    .filter((candidate) => kindFilter === 'all' || candidate.kind === kindFilter)
    .slice(0, 160);
  const visibleIds = visibleCandidates.map((candidate) => candidate.id);
  const queueNoteById = new Map<ReviewQueueKey, { label: string; tone: string }>([
    ['priority', { label: '优先确认', tone: 'queue-priority' }],
    ['review', { label: '待复核', tone: 'queue-review' }],
    ['manual', { label: '截图待补录', tone: 'queue-manual' }],
    ['all', { label: '全部候选', tone: 'queue-all' }],
  ]);

  return (
    <section className="view-stack">
      <section className="tool-panel recognition-preview">
        <div className="section-heading">
          <h2>确认识别结果</h2>
          <span className="small-badge">{candidates.length}</span>
        </div>

        {sourceAlerts.length > 0 && (
          <div className="review-alert-list">
            {sourceAlerts.map((alert) => (
              <article className={`review-alert-card ${alert.severity}`} key={alert.id}>
                <div className="review-alert-title">
                  <strong>{alert.title}</strong>
                  <span className={`small-badge ${alert.severity === 'manual' ? 'warning' : ''}`}>{alert.fileName}</span>
                </div>
                <p>{alert.message}</p>
              </article>
            ))}
          </div>
        )}

        <div className="review-queue-grid">
          {queueBuckets
            .filter((bucket) => bucket.key !== 'all')
            .map((bucket) => (
              <button
                key={bucket.key}
                type="button"
                className={activeQueue.key === bucket.key ? 'active' : ''}
                onClick={() => setQueueFilter(bucket.key)}
              >
                <strong>{bucket.count}</strong>
                <span>{bucket.label}</span>
                <small>{bucket.description}</small>
              </button>
            ))}
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
          全部类型
        </button>
        <span className="review-toolbar-note">
          当前队列：{activeQueue.label}，共 {activeQueue.count} 项，当前显示 {visibleCandidates.length} 条候选
          {queueSourceTasks.length > 0 ? `，另有 ${queueSourceTasks.length} 份截图待补录` : ''}
        </span>
        <button type="button" className="primary-button" onClick={() => onAccept(visibleIds)} disabled={!visibleIds.length}>
          <Check size={16} />
          确认当前
        </button>
        <button type="button" className="secondary-button" onClick={() => onReject(visibleIds)} disabled={!visibleIds.length}>
          <X size={16} />
          忽略当前
        </button>
      </div>

      <div className="candidate-list">
        {queueSourceTasks.map((source) => (
          <article className="candidate-card queue-manual source-task-card" key={source.id}>
            <div className="candidate-main">
              <div className="candidate-title">
                <span className="kind-pill">截图资料</span>
                <span className="queue-pill queue-manual">待补录</span>
                <strong>{source.fileName}</strong>
                <em>{source.totalChunks > 0 ? `${source.totalChunks} 段文本` : '未抽到文本'}</em>
              </div>
              <p className="source-task-body">
                这份资料已经被识别成截图或图片来源，但当前没有可直接确认的候选。请去组织图页补录人员、岗位和汇报线。
              </p>
              {source.warnings?.length ? (
                <ul className="source-task-warnings">
                  {source.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="candidate-actions">
              <button type="button" className="primary-button" onClick={onOpenManualRepair}>
                去组织图补录
              </button>
            </div>
          </article>
        ))}
        {visibleCandidates.map((candidate) => {
          const queueKey =
            (queueBuckets.find((bucket) => bucket.key !== 'all' && bucket.candidateIds.includes(candidate.id))?.key as ReviewQueueKey | undefined) ??
            'review';
          const note = queueNoteById.get(queueKey) ?? queueNoteById.get('review')!;

          return (
            <article className={`candidate-card ${note.tone}`} key={candidate.id}>
              <div className="candidate-main">
                <div className="candidate-title">
                  <span className="kind-pill">{kindLabel[candidate.kind]}</span>
                  <span className={`queue-pill ${note.tone}`}>{note.label}</span>
                  <strong>{candidateSummary(candidate)}</strong>
                  <em>{Math.round(candidate.confidence * 100)}%</em>
                </div>
                <CandidateEditor candidate={candidate} onFieldChange={onFieldChange} />
                <blockquote>{candidate.evidenceText}</blockquote>
                <small>{candidate.sourceName}</small>
              </div>
              <div className="candidate-actions">
                <button type="button" className="primary-button" onClick={() => onAccept([candidate.id])}>
                  确认
                </button>
                <button type="button" className="secondary-button" onClick={() => onReject([candidate.id])}>
                  忽略
                </button>
              </div>
            </article>
          );
        })}
        {visibleCandidates.length === 0 && queueSourceTasks.length === 0 && (
          <EmptyState title="当前队列没有待确认候选" body="切换队列或继续上传资料后，这里会显示人员、组织和汇报线。" />
        )}
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
      { key: 'name', label: '姓名', value: data.name },
      { key: 'company', label: '公司', value: data.company },
      { key: 'title', label: '岗位', value: data.title },
      { key: 'department', label: '部门', value: data.department },
    );
  }
  if (candidate.kind === 'orgUnit') {
    const data = payload as OrgUnitCandidatePayload;
    fields.push(
      { key: 'name', label: '组织', value: data.name },
      { key: 'company', label: '公司', value: data.company },
      { key: 'function', label: '职能', value: data.function },
      { key: 'parentName', label: '上级组织', value: data.parentName },
    );
  }
  if (candidate.kind === 'roleAssignment') {
    const data = payload as RoleCandidatePayload;
    fields.push(
      { key: 'personName', label: '姓名', value: data.personName },
      { key: 'title', label: '岗位', value: data.title },
      { key: 'orgUnitName', label: '部门', value: data.orgUnitName },
      { key: 'company', label: '公司', value: data.company },
    );
  }
  if (candidate.kind === 'reportingLine') {
    const data = payload as ReportingCandidatePayload;
    fields.push(
      { key: 'managerName', label: '上级', value: data.managerName },
      { key: 'subordinateName', label: '下级', value: data.subordinateName },
      { key: 'relationType', label: '关系', value: data.relationType },
    );
  }
  if (candidate.kind === 'changeEvent') {
    const data = payload as ChangeCandidatePayload;
    fields.push(
      { key: 'personName', label: '人员', value: data.personName },
      { key: 'type', label: '类型', value: data.type },
      { key: 'description', label: '描述', value: data.description },
      { key: 'date', label: '日期', value: data.date },
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
  setToast,
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
  setToast: Dispatch<SetStateAction<string>>;
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
  const [showCallMapping, setShowCallMapping] = useState(false);
  const [activeInterviewId, setActiveInterviewId] = useState('');
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
    filters.focusPersonName.trim(),
    filters.minConfidence !== canvasPresets[activeView].filters.minConfidence,
    filters.visibleLimit !== canvasPresets[activeView].filters.visibleLimit,
    filters.maxDepth !== canvasPresets[activeView].filters.maxDepth,
    filters.onlyTalent,
    filters.onlyRecentChanges,
    filters.onlyManagers,
  ].filter(Boolean).length;
  const draftInterviewSessions = useMemo(
    () =>
      state.interviewSessions
        .filter((session) => session.status === 'draft' || session.status === 'reviewing')
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [state.interviewSessions],
  );
  const activeInterview = state.interviewSessions.find((session) => session.id === activeInterviewId);
  const activeCandidate = activeInterview
    ? state.candidateProfiles.find((candidate) => candidate.id === activeInterview.candidateId)
    : undefined;
  const interviewPreviewFields = useMemo(
    () =>
      activeInterview
        ? mergeInterviewFields(activeInterview.structuredNotes, parseInterviewQuickNotes(activeInterview.rawNotes))
        : [],
    [activeInterview],
  );
  const interviewSuggestions = useMemo(
    () =>
      activeCandidate && activeInterview
        ? suggestMountTargets(state, activeCandidate.name, activeCandidate.company, interviewPreviewFields)
        : [],
    [activeCandidate, activeInterview, interviewPreviewFields, state],
  );
  const followUpPrompts = useMemo(
    () => (activeInterview ? buildFollowUpPrompts(interviewPreviewFields) : []),
    [activeInterview, interviewPreviewFields],
  );
  const interviewPatches = useMemo(
    () => state.mapPatches.filter((patch) => patch.sessionId === activeInterviewId),
    [activeInterviewId, state.mapPatches],
  );
  const pendingInterviewPatches = interviewPatches.filter((patch) => patch.status === 'draft' || patch.status === 'conflict');
  const existingCandidateMatch = activeCandidate?.name
    ? state.people.find((person) => normalizeName(person.name) === normalizeName(activeCandidate.name))
    : undefined;

  useEffect(() => {
    if (!openManualRepair) return;
    setShowManualRepair(true);
    onManualRepairOpened();
  }, [onManualRepairOpened, openManualRepair]);

  useEffect(() => {
    if (businessMode !== 'recruiting' && showCallMapping) setShowCallMapping(false);
  }, [businessMode, showCallMapping]);

  useEffect(() => {
    if (!showCallMapping) return;
    if (activeInterview) return;
    if (draftInterviewSessions.length > 0) setActiveInterviewId(draftInterviewSessions[0].id);
  }, [activeInterview, draftInterviewSessions, showCallMapping]);

  const openCallMappingPanel = () => {
    let nextSessionId = activeInterviewId;
    setState((current) => {
      if (nextSessionId && current.interviewSessions.some((session) => session.id === nextSessionId)) return current;
      const latestDraft = current.interviewSessions
        .filter((session) => session.status === 'draft' || session.status === 'reviewing')
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      if (latestDraft) {
        nextSessionId = latestDraft.id;
        return current;
      }
      const timestamp = new Date().toISOString();
      const candidateId = createId('candidate');
      nextSessionId = createId('session');
      return {
        ...current,
        candidateProfiles: [
          {
            id: candidateId,
            name: '',
            company: filters.company || current.project.companies[0] || '',
            resumeTitle: '',
            resumeDepartment: '',
            source: 'resume',
            status: 'interviewing',
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          ...current.candidateProfiles,
        ],
        interviewSessions: [
          {
            id: nextSessionId,
            candidateId,
            startedAt: timestamp,
            sourceType: 'phone',
            status: 'draft',
            rawNotes: '',
            structuredNotes: [],
            evidenceIds: [],
            patchIds: [],
          },
          ...current.interviewSessions,
        ],
      };
    });
    setShowCallMapping(true);
    setShowManualRepair(false);
    if (nextSessionId) setActiveInterviewId(nextSessionId);
  };

  const updateCandidateProfileField = (field: keyof CandidateProfile, value: string) => {
    if (!activeCandidate) return;
    setState((current) => {
      const next = structuredClone(current);
      const candidate = next.candidateProfiles.find((item) => item.id === activeCandidate.id);
      if (!candidate) return current;
      switch (field) {
        case 'name':
          candidate.name = value;
          break;
        case 'company':
          candidate.company = value;
          break;
        case 'resumeTitle':
          candidate.resumeTitle = value;
          break;
        case 'resumeDepartment':
          candidate.resumeDepartment = value;
          break;
        case 'claimedTitle':
          candidate.claimedTitle = value;
          break;
        case 'claimedDepartment':
          candidate.claimedDepartment = value;
          break;
        default:
          break;
      }
      candidate.updatedAt = new Date().toISOString();
      return next;
    });
  };

  const updateInterviewFieldValue = (key: InterviewField['key'], value: string) => {
    if (!activeInterview) return;
    setState((current) => {
      const next = structuredClone(current);
      const session = next.interviewSessions.find((item) => item.id === activeInterview.id);
      if (!session) return current;
      session.structuredNotes = upsertInterviewField(session.structuredNotes, key, value);
      if (key === 'currentTitle' || key === 'currentDepartment') {
        const candidate = next.candidateProfiles.find((item) => item.id === session.candidateId);
        if (candidate) {
          if (key === 'currentTitle') candidate.claimedTitle = value.trim() || undefined;
          if (key === 'currentDepartment') candidate.claimedDepartment = value.trim() || undefined;
          candidate.updatedAt = new Date().toISOString();
        }
      }
      return next;
    });
  };

  const updateInterviewRawNotes = (value: string) => {
    if (!activeInterview) return;
    setState((current) => {
      const next = structuredClone(current);
      const session = next.interviewSessions.find((item) => item.id === activeInterview.id);
      if (!session) return current;
      session.rawNotes = value;
      return next;
    });
  };

  const saveInterviewDraft = () => {
    if (!activeInterview) return;
    setState((current) => {
      const next = structuredClone(current);
      const session = next.interviewSessions.find((item) => item.id === activeInterview.id);
      if (!session) return current;
      session.status = 'draft';
      return appendAudit(next, 'talent-updated', '保存通话补图草稿', { view: 'map' });
    });
    setToast('已保存通话补图草稿');
  };

  const generateInterviewPatches = () => {
    if (!activeInterview || !activeCandidate) return;
    if (!activeCandidate.name.trim()) {
      setToast('先填写候选人姓名，再生成补图建议');
      return;
    }
    const artifacts = buildInterviewArtifacts(state, activeCandidate, activeInterview);
    setState((current) => {
      const next = structuredClone(current);
      const session = next.interviewSessions.find((item) => item.id === activeInterview.id);
      const candidate = next.candidateProfiles.find((item) => item.id === activeInterview.candidateId);
      if (!session || !candidate) return current;
      next.interviewEvidence = next.interviewEvidence.filter((item) => item.sessionId !== activeInterview.id);
      next.mapPatches = next.mapPatches.filter((item) => item.sessionId !== activeInterview.id);
      next.interviewEvidence.unshift(...artifacts.evidence);
      next.mapPatches.unshift(...artifacts.patches);
      session.structuredNotes = artifacts.mergedFields;
      session.evidenceIds = artifacts.evidence.map((item) => item.id);
      session.patchIds = artifacts.patches.map((item) => item.id);
      session.status = 'reviewing';
      candidate.claimedTitle = getInterviewFieldValue(artifacts.mergedFields, 'currentTitle') || candidate.claimedTitle;
      candidate.claimedDepartment =
        getInterviewFieldValue(artifacts.mergedFields, 'currentDepartment') || candidate.claimedDepartment;
      candidate.personId = artifacts.matchedPersonId ?? candidate.personId;
      candidate.status = 'interviewing';
      candidate.updatedAt = new Date().toISOString();
      return appendAudit(next, 'talent-updated', `生成 ${candidate.name} 的通话补图建议`, {
        entityCount: artifacts.patches.length,
        view: 'map',
      });
    });
    setToast(`已生成 ${artifacts.patches.length} 条待确认补图建议`);
  };

  const updatePatchStatus = (patchId: string, status: MapPatch['status']) => {
    setState((current) => {
      let next = structuredClone(current);
      const patchIndex = next.mapPatches.findIndex((patch) => patch.id === patchId);
      if (patchIndex < 0) return current;
      next.mapPatches[patchIndex].status = status;
      if (status === 'accepted') next = applyAcceptedMapPatch(next, next.mapPatches[patchIndex]);

      const session = next.interviewSessions.find((item) => item.id === activeInterviewId);
      const candidate = session ? next.candidateProfiles.find((item) => item.id === session.candidateId) : undefined;
      const sessionPatches = next.mapPatches.filter((patch) => patch.sessionId === activeInterviewId);
      const hasDrafts = sessionPatches.some((patch) => patch.status === 'draft');
      const hasAccepted = sessionPatches.some((patch) => patch.status === 'accepted');
      if (session) session.status = hasDrafts ? 'reviewing' : hasAccepted ? 'applied' : session.status;
      if (candidate) {
        const matched = next.people.find((person) => normalizeName(person.name) === normalizeName(candidate.name));
        if (matched) candidate.personId = matched.id;
        candidate.status = hasDrafts ? 'interviewing' : hasAccepted ? 'mapped' : candidate.status;
        candidate.updatedAt = new Date().toISOString();
      }

      return appendAudit(
        next,
        'talent-updated',
        status === 'accepted' ? `确认补图项 ${patchId}` : `更新补图项状态 ${status}`,
        { view: 'map' },
      );
    });
  };

  const acceptAllInterviewPatches = () => {
    if (pendingInterviewPatches.length === 0) return;
    const pendingIds = pendingInterviewPatches.map((patch) => patch.id);
    setState((current) => {
      let next = structuredClone(current);
      for (const patchId of pendingIds) {
        const patchIndex = next.mapPatches.findIndex((patch) => patch.id === patchId);
        if (patchIndex < 0) continue;
        next.mapPatches[patchIndex].status = 'accepted';
        next = applyAcceptedMapPatch(next, next.mapPatches[patchIndex]);
      }
      const session = next.interviewSessions.find((item) => item.id === activeInterviewId);
      const candidate = session ? next.candidateProfiles.find((item) => item.id === session.candidateId) : undefined;
      if (session) session.status = 'applied';
      if (candidate) {
        const matched = next.people.find((person) => normalizeName(person.name) === normalizeName(candidate.name));
        if (matched) candidate.personId = matched.id;
        candidate.status = 'mapped';
        candidate.updatedAt = new Date().toISOString();
      }
      return appendAudit(next, 'talent-updated', '批量确认通话补图建议', {
        entityCount: pendingIds.length,
        view: 'map',
      });
    });
    setToast(`已确认 ${pendingIds.length} 条补图建议`);
  };

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
      return appendAudit(next, 'canvas-layout-saved', `保存 ${canvasViewLabel(activeView)} 画布`, {
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
      return appendAudit(next, 'canvas-layout-reset', `重置 ${canvasViewLabel(activeView)} 画布`, { view: 'map' });
    });
  };

  const upsertManualPerson = () => {
    const name = manualPerson.name.trim();
    if (!name) return;
    const timestamp = new Date().toISOString();
    setState((current) => {
      const next: AppState = structuredClone(current);
      const existing = next.people.find((person) => normalizeName(person.name) === normalizeName(name));
      const company = manualPerson.company.trim() || existing?.company || next.project.companies[0] || '待确认公司';
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
          tags: ['手动补录'],
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
      return appendAudit(next, 'talent-updated', `手动补录人员 ${name}`, { view: 'map' });
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
            company: next.project.companies[0] || '待确认公司',
            tags: ['手动补录'],
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
      return appendAudit(next, 'talent-updated', `手动新增汇报线 ${subordinate} -> ${manager}`, { view: 'map' });
    });
    setManualLine({ manager: '', subordinate: '' });
  };

  const graphNodes: Node[] = useMemo(
    () =>
      graph.nodes.map((node) => {
        const departmentLabel = node.department ?? node.company ?? '未归属部门';
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
                      <small>{node.levelLabel}</small>
                    </div>
                    <span>一号位 {node.label}</span>
                    <em>{node.title ?? '负责人待确认'}</em>
                    <div className="report-node-metrics">
                      <b>{reportCount} 人</b>
                      <i>{node.visibleSpan} 直属</i>
                      {node.hiddenDirectCount > 0 && <i>+{node.hiddenDirectCount} 收起</i>}
                    </div>
                    <button
                      type="button"
                      className="node-note-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedNodeId(node.id);
                      }}
                    >
                      查看备注{noteCount > 0 ? ` ${noteCount}` : ''}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flow-node-top">
                      <strong>{node.label}</strong>
                      <small>{node.levelLabel}</small>
                    </div>
                    <span>{node.title ?? '岗位待确认'}</span>
                    <em>{node.department ?? node.company ?? '组织待确认'}</em>
                    <div className="flow-node-meta">
                      {node.isTalent && <b className="talent-pill">重点</b>}
                      {node.span > 0 && <b>{node.visibleSpan}/{node.span} 下属</b>}
                      {node.hiddenDirectCount > 0 && <b>+{node.hiddenDirectCount} 收起</b>}
                      {node.changeCount > 0 && <b>变更 {node.changeCount}</b>}
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
  const draftGraphNodes: Node[] = useMemo(() => {
    if (businessMode !== 'recruiting' || !activeInterview || pendingInterviewPatches.length === 0) return [];
    const confirmedNodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const confirmedNodeByName = new Map(graph.nodes.map((node) => [normalizeName(node.label), node]));
    const maxX = graph.nodes.length > 0 ? Math.max(...graph.nodes.map((node) => node.x)) : 640;
    const rootNode = graph.nodes.find((node) => node.depth === 0);
    const candidateName = activeCandidate?.name.trim() ?? '';
    const departmentName = getInterviewFieldValue(interviewPreviewFields, 'currentDepartment');
    const managerName = getInterviewFieldValue(interviewPreviewFields, 'managerName');
    const primarySuggestion = interviewSuggestions[0];
    const anchorNode =
      (primarySuggestion?.targetType === 'person' && primarySuggestion.targetId
        ? confirmedNodeById.get(`person:${normalizeName(state.people.find((person) => person.id === primarySuggestion.targetId)?.name ?? '')}`)
        : undefined) ??
      (managerName ? confirmedNodeByName.get(normalizeName(managerName)) : undefined) ??
      (departmentName
        ? graph.nodes.find((node) => normalizeName(node.department ?? '') === normalizeName(departmentName))
        : undefined) ??
      rootNode;

    const anchorX = anchorNode?.x ?? maxX + 120;
    const anchorY = anchorNode?.y ?? 120;
    const nodes: Node[] = [];
    let personDraftY = anchorY + 18;

    const personPatch = pendingInterviewPatches.find((patch) => patch.type === 'person');
    if (personPatch) {
      nodes.push({
        id: `draft:${personPatch.id}`,
        position: { x: anchorX + 286, y: personDraftY },
        draggable: false,
        type: 'default',
        data: {
          label: (
            <div className="flow-node draft-node draft-person-node">
              <div className="flow-node-top">
                <strong>{candidateName || '待确认候选人'}</strong>
                <small>通话新增</small>
              </div>
              <span>{getInterviewFieldValue(interviewPreviewFields, 'currentTitle') || activeCandidate?.resumeTitle || '岗位待确认'}</span>
              <em>{departmentName || activeCandidate?.resumeDepartment || '部门待确认'}</em>
              <div className="draft-node-meta">
                <b>待确认</b>
                {existingCandidateMatch && <b>疑似重复</b>}
              </div>
            </div>
          ),
        },
      });
      personDraftY += 148;
    }

    const orgPatch = pendingInterviewPatches.find((patch) => patch.type === 'orgUnit');
    if (orgPatch) {
      nodes.push({
        id: `draft:${orgPatch.id}`,
        position: { x: anchorX + 286, y: personDraftY },
        draggable: false,
        type: 'default',
        data: {
          label: (
            <div className="flow-node draft-node draft-org-node">
              <div className="flow-node-top">
                <strong>{departmentName || '待确认部门'}</strong>
                <small>待确认部门</small>
              </div>
              <span>{activeCandidate?.company || filters.company || '公司待确认'}</span>
              <div className="draft-node-meta">
                <b>等待挂载</b>
              </div>
            </div>
          ),
        },
      });
    }

    return nodes;
  }, [
    activeCandidate,
    activeInterview,
    businessMode,
    existingCandidateMatch,
    filters.company,
    graph.nodes,
    interviewPreviewFields,
    interviewSuggestions,
    pendingInterviewPatches,
    state.people,
  ]);
  const [nodes, setNodes] = useState<Node[]>([...graphNodes, ...draftGraphNodes]);

  const edges: Edge[] = useMemo(
    () => {
      const baseEdges = graph.edges.map((edge) => {
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
      });

      if (businessMode !== 'recruiting' || !activeInterview || pendingInterviewPatches.length === 0) return baseEdges;

      const draftEdges: Edge[] = [];
      const managerName = getInterviewFieldValue(interviewPreviewFields, 'managerName');
      const personPatch = pendingInterviewPatches.find((patch) => patch.type === 'person');
      const linePatch = pendingInterviewPatches.find((patch) => patch.type === 'reportingLine');
      const departmentPatch = pendingInterviewPatches.find((patch) => patch.type === 'orgUnit');
      const managerNode = managerName
        ? graph.nodes.find((node) => normalizeName(node.label) === normalizeName(managerName))
        : undefined;

      if (personPatch && managerNode) {
        draftEdges.push({
          id: `draft-edge:${personPatch.id}`,
          source: managerNode.id,
          target: `draft:${personPatch.id}`,
          type: isTree ? 'straight' : 'step',
          style: {
            stroke: '#4f7dff',
            strokeWidth: isTree ? 1.35 : 1.6,
            strokeDasharray: '7 5',
          },
          className: 'org-edge draft-edge',
        });
      }

      if (departmentPatch && personPatch) {
        draftEdges.push({
          id: `draft-edge:${departmentPatch.id}`,
          source: `draft:${departmentPatch.id}`,
          target: `draft:${personPatch.id}`,
          type: 'straight',
          style: {
            stroke: linePatch?.status === 'conflict' ? '#c26d00' : '#9aa8b7',
            strokeWidth: 1.3,
            strokeDasharray: '6 5',
          },
          className: 'org-edge draft-edge',
        });
      }

      return [...baseEdges, ...draftEdges];
    },
    [activeInterview, businessMode, graph.edges, graph.nodes, interviewPreviewFields, isTree, pendingInterviewPatches],
  );

  useEffect(() => setNodes([...graphNodes, ...draftGraphNodes]), [draftGraphNodes, graphNodes]);
  useEffect(() => {
    if (selectedNodeId && !graph.nodes.some((node) => node.id === selectedNodeId)) setSelectedNodeId('');
  }, [graph.nodes, selectedNodeId]);

  useEffect(() => {
    if (!flowInstance || nodes.length === 0 || editMode) return;
    const timer = window.setTimeout(() => {
      const fitPrimaryBounds = (depthLimit: number, padding: number, nodeWidth: number, nodeHeight: number) => {
        const primaryNodes = graph.nodes.filter((node) => node.depth <= depthLimit);
        if (primaryNodes.length === 0) {
          void flowInstance.fitView({ duration: 260, padding, includeHiddenNodes: false });
          return;
        }
        const minX = Math.min(...primaryNodes.map((node) => node.x));
        const maxX = Math.max(...primaryNodes.map((node) => node.x));
        const minY = Math.min(...primaryNodes.map((node) => node.y));
        const maxY = Math.max(...primaryNodes.map((node) => node.y));
        void flowInstance.fitBounds(
          {
            x: minX - 32,
            y: minY - 32,
            width: maxX - minX + nodeWidth + 64,
            height: maxY - minY + nodeHeight + 64,
          },
          { duration: 260, padding },
        );
      };

      if (savedCount > 0) {
        void flowInstance.fitView({ duration: 260, padding: isTree ? 0.12 : 0.08, includeHiddenNodes: false });
        return;
      }

      if (isTree) {
        void flowInstance.fitView({ duration: 260, padding: 0.12, includeHiddenNodes: false });
        return;
      }

      if (isReportMode) {
        fitPrimaryBounds(2, 0.16, 240, 116);
        return;
      }

      fitPrimaryBounds(Math.min(filters.maxDepth, 2), 0.1, 198, 96);
    }, 80);

    return () => window.clearTimeout(timer);
  }, [editMode, filters.maxDepth, flowInstance, graph.nodes, isReportMode, isTree, nodes.length, savedCount]);

  const onNodesChange = (changes: NodeChange[]) => {
    if (!editMode) return;
    setNodes((current) => applyNodeChanges(changes, current));
  };

  const saveNodePosition = (_: unknown, node: Node) => {
    if (!editMode || String(node.id).startsWith('lane:') || String(node.id).startsWith('draft:')) return;
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

  const selectedDepartment = selectedGraphNode?.department ?? selectedGraphNode?.company ?? '未归属部门';
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
        ...(selectedGraphNode.averageConfidence < 0.75 ? ['存在低置信度来源，正式汇报前建议复核。'] : []),
        ...(selectedGraphNode.hiddenDirectCount > 0 ? [`当前已收起 ${selectedGraphNode.hiddenDirectCount} 个下钻人员。`] : []),
        ...(selectedGraphNode.span === 0 ? ['暂未识别到直属下属。'] : []),
      ]
    : [];

  return (
    <section className="map-layout">
      {!hasOrgData ? (
        <section className="empty-map-panel">
          <Network size={30} />
          <h2>还没有组织图</h2>
          <div className="empty-map-actions">
            <button type="button" className="primary-button" onClick={onImport}>
              <Upload size={16} />
              上传资料
            </button>
            <button type="button" className="secondary-button" onClick={loadMapBusinessDemo}>
              <Network size={16} />
              虚拟演示 Demo
            </button>
          </div>
        </section>
      ) : (
        <>
      <div className="canvas-command-bar" aria-label="画布工具栏">
        <div className="segmented-control" role="group" aria-label="业务模式">
          {([
            ['report', '汇报模式'],
            ['recruiting', '招聘模式'],
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
        <div className="segmented-control" role="group" aria-label="图形样式">
          {([
            ['regular', '常规架构图'],
            ['tree', '树状图'],
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
            placeholder="搜索姓名 / 岗位 / 部门"
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
        </label>
        <div className="canvas-actions primary-canvas-actions">
          {businessMode === 'recruiting' && (
            <button
              type="button"
              className={showCallMapping ? 'secondary-button active-filter' : 'secondary-button'}
              onClick={() => {
                if (showCallMapping) {
                  setShowCallMapping(false);
                  return;
                }
                openCallMappingPanel();
              }}
            >
              <PhoneCall size={16} />
              通话补图
            </button>
          )}
          <button
            type="button"
            className={showFilters || activeFilterCount > 0 ? 'secondary-button active-filter' : 'secondary-button'}
            onClick={() => setShowFilters((value) => !value)}
          >
            <SlidersHorizontal size={16} />
            {showFilters ? '收起筛选' : activeFilterCount > 0 ? `筛选 ${activeFilterCount}` : '筛选'}
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
                展开更多
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
                折叠部门
              </button>
            </>
          )}
          {businessMode === 'recruiting' && filters.focusPersonName.trim() && (
            <button
              type="button"
              className="secondary-button active-filter"
              onClick={() => setFilters({ ...filters, focusPersonName: '' })}
            >
              <RotateCcw size={16} />
              返回全图
            </button>
          )}
          <button type="button" className="secondary-button" onClick={() => flowInstance?.fitView({ duration: 260 })}>
            <Maximize2 size={16} />
            适配画布
          </button>
          <button
            type="button"
            className={editMode ? 'secondary-button active-filter' : 'secondary-button'}
            onClick={() => setEditMode((value) => !value)}
          >
            {editMode ? <Lock size={16} /> : <Move size={16} />}
            {editMode ? '结束编辑' : '编辑布局'}
          </button>
          {editMode && (
            <button type="button" className="secondary-button" onClick={saveVisibleLayout}>
              <Save size={16} />
              保存布局
            </button>
          )}
          <details className="canvas-more-actions">
            <summary>
              <MoreHorizontal size={16} />
              更多
            </summary>
            <div>
              <button
                type="button"
                className={showManualRepair ? 'secondary-button active-filter' : 'secondary-button'}
                onClick={() => setShowManualRepair((value) => !value)}
              >
                <Users size={16} />
                手动补充
              </button>
              <button
                type="button"
                className={showAdvancedFilters ? 'secondary-button active-filter' : 'secondary-button'}
                onClick={() => setShowAdvancedFilters((value) => !value)}
              >
                <SlidersHorizontal size={16} />
                {showAdvancedFilters ? '收起高级' : '高级筛选'}
              </button>
              <button type="button" className="secondary-button" onClick={resetLayout} disabled={savedCount === 0}>
                <RotateCcw size={16} />
                重新布局
              </button>
            </div>
          </details>
        </div>
      </div>

      {showFilters && (
        <div className="map-controls primary-map-controls">
          <label>
            {'公司'}
            <select value={filters.company} onChange={(event) => setFilters({ ...filters, company: event.target.value })}>
              <option value="">{'全部'}</option>
              {state.project.companies.map((company) => (
                <option key={company} value={company}>
                  {company}
                </option>
              ))}
            </select>
          </label>
          <div className="filter-chip-grid primary-filter-chips">
            <button
              type="button"
              className={filters.onlyManagers ? 'filter-chip active' : 'filter-chip'}
              onClick={() => setFilters({ ...filters, onlyManagers: !filters.onlyManagers })}
            >
              {'仅看负责人'}
            </button>
            <button
              type="button"
              className={filters.onlyTalent ? 'filter-chip active' : 'filter-chip'}
              onClick={() => setFilters({ ...filters, onlyTalent: !filters.onlyTalent })}
            >
              {'仅看关键人才'}
            </button>
            <button
              type="button"
              className={filters.onlyRecentChanges ? 'filter-chip active' : 'filter-chip'}
              onClick={() => setFilters({ ...filters, onlyRecentChanges: !filters.onlyRecentChanges })}
            >
              {'仅看近期变化'}
            </button>
          </div>
        </div>
      )}

      {showFilters && showAdvancedFilters && (
        <div className="map-controls advanced-map-controls">
          <label>
            {'负责人聚焦'}
            <input
              value={filters.focusPersonName}
              placeholder={'输入姓名聚焦上下级链路'}
              onChange={(event) => setFilters({ ...filters, focusPersonName: event.target.value })}
            />
          </label>
          <label>
            {'置信度 '}{Math.round(filters.minConfidence * 100)}{'%'}
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
            {'节点上限'}
            <input
              type="number"
              min="20"
              max="600"
              value={filters.visibleLimit}
              onChange={(event) => setFilters({ ...filters, visibleLimit: Number(event.target.value) })}
            />
          </label>
          <label>
            {'层级'}
            <input
              type="number"
              min="1"
              max="8"
              value={filters.maxDepth}
              onChange={(event) => setFilters({ ...filters, maxDepth: Number(event.target.value) })}
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              setFilters({
                ...defaultFilters,
                ...canvasPresets[activeView].filters,
              })
            }
          >
            <RotateCcw size={16} />
            {'重置筛选'}
          </button>
        </div>
      )}
      {showManualRepair && (
        <section className="tool-panel manual-repair-panel">
          <div className="manual-repair-grid">
            <div>
              <h3>新增 / 更新人员</h3>
              <div className="candidate-fields">
                <Field label="姓名" value={manualPerson.name} onChange={(value) => setManualPerson((current) => ({ ...current, name: value }))} />
                <Field label="岗位" value={manualPerson.title} onChange={(value) => setManualPerson((current) => ({ ...current, title: value }))} />
                <Field label="部门" value={manualPerson.department} onChange={(value) => setManualPerson((current) => ({ ...current, department: value }))} />
                <Field label="公司" value={manualPerson.company} onChange={(value) => setManualPerson((current) => ({ ...current, company: value }))} />
              </div>
              <button type="button" className="primary-button" onClick={upsertManualPerson}>
                保存人员
              </button>
            </div>
            <div>
              <h3>新增汇报线</h3>
              <div className="candidate-fields compact-fields">
                <Field label="上级" value={manualLine.manager} onChange={(value) => setManualLine((current) => ({ ...current, manager: value }))} />
                <Field label="下级" value={manualLine.subordinate} onChange={(value) => setManualLine((current) => ({ ...current, subordinate: value }))} />
              </div>
              <button type="button" className="primary-button" onClick={addManualLine}>
                连接上下级
              </button>
            </div>
          </div>
        </section>
      )}

      {graph.truncated && <div className="inline-warning">当前筛选命中 {graph.totalBeforeLimit} 人，仅渲染前 {graph.renderedLimit} 个节点。</div>}

      <div
        className={
          showCallMapping
            ? 'map-canvas-shell has-call-panel'
            : selectedGraphNode
              ? 'map-canvas-shell has-inspector'
              : 'map-canvas-shell'
        }
      >
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
            onPaneClick={() => {
              setSelectedNodeId('');
              if (businessMode === 'recruiting' && filters.focusPersonName.trim()) {
                setFilters({ ...filters, focusPersonName: '' });
              }
            }}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
            }}
          >
            {businessMode === 'recruiting' && <MiniMap pannable zoomable />}
            <Controls />
          </ReactFlow>
        </div>

        {showCallMapping && businessMode === 'recruiting' && (
          <aside className="call-mapping-panel">
            <div className="org-inspector-head">
              <div>
                <span>通话补图</span>
                <h2>{activeCandidate?.name?.trim() || '新候选人'}</h2>
                <p>把候选人口中的组织信息先转成待确认补丁，再并入正式图。</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setShowCallMapping(false)} aria-label="关闭通话补图">
                <X size={16} />
              </button>
            </div>

            {existingCandidateMatch && (
              <div className="interview-inline-alert">
                <AlertTriangle size={15} />
                <span>图中已存在同名人员：{existingCandidateMatch.name}，确认前请先检查是否重复。</span>
              </div>
            )}

            {activeCandidate && activeInterview ? (
              <>
                <div className="interview-section">
                  <h3>候选人</h3>
                  <div className="candidate-fields call-mapping-grid">
                    <Field label="濮撳悕" value={activeCandidate.name} onChange={(value) => updateCandidateProfileField('name', value)} />
                    <Field label="公司" value={activeCandidate.company ?? ''} onChange={(value) => updateCandidateProfileField('company', value)} />
                    <Field
                      label="简历岗位"
                      value={activeCandidate.resumeTitle ?? ''}
                      onChange={(value) => updateCandidateProfileField('resumeTitle', value)}
                    />
                    <Field
                      label="简历部门"
                      value={activeCandidate.resumeDepartment ?? ''}
                      onChange={(value) => updateCandidateProfileField('resumeDepartment', value)}
                    />
                  </div>
                </div>

                <div className="interview-section">
                  <h3>通话记录</h3>
                  <div className="candidate-fields call-mapping-grid">
                    <Field
                      label="褰撳墠宀椾綅"
                      value={getInterviewFieldValue(interviewPreviewFields, 'currentTitle')}
                      onChange={(value) => updateInterviewFieldValue('currentTitle', value)}
                    />
                    <Field
                      label="当前部门"
                      value={getInterviewFieldValue(interviewPreviewFields, 'currentDepartment')}
                      onChange={(value) => updateInterviewFieldValue('currentDepartment', value)}
                    />
                    <Field
                      label="直属上级"
                      value={getInterviewFieldValue(interviewPreviewFields, 'managerName')}
                      onChange={(value) => updateInterviewFieldValue('managerName', value)}
                    />
                    <Field
                      label="部门一号位"
                      value={getInterviewFieldValue(interviewPreviewFields, 'departmentHead')}
                      onChange={(value) => updateInterviewFieldValue('departmentHead', value)}
                    />
                    <Field
                      label="团队规模"
                      value={getInterviewFieldValue(interviewPreviewFields, 'teamSize')}
                      onChange={(value) => updateInterviewFieldValue('teamSize', value)}
                    />
                    <Field
                      label="平级团队"
                      value={getInterviewFieldValue(interviewPreviewFields, 'peerTeams')}
                      onChange={(value) => updateInterviewFieldValue('peerTeams', value)}
                    />
                    <Field
                      label="下属情况"
                      value={getInterviewFieldValue(interviewPreviewFields, 'directReports')}
                      onChange={(value) => updateInterviewFieldValue('directReports', value)}
                    />
                    <Field
                      label="近期变化"
                      value={getInterviewFieldValue(interviewPreviewFields, 'recentChanges')}
                      onChange={(value) => updateInterviewFieldValue('recentChanges', value)}
                    />
                  </div>
                  <label className="field wide textarea-field">
                    <span>快捷输入 / 原始备注</span>
                    <textarea
                      rows={6}
                      value={activeInterview.rawNotes}
                      placeholder={'上级：张三\n部门：地图渲染引擎部\n岗位：高级地图算法专家\n团队：12人\n变化：Q1 裁员约 20%'}
                      onChange={(event) => updateInterviewRawNotes(event.target.value)}
                    />
                  </label>
                </div>

                <div className="interview-section">
                  <h3>挂载建议</h3>
                  {interviewSuggestions.length > 0 ? (
                    <div className="mount-suggestion-list">
                      {interviewSuggestions.map((suggestion, index) => (
                        <div key={`${suggestion.label}-${index}`} className="mount-suggestion-item">
                          <div className="mount-suggestion-head">
                            <strong>{suggestion.label}</strong>
                            <span className={`suggestion-confidence confidence-${suggestion.confidence}`}>
                              {suggestion.confidence === 'high' ? '高把握' : suggestion.confidence === 'medium' ? '可参考' : '待核实'}
                            </span>
                          </div>
                          <span>{suggestion.reason}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="interview-empty">先补充部门、上级或岗位信息，系统才能推荐挂载位置。</p>
                  )}
                </div>

                <div className="interview-section">
                  <h3>建议追问</h3>
                  {followUpPrompts.length > 0 ? (
                    <div className="follow-up-list">
                      {followUpPrompts.map((prompt) => (
                        <div key={prompt.id} className="follow-up-item">
                          <strong>{prompt.label}</strong>
                          <span>{prompt.hint}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="interview-empty">核心组织信息已经相对完整，可以直接生成补图建议。</p>
                  )}
                </div>

                <div className="interview-section">
                  <h3>待确认变更</h3>
                  {interviewPatches.length > 0 ? (
                    <div className="patch-list">
                      {interviewPatches.map((patch) => (
                        <div key={patch.id} className={`patch-item patch-${patch.status}`}>
                          <div className="patch-item-copy">
                            <strong>{mapPatchTypeLabel(patch.type)}</strong>
                            <span>{mapPatchSummary(patch)}</span>
                            <span>{patch.status === 'conflict' ? '与现有图冲突，建议人工复核' : '待确认并入正式图'}</span>
                          </div>
                          <div className="patch-actions">
                            {patch.status !== 'accepted' && (
                              <button type="button" className="secondary-button" onClick={() => updatePatchStatus(patch.id, 'accepted')}>
                                接受
                              </button>
                            )}
                            {patch.status !== 'rejected' && (
                              <button type="button" className="secondary-button" onClick={() => updatePatchStatus(patch.id, 'rejected')}>
                                蹇界暐
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="interview-empty">还没有待确认补丁，先生成补图建议。</p>
                  )}
                </div>

                <div className="interview-actions">
                  <button type="button" className="secondary-button" onClick={saveInterviewDraft}>
                    <Save size={16} />
                    保存草稿
                  </button>
                  <button type="button" className="secondary-button" onClick={generateInterviewPatches}>
                    <Users size={16} />
                    生成补图建议
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={acceptAllInterviewPatches}
                    disabled={pendingInterviewPatches.length === 0}
                  >
                    <Check size={16} />
                    确认并入图
                  </button>
                </div>
              </>
            ) : (
              <div className="interview-empty-state">
                <p>还没有通话草稿，点击工具栏里的“通话补图”后会自动为你创建一个。</p>
              </div>
            )}
          </aside>
        )}

        {!showCallMapping && selectedGraphNode && (
          <aside className="org-inspector">
            <div className="org-inspector-head">
              <div>
                <span>{selectedDepartment}</span>
                <h2>{selectedGraphNode.label}</h2>
                <p>{selectedGraphNode.title ?? '岗位待确认'}</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setSelectedNodeId('')} aria-label="关闭详情">
                <X size={16} />
              </button>
            </div>

            <div className="org-inspector-grid">
              <span>
                <strong>层级</strong>
                L{selectedGraphNode.depth}
              </span>
              <span>
                <strong>团队规模</strong>
                {Math.max(selectedGraphNode.descendantCount, selectedGraphNode.span, selectedGraphNode.visibleSpan)}
              </span>
              <span>
                <strong>直属</strong>
                {selectedGraphNode.visibleSpan}
              </span>
              <span>
                <strong>上级</strong>
                {selectedManager ?? '顶层负责人'}
              </span>
              <span>
                <strong>证据</strong>
                {selectedPersonRecord?.evidenceIds.length ?? selectedGraphNode.evidenceCount}
              </span>
              <span>
                <strong>更新</strong>
                {formatDate(selectedGraphNode.updatedAt)}
              </span>
            </div>

            {selectedDirectReports.length > 0 && (
              <div className="org-inspector-section">
                <h3>直属团队</h3>
                <div className="org-chip-grid">
                  {selectedDirectReports.map((name) => (
                    <span key={name}>{name}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="org-inspector-section">
              <h3>备注与变更</h3>
              <div className="node-remarks">
                {(selectedRemarks.length > 0 ? selectedRemarks : ['暂无备注']).map((remark, index) => (
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
            <h2>导出</h2>
            <span className="small-badge">{canvasViewLabel(state.project.settings.activeCanvasView)}</span>
          </div>
          <div className="button-row export-format-row">
            {([
              ['ppt16x9', 'PPT 16:9'],
              ['a4Landscape', 'A4 横版'],
              ['longImage', '长图'],
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
              导出 PPTX
            </button>
            <button type="button" className="secondary-button" onClick={exportPng}>
              <ImageDown size={16} />
              导出 PNG
            </button>
          </div>
          <div className="export-preview">
            <div className="preview-meta">
              <span>{previewGraph.nodes.length} 个节点 · {previewGraph.edges.length} 条线</span>
              <strong>使用当前画布布局</strong>
            </div>
            {previewImage ? (
              <>
                <img src={previewImage} alt="导出预览" className="export-preview-image" />
                <p>当前模式、筛选条件和手动画布布局会直接进入导出结果。</p>
              </>
            ) : (
              <p>暂无可导出的组织图，请先上传资料或打开虚拟演示 Demo。</p>
            )}
          </div>
        </section>

        <section className="tool-panel">
          <div className="section-heading">
            <h2>项目包</h2>
            <span className="small-badge">.mapping.zip</span>
          </div>
          <label className="field wide">
            <span>密码</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 6 个字符" />
          </label>
          <div className="button-row">
            <button type="button" className="primary-button" onClick={exportPackage}>
              <ShieldCheck size={16} />
              导出加密包
            </button>
            <label className="file-button">
              <Upload size={16} />
              导入加密包
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

