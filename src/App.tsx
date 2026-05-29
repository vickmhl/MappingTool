import {
  Archive,
  BarChart3,
  BriefcaseBusiness,
  Check,
  Clock3,
  Database,
  Download,
  FileText,
  Gauge,
  GitBranch,
  ImageDown,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Lock,
  Maximize2,
  MousePointer2,
  Move,
  Network,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Target,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { type CSSProperties, type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import { createDemoState, createEmptyState, createMapBusinessDemoState, ensureStateShape } from './data/seed';
import { buildOrgGraph, layoutIdForCanvasView } from './lib/graph';
import { importSourceFile } from './lib/importer';
import { clearPersistedState, loadPersistedState, persistState } from './lib/idb';
import { addImportResult, updateCandidateStatus } from './lib/merge';
import { exportEncryptedProjectPackage, importEncryptedProjectPackage } from './lib/projectPackage';
import { buildStaleEvents } from './lib/stale';
import { downloadBlob, exportOrgGraphPng, exportReportPptx } from './lib/exporters';
import { createId, normalizeName } from './lib/ids';
import { buildExecutiveNarrative } from './lib/insights';
import type {
  AnyCandidatePayload,
  AppState,
  AuditAction,
  CandidateKind,
  CandidateRecord,
  ChangeCandidatePayload,
  OrgMapFilters,
  OrgChartExportFormat,
  OrgChartMode,
  OrgUnitCandidatePayload,
  PersonCandidatePayload,
  ReportTemplateKey,
  ReportingCandidatePayload,
  RoleCandidatePayload,
  SensitivityLevel,
  SourceType,
} from './types';

type ViewKey = 'dashboard' | 'brief' | 'import' | 'review' | 'map' | 'people' | 'timeline' | 'export';
type BriefFocusMode = 'intern' | 'junior' | 'hrbp' | 'expert';

const navItems: Array<{ key: ViewKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: 'dashboard', label: '项目', icon: LayoutDashboard },
  { key: 'import', label: '导入', icon: Inbox },
  { key: 'review', label: '确认', icon: Check },
  { key: 'map', label: '组织图', icon: Network },
  { key: 'export', label: '导出', icon: Download },
];

const workflowSteps: Array<{ key: ViewKey; label: string; description: string }> = [
  { key: 'import', label: '1 导入资料', description: '上传文本或 PPTX' },
  { key: 'review', label: '2 确认识别', description: '检查人员和汇报线' },
  { key: 'map', label: '3 修组织图', description: '自动生成或手动修图' },
  { key: 'export', label: '4 导出分享', description: 'PPT / PNG / 项目包' },
];

const briefFocusCopy: Record<
  BriefFocusMode,
  { label: string; title: string; body: string; primaryView: ViewKey; primaryAction: string }
> = {
  intern: {
    label: '实习生速览',
    title: '先判断资料能不能用，再按提示处理候选。',
    body: '只保留结论、评分、下一步和导入质量，避免第一次打开就被完整咨询模块淹没。',
    primaryView: 'import',
    primaryAction: '导入/看资料',
  },
  junior: {
    label: '初级专员',
    title: '聚焦候选确认、重点人才池和高招作战清单。',
    body: '显示和日常执行强相关的模块：风险、缺口、人才名单、质量诊断。',
    primaryView: 'people',
    primaryAction: '看人员清单',
  },
  hrbp: {
    label: 'HRBP',
    title: '聚焦业务线、组织风险和管理层汇报口径。',
    body: '显示业务解释、公司/BU 对比、组织变化预警和汇报故事线。',
    primaryView: 'map',
    primaryAction: '看组织图',
  },
  expert: {
    label: '专业版',
    title: '显示全部咨询模块、权重、可信度和审计配置。',
    body: '适合 HRD、项目负责人或需要调整模型口径的人使用。',
    primaryView: 'export',
    primaryAction: '去导出',
  },
};

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
  minConfidence: 0.55,
  visibleLimit: 300,
  maxDepth: 2,
};

function formatDate(value?: string): string {
  if (!value) return '-';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function candidateSummary(candidate: CandidateRecord<AnyCandidatePayload>): string {
  const payload = candidate.payload;
  if ('personName' in payload && 'title' in payload) {
    return `${payload.personName} / ${payload.title}`;
  }
  if ('subordinateName' in payload) {
    return `${payload.subordinateName} -> ${payload.managerName}`;
  }
  if ('description' in payload) {
    return payload.description;
  }
  if ('name' in payload) {
    return payload.name;
  }
  return kindLabel[candidate.kind];
}

function evidenceStrength(confidence: number): { label: string; tone: 'strong' | 'medium' | 'weak' } {
  if (confidence >= 0.85) return { label: '强证据', tone: 'strong' };
  if (confidence >= 0.65) return { label: '待验证', tone: 'medium' };
  return { label: '弱证据', tone: 'weak' };
}

function daysSince(value?: string): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

function freshnessLabel(value?: string): { label: string; tone: 'fresh' | 'aging' | 'stale' } {
  const days = daysSince(value);
  if (days === null) return { label: '未知更新', tone: 'stale' };
  if (days <= 30) return { label: '30天内', tone: 'fresh' };
  if (days <= 180) return { label: `${days}天未更`, tone: 'aging' };
  return { label: `${days}天未更`, tone: 'stale' };
}

function canvasViewLabel(view: AppState['project']['settings']['activeCanvasView']): string {
  return {
    executive: '高管版',
    recruiting: '招聘版',
    detail: '详细版',
  }[view];
}

function orgChartModeLabel(mode: OrgChartMode): string {
  return {
    formal: '正式组织架构图',
    explore: '探索画布',
  }[mode];
}

function orgChartExportFormatLabel(format: OrgChartExportFormat): string {
  return {
    ppt16x9: 'PPT 16:9',
    a4Landscape: 'A4 横版',
    longImage: '长图',
  }[format];
}

const reportTemplatePresets: Record<
  ReportTemplateKey,
  {
    label: string;
    description: string;
    canvasView: AppState['project']['settings']['activeCanvasView'];
    chartMode: OrgChartMode;
    exportFormat: OrgChartExportFormat;
    filters: Pick<OrgMapFilters, 'minConfidence' | 'visibleLimit' | 'maxDepth'>;
    privacy: AppState['project']['settings']['exportPrivacy'];
  }
> = {
  executive: {
    label: '高层汇报',
    description: '聚焦一二级负责人、组织风险和管理口径。',
    canvasView: 'executive',
    chartMode: 'formal',
    exportFormat: 'ppt16x9',
    filters: { minConfidence: 0.75, visibleLimit: 120, maxDepth: 2 },
    privacy: { names: false, companies: false, sources: true, notes: false },
  },
  recruiting: {
    label: '招聘 Mapping',
    description: '保留姓名和岗位，方便筛选重点人才池。',
    canvasView: 'recruiting',
    chartMode: 'explore',
    exportFormat: 'longImage',
    filters: { minConfidence: 0.6, visibleLimit: 260, maxDepth: 3 },
    privacy: { names: false, companies: false, sources: false, notes: false },
  },
  diagnostic: {
    label: '组织诊断',
    description: '展开更多层级，暴露孤点、弱证据和冲突。',
    canvasView: 'detail',
    chartMode: 'formal',
    exportFormat: 'a4Landscape',
    filters: { minConfidence: 0.55, visibleLimit: 360, maxDepth: 5 },
    privacy: { names: false, companies: false, sources: false, notes: false },
  },
  external: {
    label: '外发脱敏',
    description: '严格脱敏姓名、公司、来源和备注。',
    canvasView: 'executive',
    chartMode: 'formal',
    exportFormat: 'ppt16x9',
    filters: { minConfidence: 0.85, visibleLimit: 80, maxDepth: 2 },
    privacy: { names: true, companies: true, sources: true, notes: true },
  },
};

function reportTemplateLabel(template: ReportTemplateKey): string {
  return reportTemplatePresets[template]?.label ?? '自定义模板';
}

function sensitivityLevelLabel(level: SensitivityLevel): string {
  return {
    internal: '内部协作',
    restricted: '受限汇报',
    external: '外发脱敏',
  }[level];
}

function applyReportTemplateToState(current: AppState, template: ReportTemplateKey): AppState {
  const preset = reportTemplatePresets[template];
  const timestamp = new Date().toISOString();
  return {
    ...current,
    project: {
      ...current.project,
      updatedAt: timestamp,
      settings: {
        ...current.project.settings,
        activeCanvasView: preset.canvasView,
        orgChartMode: preset.chartMode,
        orgChartExportFormat: preset.exportFormat,
        defaultVisibleNodeLimit: preset.filters.visibleLimit,
        reportTemplate: template,
        anonymizeExports: preset.privacy.names,
        exportPrivacy: preset.privacy,
      },
    },
  };
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
    project: {
      ...current.project,
      updatedAt: timestamp,
    },
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
    ].slice(0, 200),
  };
}

function riskToneLabel(tone: 'good' | 'warning' | 'danger'): string {
  return {
    good: '可控',
    warning: '需复核',
    danger: '阻断项',
  }[tone];
}

function nextWorkflowView(state: AppState, pendingCount: number): ViewKey {
  if (state.sources.length === 0) return 'import';
  if (pendingCount > 0 || state.people.length === 0) return 'review';
  if (state.reportingLines.length === 0) return 'map';
  return 'export';
}

function sourceHealth(source: AppState['sources'][number]): {
  label: string;
  tone: 'good' | 'warning' | 'danger';
  detail: string;
  action: string;
} {
  const warningText = (source.warnings ?? []).join(' ');
  if (source.totalChunks > 0 && !warningText) {
    return {
      label: '可识别',
      tone: 'good',
      detail: `已读取 ${source.totalChunks} 条文本片段${source.pages ? `，共 ${source.pages} 页` : ''}。`,
      action: '去确认识别结果',
    };
  }
  if (source.totalChunks > 0) {
    return {
      label: '部分可识别',
      tone: 'warning',
      detail: `读取到 ${source.totalChunks} 条文本片段，但有 ${source.warnings?.length ?? 0} 条提示需要复核。`,
      action: '先看预览，再人工确认',
    };
  }
  if (/截图|图片|OCR|未解析到/.test(warningText)) {
    return {
      label: '需要人工辅助',
      tone: 'danger',
      detail: '这份 PPT 可能是截图型组织图，浏览器不能直接读取形状和文字。',
      action: '开启 OCR 后重试，或在组织图页手动新增人员和汇报线',
    };
  }
  return {
    label: '未识别',
    tone: 'danger',
    detail: '没有读取到可抽取文本。',
    action: '请换文本型 PPT、转写文本，或使用手动修图',
  };
}

function App() {
  const [state, setState] = useState<AppState>(() => createEmptyState());
  const [activeView, setActiveView] = useState<ViewKey>('dashboard');
  const [loaded, setLoaded] = useState(false);
  const [importLog, setImportLog] = useState<string[]>([]);
  const [enableOcr, setEnableOcr] = useState(false);
  const [filters, setFilters] = useState<OrgMapFilters>(defaultFilters);
  const [password, setPassword] = useState('');
  const [toast, setToast] = useState<string>('');
  const saveTimer = useRef<number | undefined>();

  useEffect(() => {
    loadPersistedState()
      .then((persisted) => {
        if (persisted) {
          const hydrated = ensureStateShape(persisted);
          setState(hydrated);
          setFilters((current) => ({
            ...current,
            visibleLimit: hydrated.project.settings.defaultVisibleNodeLimit,
          }));
        }
      })
      .catch((error) => {
        setToast(`本地库读取失败：${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
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

  const staleEvents = useMemo(
    () => buildStaleEvents(state.people, state.project.settings.staleAfterDays),
    [state.people, state.project.settings.staleAfterDays],
  );

  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files?.length) return;
    const selected = [...files];
    setImportLog([]);
    let generatedCandidateCount = 0;

    for (const file of selected) {
      try {
        const result = await importSourceFile(file, {
          enableOcr,
          onProgress: (message) => setImportLog((log) => [`${file.name}: ${message}`, ...log].slice(0, 12)),
        });
        setState((current) =>
          appendAudit(
            addImportResult(current, result),
            'import',
            `导入 ${file.name}，生成 ${result.candidates.length} 条候选`,
            { entityCount: result.candidates.length, view: 'import', sourceName: file.name },
          ),
        );
        generatedCandidateCount += result.candidates.length;
        setImportLog((log) => [
          result.candidates.length > 0
            ? `${file.name}: 已生成 ${result.candidates.length} 条待确认结果，下一步请去“确认”。`
            : `${file.name}: 没有生成候选，请看文件体检提示；可重试 OCR 或手动修图。`,
          ...result.warnings,
          ...log,
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setImportLog((log) => [
          `${file.name}: 导入失败。请确认文件没有损坏，且是 .txt/.md/.pptx。原始错误：${message}`,
          ...log,
        ]);
      }
    }
    if (generatedCandidateCount > 0) setActiveView('review');
  }

  function decideCandidates(candidateIds: string[], status: 'accepted' | 'rejected'): void {
    setState((current) => {
      const selectedPendingCount = candidateIds.filter((id) =>
        current.candidates.some((candidate) => candidate.id === id && candidate.status === 'pending'),
      ).length;
      if (selectedPendingCount === 0) return current;
      return appendAudit(
        updateCandidateStatus(current, candidateIds, status),
        status === 'accepted' ? 'candidate-accepted' : 'candidate-rejected',
        `${status === 'accepted' ? '接受' : '忽略'} ${selectedPendingCount} 条候选`,
        { entityCount: selectedPendingCount, view: 'review' },
      );
    });
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

  async function resetProject(): Promise<void> {
    const confirmed = window.confirm('确定清空当前本地项目吗？此操作不会影响已导出的项目包。');
    if (!confirmed) return;
    await clearPersistedState();
    setState(createEmptyState());
    setToast('已清空本地项目。');
  }

  function loadSmallDemo(): void {
    const demo = createDemoState();
    setState(appendAudit(demo, 'demo-loaded', '载入小规模样例', { entityCount: demo.people.length, view: 'dashboard' }));
    setFilters({ ...defaultFilters, visibleLimit: demo.project.settings.defaultVisibleNodeLimit, maxDepth: 4 });
    setToast('已载入小规模样例。');
  }

  function loadMapBusinessDemo(): void {
    const demo = createMapBusinessDemoState();
    setState(appendAudit(demo, 'demo-loaded', '载入大规模地图业务虚拟样例', { entityCount: demo.people.length, view: 'map' }));
    setFilters({
      ...defaultFilters,
      visibleLimit: demo.project.settings.defaultVisibleNodeLimit,
      maxDepth: 2,
    });
    setActiveView('map');
    setToast('已载入大规模地图业务虚拟样例，可在组织图中继续展开层级。');
  }

  async function exportPackage(): Promise<void> {
    try {
      const blob = await exportEncryptedProjectPackage(state, password);
      downloadBlob(blob, `${state.project.name}.mapping.zip`);
      setState((current) => appendAudit(current, 'export', '导出加密项目包', { view: 'export' }));
      setToast('已导出加密项目包。');
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }

  async function importPackage(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const imported = ensureStateShape(await importEncryptedProjectPackage(file, password));
      setState(appendAudit(imported, 'project-imported', `导入加密项目包 ${file.name}`, { view: 'export', sourceName: file.name }));
      setToast('项目包已导入并保存在本地浏览器。');
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
          setState((current) => appendAudit(current, 'export', '导出组织图 PNG', { entityCount: graph.nodes.length, view: 'export' }));
        });
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }

  async function exportPptx(): Promise<void> {
    try {
      await exportReportPptx(state, filters);
      setState((current) => appendAudit(current, 'export', '导出管理汇报 PPTX', { entityCount: graph.nodes.length, view: 'export' }));
      setToast('PPTX 已生成。');
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }

  function applyReportTemplate(template: ReportTemplateKey): void {
    const preset = reportTemplatePresets[template];
    setState((current) =>
      appendAudit(applyReportTemplateToState(current, template), 'report-template-applied', `套用${preset.label}`, {
        view: activeView,
      }),
    );
    setFilters((current) => ({ ...current, ...preset.filters }));
    setToast(`已套用${preset.label}模板。`);
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
            <strong>本地处理</strong>
            <span>无后端上传，资料保存在浏览器 IndexedDB。</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <input
              className="project-name"
              value={state.project.name}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  project: { ...current.project, name: event.target.value, updatedAt: new Date().toISOString() },
                }))
              }
              aria-label="项目名称"
            />
            <p>
              {state.project.companies.length || 0} 家公司 · {state.people.length} 人 · {pendingCandidates.length}{' '}
              条待确认 · 更新于 {formatDate(state.project.updatedAt)}
            </p>
          </div>
          <div className="topbar-actions">
            <button type="button" className="secondary-button" onClick={loadSmallDemo}>
              <Database size={16} />
              小样例
            </button>
            <button type="button" className="secondary-button" onClick={loadMapBusinessDemo}>
              <Network size={16} />
              地图业务样例
            </button>
            <button type="button" className="icon-button danger" onClick={resetProject} title="清空本地项目">
              <Trash2 size={18} />
            </button>
          </div>
        </header>

        {toast && (
          <div className="toast" role="status">
            <span>{toast}</span>
            <button type="button" onClick={() => setToast('')} aria-label="关闭提示">
              <X size={16} />
            </button>
          </div>
        )}

        <WorkflowBar
          state={state}
          pendingCount={pendingCandidates.length}
          activeView={activeView}
          setActiveView={setActiveView}
        />

        {activeView === 'dashboard' && (
          <Dashboard state={state} pendingCount={pendingCandidates.length} setActiveView={setActiveView} />
        )}

        {activeView === 'brief' && (
          <ManagementBriefView
            state={state}
            setState={setState}
            setActiveView={setActiveView}
            applyReportTemplate={applyReportTemplate}
          />
        )}

        {activeView === 'import' && (
          <ImportView
            enableOcr={enableOcr}
            setEnableOcr={setEnableOcr}
            importLog={importLog}
            sources={state.sources}
            onFiles={handleFiles}
            setActiveView={setActiveView}
          />
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
          <OrgMapView state={state} setState={setState} filters={filters} setFilters={setFilters} graph={graph} />
        )}

        {activeView === 'people' && <PeopleView state={state} setState={setState} />}

        {activeView === 'timeline' && <TimelineView state={state} staleEvents={staleEvents} />}

        {activeView === 'export' && (
          <ExportView
            state={state}
            filters={filters}
            password={password}
            setPassword={setPassword}
            setState={setState}
            exportPackage={exportPackage}
            importPackage={importPackage}
            exportPng={exportPng}
            exportPptx={exportPptx}
            applyReportTemplate={applyReportTemplate}
          />
        )}
      </main>
    </div>
  );
}

function Dashboard({
  state,
  pendingCount,
  setActiveView,
}: {
  state: AppState;
  pendingCount: number;
  setActiveView: (view: ViewKey) => void;
}) {
  const acceptedCount =
    state.people.length + state.orgUnits.length + state.roleAssignments.length + state.reportingLines.length;
  const metrics = [
    { label: '资料源', value: state.sources.length, action: '导入资料', view: 'import' as ViewKey },
    { label: '待确认候选', value: pendingCount, action: '去确认', view: 'review' as ViewKey },
    { label: '人员', value: state.people.length, action: '看清单', view: 'people' as ViewKey },
    { label: '汇报线', value: state.reportingLines.length, action: '看组织图', view: 'map' as ViewKey },
  ];
  const weakCandidates = state.candidates.filter(
    (candidate) => candidate.status === 'pending' && candidate.confidence < 0.65,
  ).length;
  const talentCount = state.people.filter((person) => person.tags.includes('关键人才池')).length;
  const narrative = buildExecutiveNarrative(state);
  const riskCount = narrative.risks.filter((risk) => risk.tone !== 'good').length;
  const todos = [
    {
      label: state.sources.length === 0 ? '先导入一份转写文本或 PPTX' : '资料已导入，继续处理候选',
      view: state.sources.length === 0 ? ('import' as ViewKey) : ('review' as ViewKey),
      done: state.sources.length > 0 && pendingCount === 0,
    },
    {
      label: pendingCount > 0 ? `确认 ${pendingCount} 条候选，优先处理强证据` : '候选已处理，检查人员详情',
      view: pendingCount > 0 ? ('review' as ViewKey) : ('people' as ViewKey),
      done: pendingCount === 0 && state.people.length > 0,
    },
    {
      label: weakCandidates > 0 ? `复核 ${weakCandidates} 条弱证据，避免误入库` : '弱证据风险较低',
      view: 'review' as ViewKey,
      done: weakCandidates === 0,
    },
    {
      label: talentCount === 0 ? '标记重点人才池，方便高招 mapping' : `已标记 ${talentCount} 位重点人才`,
      view: 'people' as ViewKey,
      done: talentCount > 0,
    },
    {
      label: state.reportingLines.length > 0 ? '调整组织图画布并导出汇报' : '等待汇报线生成后再画组织图',
      view: state.reportingLines.length > 0 ? ('map' as ViewKey) : ('review' as ViewKey),
      done: false,
    },
  ];

  return (
    <section className="view-stack">
      <div className="metrics-grid">
        {metrics.map((metric) => (
          <button key={metric.label} type="button" className="metric-tile" onClick={() => setActiveView(metric.view)}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <em>{metric.action}</em>
          </button>
        ))}
      </div>

      <section className="tool-panel management-summary">
        <div className="section-heading">
          <h2>项目现在到哪一步了</h2>
          <span className="small-badge">按流程走，不用猜</span>
        </div>
        <div className="summary-line">
          <strong>{narrative.metrics.readinessScore}</strong>
          <div>
            <p>{narrative.headline}</p>
            <span>
              覆盖 {narrative.metrics.coverageScore} · 可信度 {narrative.metrics.confidenceScore} · 时效{' '}
              {narrative.metrics.freshnessScore} · 风险 {riskCount}
            </span>
          </div>
          <button type="button" className="primary-button" onClick={() => setActiveView(nextWorkflowView(state, pendingCount))}>
            <Target size={16} />
            继续下一步
          </button>
        </div>
      </section>

      <div className="two-column">
        <section className="tool-panel">
          <div className="section-heading">
            <h2>最近资料</h2>
            <button type="button" className="text-button" onClick={() => setActiveView('import')}>
              <Upload size={16} />
              导入
            </button>
          </div>
          <div className="record-list">
            {state.sources.slice(0, 5).map((source) => (
              <article className="record-row" key={source.id}>
                <FileText size={18} />
                <div>
                  <strong>{source.fileName}</strong>
                  <span>
                    {source.totalChunks} 条片段 · {formatDate(source.importedAt)}
                  </span>
                </div>
              </article>
            ))}
            {state.sources.length === 0 && <EmptyState title="先上传一份资料" body="支持转写文本、Markdown 和文本型 PPTX；截图型 PPT 会进入人工辅助流程。" />}
          </div>
        </section>

        <section className="tool-panel">
          <div className="section-heading">
            <h2>处理状态</h2>
            <span className="small-badge">{acceptedCount} 条已接受</span>
          </div>
          <div className="status-list">
            <StatusLine label="规则抽取" value={state.evidence.length > 0 ? '已运行' : '等待资料'} />
            <StatusLine label="证据保留" value={`${state.evidence.length} 条`} />
            <StatusLine label="本地存储" value="IndexedDB" />
            <StatusLine label="外部上传" value="无" tone="good" />
          </div>
        </section>
      </div>

      <section className="tool-panel">
        <div className="section-heading">
          <h2>3步极简引导</h2>
          <span className="small-badge">第一次使用</span>
        </div>
        <div className="quick-guide">
          <button type="button" onClick={() => setActiveView('import')}>
            <strong>1</strong>
            <span>导入资料</span>
          </button>
          <button type="button" onClick={() => setActiveView('review')}>
            <strong>2</strong>
            <span>确认候选</span>
          </button>
          <button type="button" onClick={() => setActiveView('export')}>
            <strong>3</strong>
            <span>导出汇报</span>
          </button>
        </div>
      </section>

      <section className="tool-panel">
        <div className="section-heading">
          <h2>下一步待办</h2>
          <span className="small-badge">给初级 HR 的操作顺序</span>
        </div>
        <div className="todo-strip">
          {todos.map((todo, index) => (
            <button key={todo.label} type="button" className={todo.done ? 'todo-item done' : 'todo-item'} onClick={() => setActiveView(todo.view)}>
              <strong>{index + 1}</strong>
              <span>{todo.label}</span>
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}

function WorkflowBar({
  state,
  pendingCount,
  activeView,
  setActiveView,
}: {
  state: AppState;
  pendingCount: number;
  activeView: ViewKey;
  setActiveView: (view: ViewKey) => void;
}) {
  const currentView = nextWorkflowView(state, pendingCount);
  const stepState = (step: ViewKey): 'done' | 'active' | 'todo' => {
    if (step === 'import') return state.sources.length > 0 ? 'done' : currentView === step ? 'active' : 'todo';
    if (step === 'review') {
      if (state.sources.length > 0 && pendingCount === 0 && state.people.length > 0) return 'done';
      return currentView === step ? 'active' : 'todo';
    }
    if (step === 'map') {
      if (state.reportingLines.length > 0) return 'done';
      return currentView === step ? 'active' : 'todo';
    }
    if (step === 'export') return currentView === step ? 'active' : 'todo';
    return 'todo';
  };

  return (
    <section className="workflow-bar" aria-label="工作流程">
      <div>
        <strong>当前建议：{workflowSteps.find((step) => step.key === currentView)?.label}</strong>
        <span>
          {state.sources.length === 0
            ? '先导入一份资料，系统会做文件体检和识别预览。'
            : pendingCount > 0
              ? `还有 ${pendingCount} 条结果等你确认。`
              : state.reportingLines.length === 0
                ? '还没有可用汇报线，可以在组织图页手动补线。'
                : '组织图已可导出，导出前请看发布检查。'}
        </span>
      </div>
      <div className="workflow-steps">
        {workflowSteps.map((step) => (
          <button
            key={step.key}
            type="button"
            className={`${stepState(step.key)} ${activeView === step.key ? 'selected' : ''}`}
            onClick={() => setActiveView(step.key)}
          >
            <strong>{step.label}</strong>
            <span>{step.description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ManagementBriefView({
  state,
  setState,
  setActiveView,
  applyReportTemplate,
}: {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState>>;
  setActiveView: (view: ViewKey) => void;
  applyReportTemplate: (template: ReportTemplateKey) => void;
}) {
  const [briefFocus, setBriefFocus] = useState<BriefFocusMode>('intern');
  const narrative = buildExecutiveNarrative(state);
  const metrics = narrative.metrics;
  const activeTemplate = state.project.settings.reportTemplate;
  const focusCopy = briefFocusCopy[briefFocus];
  const showIntern = briefFocus === 'intern';
  const showJunior = briefFocus === 'junior' || briefFocus === 'expert';
  const showHrbp = briefFocus === 'hrbp' || briefFocus === 'expert';
  const showExpert = briefFocus === 'expert';
  const riskCount = narrative.risks.filter((risk) => risk.tone !== 'good').length;
  const rawWeights = state.project.settings.insightWeights;
  const weightRows: Array<{
    key: keyof AppState['project']['settings']['insightWeights'];
    label: string;
    note: string;
  }> = [
    { key: 'coverage', label: '覆盖', note: '组织和汇报线完整度' },
    { key: 'confidence', label: '可信', note: '证据与关系置信度' },
    { key: 'freshness', label: '时效', note: '信息是否过期' },
    { key: 'confirmation', label: '确认', note: '候选闭环程度' },
  ];
  const sourceRows: Array<{ key: SourceType; label: string; note: string }> = [
    { key: 'text', label: '转写文本', note: '访谈、电话纪要' },
    { key: 'markdown', label: 'Markdown', note: '结构化笔记' },
    { key: 'pptx', label: 'PPTX', note: '历史组织图' },
    { key: 'ocr', label: 'OCR', note: '图片页识别' },
    { key: 'project', label: '项目包', note: '本地协作包' },
  ];
  const weightTotal = weightRows.reduce((sum, row) => sum + rawWeights[row.key], 0);
  const updateInsightWeight = (
    key: keyof AppState['project']['settings']['insightWeights'],
    value: number,
  ) => {
    setState((current) => ({
      ...current,
      project: {
        ...current.project,
        updatedAt: new Date().toISOString(),
        settings: {
          ...current.project.settings,
          insightWeights: {
            ...current.project.settings.insightWeights,
            [key]: value,
          },
        },
      },
    }));
  };
  const applyWeightPreset = (
    label: string,
    weights: AppState['project']['settings']['insightWeights'],
  ) => {
    setState((current) =>
      appendAudit(
        {
          ...current,
          project: {
            ...current.project,
            updatedAt: new Date().toISOString(),
            settings: {
              ...current.project.settings,
              insightWeights: weights,
            },
          },
        },
        'insight-weights-updated',
        `套用${label}评分权重`,
        { view: 'brief' },
      ),
    );
  };
  const markCurrentWeights = () => {
    setState((current) =>
      appendAudit(current, 'insight-weights-updated', `记录当前评分权重：${weightTotal} 总权重`, {
        view: 'brief',
      }),
    );
  };
  const updateSourceCredibility = (key: SourceType, value: number) => {
    setState((current) => ({
      ...current,
      project: {
        ...current.project,
        updatedAt: new Date().toISOString(),
        settings: {
          ...current.project.settings,
          sourceCredibility: {
            ...current.project.settings.sourceCredibility,
            [key]: value,
          },
        },
      },
    }));
  };
  const markSourceCredibility = () => {
    setState((current) =>
      appendAudit(current, 'source-credibility-updated', '记录当前来源可信度口径', { view: 'brief' }),
    );
  };
  const scoreRows = [
    { label: '覆盖度', value: metrics.coverageScore, detail: `任职 ${metrics.roleCoverageScore} · 汇报线 ${metrics.lineCoverageScore}` },
    { label: '可信度', value: metrics.confidenceScore, detail: `平均置信 ${metrics.averageConfidence}%` },
    { label: '时效性', value: metrics.freshnessScore, detail: `${metrics.stalePeopleCount} 位超期` },
    { label: '确认度', value: metrics.confirmationScore, detail: `${metrics.pendingCandidateCount} 条待确认` },
  ];
  const auditRows = (state.auditLog ?? []).slice(0, 8);

  return (
    <section className="view-stack">
      <section className="tool-panel brief-hero">
        <div>
          <span className="small-badge">{metrics.readinessLabel}</span>
          <h2>{narrative.headline}</h2>
          <p>
            当前模板：{reportTemplateLabel(activeTemplate)} · 建议模板：
            {reportTemplateLabel(narrative.templateAdvice.template)}
          </p>
        </div>
        <div className="readiness-score" style={{ '--score': `${metrics.readinessScore}%` } as CSSProperties}>
          <strong>{metrics.readinessScore}</strong>
          <span>准备度</span>
        </div>
        <div className="brief-actions">
          <button type="button" className="primary-button" onClick={() => applyReportTemplate(narrative.templateAdvice.template)}>
            <SlidersHorizontal size={16} />
            套用建议模板
          </button>
          <button type="button" className="secondary-button" onClick={() => setActiveView('map')}>
            <Network size={16} />
            看组织图
          </button>
          <button type="button" className="secondary-button" onClick={() => setActiveView('export')}>
            <Download size={16} />
            去导出
          </button>
        </div>
      </section>

      <section className="tool-panel brief-focus-panel">
        <div className="section-heading">
          <h2>首次使用视角</h2>
          <span className="small-badge">{focusCopy.label}</span>
        </div>
        <div className="brief-focus-tabs" role="group" aria-label="管理简报视角">
          {(Object.entries(briefFocusCopy) as Array<[BriefFocusMode, (typeof briefFocusCopy)[BriefFocusMode]]>).map(
            ([mode, copy]) => (
              <button
                key={mode}
                type="button"
                className={briefFocus === mode ? 'active' : ''}
                onClick={() => setBriefFocus(mode)}
              >
                {copy.label}
              </button>
            ),
          )}
        </div>
        <div className="brief-focus-summary">
          <div>
            <strong>{focusCopy.title}</strong>
            <p>{focusCopy.body}</p>
          </div>
          <button type="button" className="secondary-button" onClick={() => setActiveView(focusCopy.primaryView)}>
            <Target size={16} />
            {focusCopy.primaryAction}
          </button>
        </div>
      </section>

      <div className="score-grid">
        {scoreRows.map((row) => (
          <div className="score-tile" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
            <em>{row.detail}</em>
            <div className="score-meter">
              <i style={{ width: `${row.value}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="brief-grid">
        <section className="tool-panel">
          <div className="section-heading">
            <h2>咨询式摘要</h2>
            <span className="small-badge">So what / Now what</span>
          </div>
          <div className="brief-columns">
            <div>
              <h3>管理结论</h3>
              {narrative.summaryBullets.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
            <div>
              <h3>下一步动作</h3>
              {narrative.nextActions.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </div>
        </section>

        <section className="tool-panel">
          <div className="section-heading">
            <h2>风险雷达</h2>
            <span className={riskCount > 0 ? 'small-badge warning' : 'small-badge'}>{riskCount} 项需关注</span>
          </div>
          <div className="risk-list">
            {narrative.risks.map((risk) => (
              <article className={`risk-item ${risk.tone}`} key={`${risk.title}-${risk.body}`}>
                <span>{riskToneLabel(risk.tone)}</span>
                <div>
                  <strong>{risk.title}</strong>
                  <p>{risk.body}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      {!showIntern && (
      <section className="tool-panel">
        <div className="section-heading">
          <h2>人才机会与业务解释</h2>
          <span className="small-badge">从数据到判断</span>
        </div>
        <div className="signal-grid">
          {narrative.businessSignals.map((signal) => (
            <article className={`signal-card ${signal.tone}`} key={signal.title}>
              <div className="signal-head">
                <strong>{signal.title}</strong>
                <span>{signal.impact}影响</span>
              </div>
              <p>{signal.interpretation}</p>
              <em>{signal.recommendedAction}</em>
            </article>
          ))}
        </div>
      </section>
      )}

      {showHrbp && (
      <div className="brief-grid">
        <section className="tool-panel">
          <div className="section-heading">
            <h2>战略业务线地图</h2>
            <span className="small-badge">{narrative.businessLines.length} 条业务线</span>
          </div>
          <div className="business-line-grid">
            {narrative.businessLines.map((line) => (
              <article className={`business-line-card ${line.tone}`} key={line.name}>
                <strong>{line.name}</strong>
                <span>{line.strategicTag}</span>
                <p>
                  {line.peopleCount} 人 · 管理者 {line.managerCount} · 重点人才 {line.talentCount}
                </p>
                <em>{line.note}</em>
              </article>
            ))}
          </div>
        </section>

        <section className="tool-panel">
          <div className="section-heading">
            <h2>公司/BU 对比</h2>
            <span className="small-badge">{narrative.comparisonRows.length} 个对象</span>
          </div>
          <div className="compact-table">
            <div className="compact-head">
              <span>对象</span>
              <span>人员</span>
              <span>组织</span>
              <span>密度</span>
            </div>
            {narrative.comparisonRows.map((row) => (
              <article className="compact-row" key={row.name}>
                <strong>{row.name}</strong>
                <span>{row.peopleCount}</span>
                <span>{row.orgUnitCount}</span>
                <em>{row.densityLabel}</em>
              </article>
            ))}
          </div>
        </section>
      </div>
      )}

      {showJunior && (
      <div className="brief-grid">
        <section className="tool-panel">
          <div className="section-heading">
            <h2>关键岗位缺口地图</h2>
            <span className="small-badge">{narrative.positionGaps.length} 项</span>
          </div>
          <div className="gap-list">
            {narrative.positionGaps.map((gap) => (
              <article className={`gap-row ${gap.priority.toLowerCase()}`} key={`${gap.area}-${gap.gap}`}>
                <span>{gap.priority}</span>
                <div>
                  <strong>{gap.area} · {gap.gap}</strong>
                  <p>{gap.evidence}</p>
                  <em>{gap.recommendedAction}</em>
                </div>
              </article>
            ))}
            {narrative.positionGaps.length === 0 && <EmptyState title="暂无关键缺口" body="当前业务线、重点人才和汇报线没有明显缺口。" />}
          </div>
        </section>

        <section className="tool-panel">
          <div className="section-heading">
            <h2>高招作战清单</h2>
            <span className="small-badge">{narrative.recruitingActions.length} 人</span>
          </div>
          <div className="recruiting-list">
            {narrative.recruitingActions.map((action) => (
              <article className="recruiting-row" key={action.personName}>
                <span className={`priority-dot ${action.priority}`}>{action.priority}</span>
                <div>
                  <strong>{action.personName} · {action.level}</strong>
                  <p>{action.department} · {action.title}</p>
                  <em>{action.reason}；{action.nextStep}</em>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
      )}

      {showHrbp && (
      <div className="brief-grid">
        <section className="tool-panel">
          <div className="section-heading">
            <h2>人才流动热力图</h2>
            <span className="small-badge">{metrics.recentChangeCount} 条近期变更</span>
          </div>
          <div className="movement-list">
            {narrative.movementHeatmap.map((row) => (
              <article className="movement-row" key={row.label}>
                <strong>{row.label}</strong>
                <span>新增 {row.newCount}</span>
                <span>调岗 {row.transferCount}</span>
                <span>离职 {row.resignedCount}</span>
                <span>汇报变化 {row.reportingChangeCount}</span>
              </article>
            ))}
            {narrative.movementHeatmap.length === 0 && <EmptyState title="暂无流动信号" body="接受新增、离职、调岗或汇报变化候选后会生成热力图。" />}
          </div>
        </section>

        <section className="tool-panel">
          <div className="section-heading">
            <h2>组织变化预警</h2>
            <span className="small-badge">{narrative.changeAlerts.length} 条</span>
          </div>
          <div className="alert-list">
            {narrative.changeAlerts.map((alert) => (
              <article className={`alert-card ${alert.tone}`} key={alert.title}>
                <strong>{alert.title}</strong>
                <p>{alert.detail}</p>
                <em>{alert.ownerHint}</em>
              </article>
            ))}
          </div>
        </section>
      </div>
      )}

      {!showIntern && (
      <div className="brief-grid">
        <section className="tool-panel">
          <div className="section-heading">
            <h2>证据健康度</h2>
            <span className="small-badge">{metrics.evidenceCount} 条证据</span>
          </div>
          <div className="evidence-dashboard">
            {narrative.evidenceBuckets.map((bucket) => (
              <div className={`evidence-stat ${bucket.tone}`} key={bucket.label}>
                <span>{bucket.label}</span>
                <strong>{bucket.value}</strong>
              </div>
            ))}
          </div>
          <div className="method-grid">
            <div>
              <Gauge size={17} />
              <span>准备度 = 覆盖、可信度、时效和确认度加权。</span>
            </div>
            <div>
              <Target size={17} />
              <span>组织风险优先看弱信号、孤点、管理跨度和口径冲突。</span>
            </div>
            <div>
              <ListChecks size={17} />
              <span>高招使用前先锁定重点人才池，再按团队焦点展开。</span>
            </div>
          </div>
        </section>

        <section className="tool-panel">
          <div className="section-heading">
            <h2>汇报模板</h2>
            <span className="small-badge">{reportTemplateLabel(activeTemplate)}</span>
          </div>
          <div className="template-grid">
            {(Object.entries(reportTemplatePresets) as Array<[ReportTemplateKey, (typeof reportTemplatePresets)[ReportTemplateKey]]>).map(
              ([template, preset]) => (
                <button
                  key={template}
                  type="button"
                  className={activeTemplate === template ? 'template-button active' : 'template-button'}
                  onClick={() => applyReportTemplate(template)}
                >
                  <strong>{preset.label}</strong>
                  <span>{preset.description}</span>
                  <em>
                    {canvasViewLabel(preset.canvasView)} · {preset.filters.maxDepth} 层 · {preset.filters.visibleLimit} 节点
                  </em>
                </button>
              ),
            )}
          </div>
        </section>
      </div>
      )}

      {showExpert && (
      <section className="tool-panel">
        <div className="section-heading">
          <h2>评分权重</h2>
          <span className="small-badge">总权重 {weightTotal}</span>
        </div>
        <div className="weight-presets">
          <button
            type="button"
            onClick={() => applyWeightPreset('管理汇报', { coverage: 34, confidence: 30, freshness: 22, confirmation: 14 })}
          >
            管理汇报
          </button>
          <button
            type="button"
            onClick={() => applyWeightPreset('高招 Mapping', { coverage: 24, confidence: 26, freshness: 30, confirmation: 20 })}
          >
            高招 Mapping
          </button>
          <button
            type="button"
            onClick={() => applyWeightPreset('组织诊断', { coverage: 38, confidence: 22, freshness: 16, confirmation: 24 })}
          >
            组织诊断
          </button>
          <button type="button" onClick={markCurrentWeights}>
            记录当前口径
          </button>
        </div>
        <div className="weight-grid">
          {weightRows.map((row) => (
            <label className="weight-row" key={row.key}>
              <span>
                <strong>{row.label}</strong>
                <em>{row.note}</em>
              </span>
              <input
                type="range"
                min="0"
                max="60"
                value={rawWeights[row.key]}
                onChange={(event) => updateInsightWeight(row.key, Number(event.target.value))}
              />
              <b>{rawWeights[row.key]}</b>
            </label>
          ))}
        </div>
        <p className="panel-note">
          系统会按各项权重占总权重的比例计算准备度，适合 HRD 在管理汇报、高招和组织诊断场景中调整判断口径。
        </p>
      </section>
      )}

      <div className="brief-grid">
        <section className="tool-panel">
          <div className="section-heading">
            <h2>导入质量诊断</h2>
            <span className="small-badge">{narrative.importQuality.length} 个来源</span>
          </div>
          <div className="quality-list">
            {narrative.importQuality.slice(0, 6).map((source) => (
              <article className="quality-row" key={source.sourceName}>
                <strong>{source.sourceName}</strong>
                <span>{source.type.toUpperCase()} · {source.qualityScore}分</span>
                <p>
                  证据 {source.evidenceCount} · 候选 {source.candidateCount} · 警告 {source.warningCount}
                </p>
                <em>{source.suggestion}</em>
              </article>
            ))}
            {narrative.importQuality.length === 0 && <EmptyState title="暂无导入诊断" body="导入资料后会评估证据、候选和警告质量。" />}
          </div>
        </section>

        {showExpert ? (
        <section className="tool-panel">
          <div className="section-heading">
            <h2>来源可信度</h2>
            <button type="button" className="text-button compact" onClick={markSourceCredibility}>
              记录口径
            </button>
          </div>
          <div className="source-weight-grid">
            {sourceRows.map((row) => (
              <label className="source-weight-row" key={row.key}>
                <span>
                  <strong>{row.label}</strong>
                  <em>{row.note}</em>
                </span>
                <input
                  type="range"
                  min="20"
                  max="100"
                  value={state.project.settings.sourceCredibility[row.key]}
                  onChange={(event) => updateSourceCredibility(row.key, Number(event.target.value))}
                />
                <b>{state.project.settings.sourceCredibility[row.key]}</b>
              </label>
            ))}
          </div>
        </section>
        ) : (
        <section className="tool-panel">
          <div className="section-heading">
            <h2>新手只看这些</h2>
            <span className="small-badge">低负荷</span>
          </div>
          <div className="starter-list">
            {narrative.nextActions.slice(0, 4).map((item, index) => (
              <button
                key={item}
                type="button"
                onClick={() => setActiveView(index === 0 ? 'review' : focusCopy.primaryView)}
              >
                <strong>{index + 1}</strong>
                <span>{item}</span>
              </button>
            ))}
          </div>
        </section>
        )}
      </div>

      {showHrbp && (
      <div className="brief-grid">
        <section className="tool-panel">
          <div className="section-heading">
            <h2>假设与口径</h2>
            <span className="small-badge">汇报备注</span>
          </div>
          <div className="assumption-list">
            {narrative.assumptions.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        </section>

        <section className="tool-panel">
          <div className="section-heading">
            <h2>汇报故事线</h2>
            <span className="small-badge">{reportTemplateLabel(activeTemplate)}</span>
          </div>
          <div className="storyline-list">
            {narrative.storyline.map((item, index) => (
              <div key={item}>
                <strong>{index + 1}</strong>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      )}

      {showExpert && (
      <section className="tool-panel">
        <div className="section-heading">
          <h2>操作审计</h2>
          <span className="small-badge">最近 {auditRows.length} 条</span>
        </div>
        <div className="audit-list">
          {auditRows.map((entry) => (
            <article className="audit-row" key={entry.id}>
              <span>{formatDate(entry.createdAt)}</span>
              <strong>{entry.description}</strong>
              <em>{entry.entityCount ? `${entry.entityCount} 项` : entry.view ?? '本地操作'}</em>
            </article>
          ))}
          {auditRows.length === 0 && <EmptyState title="暂无审计记录" body="导入、确认、套用模板和导出后会生成本地审计记录。" />}
        </div>
      </section>
      )}
    </section>
  );
}

function ImportView({
  enableOcr,
  setEnableOcr,
  importLog,
  sources,
  onFiles,
  setActiveView,
}: {
  enableOcr: boolean;
  setEnableOcr: (value: boolean) => void;
  importLog: string[];
  sources: AppState['sources'];
  onFiles: (files: FileList | null) => void;
  setActiveView: (view: ViewKey) => void;
}) {
  return (
    <section className="view-stack">
      <section className="tool-panel import-primer">
        <div>
          <span className="small-badge">第 1 步</span>
          <h2>先让系统判断文件能不能识别</h2>
          <p>
            文本型 PPT 和转写文本会自动抽取人员、岗位、部门和汇报线；截图型组织图会先给出体检结论，再引导你 OCR 或手动补线。
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={() => setActiveView('map')}>
          <Network size={16} />
          直接手动修图
        </button>
      </section>

      <div className="drop-zone">
        <Upload size={30} />
        <h2>导入转写文本或 PPTX</h2>
        <p>支持 .txt、.md、.pptx。文件只在浏览器中读取，不上传服务器。截图型 PPT 不会硬撑自动识别，会进入人工辅助。</p>
        <input
          type="file"
          multiple
          accept=".txt,.md,.pptx"
          onChange={(event) => void onFiles(event.target.files)}
          aria-label="选择资料文件"
        />
        <label className="toggle-line">
          <input type="checkbox" checked={enableOcr} onChange={(event) => setEnableOcr(event.target.checked)} />
          <span>对 PPT 图片尝试本地 OCR（速度较慢，结果需要人工确认）</span>
        </label>
      </div>

      <div className="two-column">
        <section className="tool-panel">
          <div className="section-heading">
            <h2>导入日志</h2>
            <span className="small-badge">{importLog.length}</span>
          </div>
          <div className="log-box">
            {importLog.map((entry, index) => (
              <p key={`${entry}-${index}`}>{entry}</p>
            ))}
            {importLog.length === 0 && <p>导入后会在这里显示解析、OCR 和候选生成情况。</p>}
          </div>
        </section>

        <section className="tool-panel">
          <div className="section-heading">
            <h2>已导入资料</h2>
            <span className="small-badge">{sources.length}</span>
          </div>
          <div className="record-list">
            {sources.map((source) => (
              <article className="source-card" key={source.id}>
                <div className="source-card-head">
                  <strong>{source.fileName}</strong>
                  <span className={`health-pill ${sourceHealth(source).tone}`}>{sourceHealth(source).label}</span>
                </div>
                <span>
                  {source.type.toUpperCase()} · {source.totalChunks} 条片段 · {formatDate(source.importedAt)}
                </span>
                <div className="file-health">
                  <p>{sourceHealth(source).detail}</p>
                  <em>{sourceHealth(source).action}</em>
                </div>
                <p>{source.textPreview || '无文本预览'}</p>
                {source.warnings?.map((warning) => (
                  <em key={warning}>{warning}</em>
                ))}
              </article>
            ))}
            {sources.length === 0 && (
              <EmptyState title="还没有文件" body="上传后这里会显示文件体检：可识别、部分可识别，或需要人工辅助。" />
            )}
          </div>
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
  const [sourceFilter, setSourceFilter] = useState('all');
  const sourceOptions = [...new Set(candidates.map((candidate) => candidate.sourceName))];
  const kindCounts = (Object.keys(kindLabel) as CandidateKind[]).map((kind) => ({
    kind,
    label: kindLabel[kind],
    count: candidates.filter((candidate) => candidate.kind === kind).length,
  }));
  const strongCount = candidates.filter((candidate) => candidate.confidence >= 0.8).length;
  const weakCount = candidates.filter((candidate) => candidate.confidence < 0.55).length;
  const visibleCandidates = candidates
    .filter((candidate) => kindFilter === 'all' || candidate.kind === kindFilter)
    .filter((candidate) => sourceFilter === 'all' || candidate.sourceName === sourceFilter)
    .slice(0, 120);
  const highConfidenceIds = visibleCandidates
    .filter((candidate) => candidate.confidence >= 0.8)
    .map((candidate) => candidate.id);
  const highConfidenceRoleIds = visibleCandidates
    .filter((candidate) => candidate.kind === 'roleAssignment' && candidate.confidence >= 0.75)
    .map((candidate) => candidate.id);
  const lowConfidenceIds = visibleCandidates
    .filter((candidate) => candidate.confidence < 0.55)
    .map((candidate) => candidate.id);
  const conflictHints = useMemo(() => {
    const byPerson = new Map<string, CandidateRecord<AnyCandidatePayload>[]>();
    for (const candidate of visibleCandidates) {
      if (candidate.kind !== 'roleAssignment') continue;
      const payload = candidate.payload;
      if (!('personName' in payload) || !('title' in payload)) continue;
      const rows = byPerson.get(payload.personName) ?? [];
      rows.push(candidate);
      byPerson.set(payload.personName, rows);
    }
    return [...byPerson.entries()]
      .map(([name, rows]) => {
        const signatures = new Set(
          rows.map((item) => {
            const payload = item.payload as RoleCandidatePayload;
            return `${payload.title}|${payload.orgUnitName ?? ''}|${payload.company ?? ''}`;
          }),
        );
        return signatures.size > 1 ? { name, rows } : null;
      })
      .filter(Boolean)
      .slice(0, 5) as Array<{ name: string; rows: CandidateRecord<AnyCandidatePayload>[] }>;
  }, [visibleCandidates]);
  const [conflictSelections, setConflictSelections] = useState<Record<string, string>>({});

  return (
    <section className="view-stack">
      <section className="tool-panel recognition-preview">
        <div className="section-heading">
          <h2>识别结果预览</h2>
          <span className="small-badge">第 2 步：先确认，再入图</span>
        </div>
        <div className="recognition-grid">
          {kindCounts.map((item) => (
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
        <p className="panel-note">
          系统只把这里“接受”的结果写入组织图。强证据 {strongCount} 条，弱证据 {weakCount} 条；弱证据建议先看原文，不要一键入库。
        </p>
      </section>

      <div className="toolbar">
        <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as CandidateKind | 'all')}>
          <option value="all">全部候选</option>
          {Object.entries(kindLabel).map(([kind, label]) => (
            <option key={kind} value={kind}>
              {label}
            </option>
          ))}
        </select>
        <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
          <option value="all">全部来源</option>
          {sourceOptions.map((sourceName) => (
            <option key={sourceName} value={sourceName}>
              {sourceName}
            </option>
          ))}
        </select>
        <button type="button" className="secondary-button" onClick={() => onAccept(highConfidenceIds)} disabled={!highConfidenceIds.length}>
          <Check size={16} />
          接受高置信
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onAccept(highConfidenceRoleIds)}
          disabled={!highConfidenceRoleIds.length}
        >
          <Check size={16} />
          接受高置信任职
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onReject(lowConfidenceIds)}
          disabled={!lowConfidenceIds.length}
        >
          <X size={16} />
          忽略弱证据
        </button>
        <span className="muted-text">显示前 {visibleCandidates.length} 条，剩余可通过筛选处理。</span>
      </div>

      {conflictHints.length > 0 && (
        <div className="conflict-helper">
          <strong>冲突/重复助手</strong>
          {conflictHints.map((hint) => (
            <div className="conflict-chip" key={hint.name}>
              <span>
                {hint.name} 有 {hint.rows.length} 条不同任职候选，请先核对岗位、部门和来源。
              </span>
              <select
                value={conflictSelections[hint.name] ?? [...hint.rows].sort((a, b) => b.confidence - a.confidence)[0]?.id ?? ''}
                onChange={(event) =>
                  setConflictSelections((current) => ({
                    ...current,
                    [hint.name]: event.target.value,
                  }))
                }
              >
                {hint.rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {candidateSummary(row)} · {Math.round(row.confidence * 100)}%
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  const selectedId =
                    conflictSelections[hint.name] ??
                    [...hint.rows].sort((a, b) => b.confidence - a.confidence)[0]?.id;
                  if (selectedId) onAccept([selectedId]);
                  const rejectedIds = hint.rows.map((item) => item.id).filter((id) => id !== selectedId);
                  if (rejectedIds.length > 0) onReject(rejectedIds);
                }}
              >
                保留所选
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="candidate-list">
        {visibleCandidates.map((candidate) => (
          <article className="candidate-card" key={candidate.id}>
            <div className="candidate-main">
              <div className="candidate-title">
                <span className="kind-pill">{kindLabel[candidate.kind]}</span>
                <strong>{candidateSummary(candidate)}</strong>
                <em>{Math.round(candidate.confidence * 100)}%</em>
                <span className={`evidence-pill ${evidenceStrength(candidate.confidence).tone}`}>
                  {evidenceStrength(candidate.confidence).label}
                </span>
              </div>
              <CandidateEditor candidate={candidate} onFieldChange={onFieldChange} />
              <blockquote>{candidate.evidenceText}</blockquote>
              <small>
                {candidate.sourceName} · {candidate.reason}
              </small>
            </div>
            <div className="candidate-actions">
              <button type="button" className="primary-button" onClick={() => onAccept([candidate.id])}>
                <Check size={16} />
                接受
              </button>
              <button type="button" className="secondary-button" onClick={() => onReject([candidate.id])}>
                <X size={16} />
                忽略
              </button>
            </div>
          </article>
        ))}
        {visibleCandidates.length === 0 && <EmptyState title="没有待确认候选" body="导入资料或降低筛选条件后会显示候选。" />}
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

  if ('personName' in payload && 'title' in payload) {
    const role = payload as RoleCandidatePayload;
    return (
      <div className="candidate-fields">
        <Field label="姓名" value={role.personName} onChange={(value) => onFieldChange(candidate.id, 'personName', value)} />
        <Field label="岗位" value={role.title} onChange={(value) => onFieldChange(candidate.id, 'title', value)} />
        <Field label="部门" value={role.orgUnitName ?? ''} onChange={(value) => onFieldChange(candidate.id, 'orgUnitName', value)} />
        <Field label="公司" value={role.company ?? ''} onChange={(value) => onFieldChange(candidate.id, 'company', value)} />
      </div>
    );
  }

  if ('subordinateName' in payload) {
    const line = payload as ReportingCandidatePayload;
    return (
      <div className="candidate-fields">
        <Field label="下级" value={line.subordinateName} onChange={(value) => onFieldChange(candidate.id, 'subordinateName', value)} />
        <Field label="上级" value={line.managerName} onChange={(value) => onFieldChange(candidate.id, 'managerName', value)} />
      </div>
    );
  }

  if ('description' in payload) {
    const change = payload as ChangeCandidatePayload;
    return (
      <div className="candidate-fields">
        <Field label="人员" value={change.personName ?? ''} onChange={(value) => onFieldChange(candidate.id, 'personName', value)} />
        <Field label="说明" value={change.description} onChange={(value) => onFieldChange(candidate.id, 'description', value)} />
        <Field label="日期" value={change.date ?? ''} onChange={(value) => onFieldChange(candidate.id, 'date', value)} />
      </div>
    );
  }

  if ('name' in payload) {
    const personOrOrg = payload as PersonCandidatePayload | OrgUnitCandidatePayload;
    return (
      <div className="candidate-fields">
        <Field label="名称" value={personOrOrg.name} onChange={(value) => onFieldChange(candidate.id, 'name', value)} />
        <Field label="公司" value={personOrOrg.company ?? ''} onChange={(value) => onFieldChange(candidate.id, 'company', value)} />
      </div>
    );
  }

  return null;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function OrgMapView({
  state,
  setState,
  filters,
  setFilters,
  graph,
}: {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState>>;
  filters: OrgMapFilters;
  setFilters: (filters: OrgMapFilters) => void;
  graph: ReturnType<typeof buildOrgGraph>;
}) {
  const [editMode, setEditMode] = useState(false);
  const [reportMode, setReportMode] = useState(false);
  const [timeView, setTimeView] = useState<'current' | 'changes90'>('current');
  const [manualPerson, setManualPerson] = useState({ name: '', title: '', department: '', company: '' });
  const [manualLine, setManualLine] = useState({ manager: '', subordinate: '' });
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);
  const reportFiltersRef = useRef<Pick<OrgMapFilters, 'visibleLimit' | 'maxDepth'> | null>(null);
  const chartMode = state.project.settings.orgChartMode ?? 'formal';
  const isFormalChart = chartMode === 'formal';
  const canManualEdit = chartMode === 'explore' && editMode;
  const activeLayoutId = layoutIdForCanvasView(state.project.settings.activeCanvasView);
  const savedPositions = state.canvasLayouts?.[activeLayoutId]?.nodes ?? {};
  const savedCount = graph.nodes.filter((node) => savedPositions[node.id]).length;
  const changedPeople = useMemo(() => {
    const names = new Set<string>();
    for (const event of state.changeEvents) {
      if (!event.personName) continue;
      const time = new Date(event.date ?? event.createdAt).getTime();
      if (Number.isFinite(time) && Date.now() - time <= 90 * 86_400_000) {
        names.add(event.personName);
      }
    }
    return names;
  }, [state.changeEvents]);
  const focusOptions = useMemo(() => {
    const managerNames = new Set(state.reportingLines.filter((line) => line.isCurrent).map((line) => line.managerName));
    return state.people
      .filter((person) => managerNames.has(person.name))
      .slice(0, 240)
      .map((person) => person.name);
  }, [state.people, state.reportingLines]);
  const commitFocusPerson = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setFilters({ ...filters, focusPersonName: '' });
      return;
    }
    const exact = focusOptions.find((name) => name === trimmed);
    const fuzzy = focusOptions.find((name) => name.includes(trimmed) || trimmed.includes(name));
    setFilters({ ...filters, focusPersonName: exact ?? fuzzy ?? trimmed });
  };
  const updateChartMode = (mode: OrgChartMode) => {
    if (mode === 'formal') setEditMode(false);
    if (mode === 'explore') setEditMode(true);
    setState((current) => ({
      ...current,
      project: {
        ...current.project,
        updatedAt: new Date().toISOString(),
        settings: {
          ...current.project.settings,
          orgChartMode: mode,
        },
      },
    }));
    window.setTimeout(() => flowInstance?.fitView({ duration: 280 }), 60);
  };
  const upsertManualPerson = (input: typeof manualPerson) => {
    const name = input.name.trim();
    if (!name) return;
    const timestamp = new Date().toISOString();
    setState((current) => {
      const next: AppState = structuredClone(current);
      const existing = next.people.find((person) => normalizeName(person.name) === normalizeName(name));
      const company = input.company.trim() || existing?.company || next.project.companies[0] || '待确认公司';
      const department = input.department.trim() || existing?.currentDepartment;
      const title = input.title.trim() || existing?.currentTitle;
      if (existing) {
        existing.company = company;
        existing.currentDepartment = department;
        existing.currentTitle = title;
        existing.status = existing.status === 'left' ? 'left' : 'active';
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
    () => {
      const laneNodes: Node[] = isFormalChart
        ? graph.lanes.map((lane) => ({
            id: lane.id,
            position: { x: lane.x, y: lane.y },
            data: {
              label: (
                <div className="org-lane-label">
                  <strong>{lane.label}</strong>
                  <span>
                    {lane.headcount} 人 · {lane.managerCount} 管理者 · {lane.talentCount} 重点
                  </span>
                </div>
              ),
            },
            type: 'default',
            draggable: false,
            selectable: false,
            style: {
              width: lane.width,
              height: lane.height,
              zIndex: -1,
            },
            className: 'org-lane-node',
          }))
        : [];
      const personNodes = graph.nodes.map((node) => {
        const isChanged = timeView === 'changes90' && (node.changeCount > 0 || changedPeople.has(node.label));
        const confidenceTone = node.averageConfidence >= 0.85 ? 'strong' : node.averageConfidence >= 0.7 ? 'medium' : 'weak';
        return {
        id: node.id,
        position: { x: node.x, y: node.y },
        data: {
          label: (
            <div
              className={[
                'flow-node',
                node.status === 'left' ? 'left' : '',
                isFormalChart ? 'formal' : '',
                reportMode ? 'report' : '',
                node.isFocus ? 'focus' : '',
                isChanged ? 'changed' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className="flow-node-top">
                <strong>{node.label}</strong>
                {node.isTalent && <Star size={13} />}
                <small>{node.levelLabel}</small>
              </div>
              <span>{node.title ?? '职位待确认'}</span>
              <em>{node.department ?? node.company ?? '组织待确认'}</em>
              <div className="flow-node-meta">
                <b className={`confidence-badge ${confidenceTone}`}>
                  {node.averageConfidence > 0 ? `${Math.round(node.averageConfidence * 100)}%` : '待证据'}
                </b>
                {node.span > 0 && <b>{node.visibleSpan}/{node.span} 下属</b>}
                {node.hiddenDirectCount > 0 && <b>+{node.hiddenDirectCount} 收起</b>}
                {isChanged && <b className="change-badge">近期变动</b>}
              </div>
              <b className={`freshness-badge ${freshnessLabel(node.updatedAt).tone}`}>
                {freshnessLabel(node.updatedAt).label}
              </b>
            </div>
          ),
        },
        type: 'default',
        draggable: canManualEdit,
      } satisfies Node;
      });
      return [...laneNodes, ...personNodes];
    },
    [canManualEdit, changedPeople, graph.lanes, graph.nodes, isFormalChart, reportMode, timeView],
  );
  const [nodes, setNodes] = useState<Node[]>(graphNodes);
  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: `${edge.label} ${Math.round(edge.confidence * 100)}%`,
        type: isFormalChart ? 'step' : 'smoothstep',
        animated:
          timeView === 'changes90' &&
          graph.nodes.some(
            (node) =>
              node.changeCount > 0 &&
              (node.id === edge.source || node.id === edge.target),
          ),
        style: {
          stroke: edge.confidence < 0.72 ? '#d54941' : isFormalChart ? '#1677ff' : '#7a8f87',
          strokeWidth: isFormalChart ? 1.8 : 1.5,
          strokeDasharray: edge.confidence < 0.75 || edge.relationType === 'dotted-line' ? '6 5' : undefined,
        },
      })),
    [graph.edges, graph.nodes, isFormalChart, timeView],
  );

  useEffect(() => {
    setNodes(graphNodes);
  }, [graphNodes]);

  useEffect(() => {
    if (chartMode === 'formal' && editMode) setEditMode(false);
  }, [chartMode, editMode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (event.key.toLowerCase() === 'f') flowInstance?.fitView({ duration: 240 });
      if (event.key.toLowerCase() === 'e' && chartMode === 'explore') setEditMode((value) => !value);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [chartMode, flowInstance]);

  const onNodesChange = (changes: NodeChange[]) => {
    if (!canManualEdit) return;
    setNodes((currentNodes) => applyNodeChanges(changes, currentNodes));
  };

  const saveNodePosition = (_: unknown, node: Node) => {
    if (!canManualEdit || node.id.startsWith('lane:')) return;
    setState((current) => {
      const next: AppState = structuredClone(current);
      const timestamp = new Date().toISOString();
      const layoutId = layoutIdForCanvasView(next.project.settings.activeCanvasView);
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

  const saveVisibleLayout = () => {
    setState((current) => {
      const next: AppState = structuredClone(current);
      const timestamp = new Date().toISOString();
      const layoutId = layoutIdForCanvasView(next.project.settings.activeCanvasView);
      const currentLayout = next.canvasLayouts?.[layoutId] ?? { nodes: {}, updatedAt: timestamp };
      const visiblePositions = Object.fromEntries(
        nodes.filter((node) => !node.id.startsWith('lane:')).map((node) => [
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
          nodes: {
            ...currentLayout.nodes,
            ...visiblePositions,
          },
          updatedAt: timestamp,
        },
      };
      next.project.updatedAt = timestamp;
      return appendAudit(next, 'canvas-layout-saved', `保存${canvasViewLabel(next.project.settings.activeCanvasView)}画布`, {
        entityCount: nodes.filter((node) => !node.id.startsWith('lane:')).length,
        view: 'map',
      });
    });
  };

  const resetLayout = () => {
    const confirmed = window.confirm('清除组织图手工布局并恢复自动排布吗？');
    if (!confirmed) return;
    setState((current) => {
      const next: AppState = structuredClone(current);
      const layouts = { ...(next.canvasLayouts ?? {}) };
      delete layouts[layoutIdForCanvasView(next.project.settings.activeCanvasView)];
      next.canvasLayouts = layouts;
      next.project.updatedAt = new Date().toISOString();
      return appendAudit(next, 'canvas-layout-reset', `重置${canvasViewLabel(next.project.settings.activeCanvasView)}画布`, {
        view: 'map',
      });
    });
  };

  return (
    <section className="map-layout">
      <div className="canvas-command-bar" aria-label="画布工具栏">
        <div className="segmented-control" role="group" aria-label="组织图模式">
          {(['formal', 'explore'] as OrgChartMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={chartMode === mode ? 'active' : ''}
              onClick={() => updateChartMode(mode)}
              title={orgChartModeLabel(mode)}
            >
              {mode === 'formal' ? <Network size={16} /> : <Move size={16} />}
              {mode === 'formal' ? '自动生成图' : '手动修图'}
            </button>
          ))}
        </div>
        <div className="segmented-control" role="group" aria-label="画布编辑">
          <button
            type="button"
            className={!canManualEdit ? 'active' : ''}
            onClick={() => setEditMode(false)}
            title="浏览模式"
          >
            <MousePointer2 size={16} />
            浏览
          </button>
          <button
            type="button"
            className={canManualEdit ? 'active' : ''}
            onClick={() => setEditMode(true)}
            disabled={isFormalChart}
            title="编辑模式：拖动节点后自动保存位置"
          >
            <Move size={16} />
            编辑
          </button>
        </div>
        <div className="view-preset-group" role="group" aria-label="画布视图">
          {[
            ['executive', '高管版'],
            ['recruiting', '招聘版'],
            ['detail', '详细版'],
          ].map(([view, label]) => (
            <button
              key={view}
              type="button"
              className={state.project.settings.activeCanvasView === view ? 'active' : ''}
              onClick={() =>
                setState((current) => ({
                  ...current,
                  project: {
                    ...current.project,
                    updatedAt: new Date().toISOString(),
                    settings: {
                      ...current.project.settings,
                      activeCanvasView: view as AppState['project']['settings']['activeCanvasView'],
                    },
                  },
                }))
              }
            >
              {label}
            </button>
          ))}
        </div>
        <div className="canvas-actions">
          <button type="button" className="secondary-button" onClick={saveVisibleLayout} disabled={!canManualEdit}>
            <Save size={16} />
            保存当前画布
          </button>
          <button type="button" className="secondary-button" onClick={() => flowInstance?.fitView({ duration: 280 })}>
            <Maximize2 size={16} />
            适配画布
          </button>
          <button
            type="button"
            className={reportMode ? 'secondary-button active-filter' : 'secondary-button'}
            onClick={() => {
              const nextReportMode = !reportMode;
              setReportMode(nextReportMode);
              if (nextReportMode) {
                reportFiltersRef.current = {
                  visibleLimit: filters.visibleLimit,
                  maxDepth: filters.maxDepth,
                };
                setFilters({ ...filters, maxDepth: Math.min(filters.maxDepth, 2), visibleLimit: Math.min(filters.visibleLimit, 90) });
              } else if (reportFiltersRef.current) {
                setFilters({ ...filters, ...reportFiltersRef.current });
                reportFiltersRef.current = null;
              }
              window.setTimeout(() => flowInstance?.fitView({ duration: 280 }), 60);
            }}
          >
            <Maximize2 size={16} />
            汇报放大
          </button>
          <button type="button" className="secondary-button" onClick={resetLayout} disabled={savedCount === 0 && !isFormalChart}>
            <RotateCcw size={16} />
            自动布局
          </button>
        </div>
        <div className="canvas-status">
          {canManualEdit ? <Move size={15} /> : <Lock size={15} />}
          <span>
            {isFormalChart
              ? `自动生成图：按公司、部门和汇报线排版，隐藏 ${graph.diagnostics.hiddenDirectReports} 个下钻节点`
              : canManualEdit
                ? `手动修图：可以拖动节点，也可以在下方新增人员和汇报线`
                : `浏览中：导出会使用当前手工布局，已保存 ${savedCount} 个节点`}
          </span>
        </div>
      </div>

      <div className="map-controls">
        <label>
          公司
          <select value={filters.company} onChange={(event) => setFilters({ ...filters, company: event.target.value })}>
            <option value="">全部</option>
            {state.project.companies.map((company) => (
              <option key={company} value={company}>
                {company}
              </option>
            ))}
          </select>
        </label>
        <label>
          搜索
          <input
            value={filters.search}
            placeholder="姓名/岗位/部门"
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
        </label>
        <label>
          团队焦点
          <input
            list="focus-person-options"
            placeholder="输入负责人姓名"
            value={filters.focusPersonName}
            onChange={(event) => setFilters({ ...filters, focusPersonName: event.target.value })}
            onBlur={(event) => commitFocusPerson(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitFocusPerson(event.currentTarget.value);
              }
            }}
          />
          <datalist id="focus-person-options">
            {focusOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </datalist>
        </label>
        <label>
          版本
          <select value={timeView} onChange={(event) => setTimeView(event.target.value as 'current' | 'changes90')}>
            <option value="current">当前组织</option>
            <option value="changes90">近90天变化</option>
          </select>
        </label>
        <label>
          置信度 {Math.round(filters.minConfidence * 100)}%
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
          节点上限
          <input
            type="number"
            min="30"
            max="600"
            value={filters.visibleLimit}
            onChange={(event) => setFilters({ ...filters, visibleLimit: Number(event.target.value) })}
          />
        </label>
        <label>
          显示层级
          <input
            type="number"
            min="1"
            max="8"
            value={filters.maxDepth}
            onChange={(event) => setFilters({ ...filters, maxDepth: Number(event.target.value) })}
          />
        </label>
      </div>

      <div className="org-chart-summary">
        <StatusLine label="图形模式" value={orgChartModeLabel(chartMode)} tone="good" />
        <StatusLine label="可见管理者" value={`${graph.diagnostics.visibleManagers} 位`} />
        <StatusLine label="最大层级" value={`L${graph.diagnostics.maxVisibleDepth}`} />
        <StatusLine label="收起下属" value={`${graph.diagnostics.hiddenDirectReports} 位`} />
        <StatusLine label="近期变动" value={`${graph.diagnostics.recentChangePeopleCount} 位`} />
        <StatusLine label="弱证据线" value={`${graph.diagnostics.weakRelationCount} 条`} />
      </div>

      {graph.focusChain.length > 0 && (
        <div className="focus-breadcrumb">
          {graph.focusChain.map((name, index) => (
            <span key={`${name}-${index}`}>{name}</span>
          ))}
        </div>
      )}

      {!isFormalChart && (
        <section className="tool-panel manual-repair-panel">
          <div className="section-heading">
            <h2>手动修图工具</h2>
            <span className="small-badge">PPT 识别不准时用这里补</span>
          </div>
          <div className="manual-repair-grid">
            <div>
              <h3>新增/更新人员</h3>
              <div className="candidate-fields">
                <Field label="姓名" value={manualPerson.name} onChange={(value) => setManualPerson((current) => ({ ...current, name: value }))} />
                <Field label="岗位" value={manualPerson.title} onChange={(value) => setManualPerson((current) => ({ ...current, title: value }))} />
                <Field label="部门" value={manualPerson.department} onChange={(value) => setManualPerson((current) => ({ ...current, department: value }))} />
                <Field label="公司" value={manualPerson.company} onChange={(value) => setManualPerson((current) => ({ ...current, company: value }))} />
              </div>
              <button type="button" className="primary-button" onClick={() => upsertManualPerson(manualPerson)}>
                <Users size={16} />
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
                <Network size={16} />
                连接上下级
              </button>
            </div>
          </div>
        </section>
      )}

      {graph.truncated && (
        <div className="inline-warning">
          当前筛选命中 {graph.totalBeforeLimit} 人，仅渲染前 {filters.visibleLimit} 个节点。
        </div>
      )}

      <div className="flow-surface">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          minZoom={0.05}
          maxZoom={1.5}
          nodesDraggable={canManualEdit}
          elementsSelectable={canManualEdit}
          panOnDrag={!canManualEdit}
          selectionOnDrag={canManualEdit}
          onInit={setFlowInstance}
          onNodesChange={onNodesChange}
          onNodeDragStop={saveNodePosition}
          onNodeClick={(_, node) => {
            if (node.id.startsWith('lane:')) return;
            if (!canManualEdit && typeof node.data.label !== 'string') {
              const graphNode = graph.nodes.find((item) => item.id === node.id);
              if (graphNode) setFilters({ ...filters, focusPersonName: graphNode.label });
            }
          }}
        >
          <MiniMap pannable zoomable nodeColor={(node) => (String(node.id).startsWith('lane:') ? '#eaf2ff' : '#1677ff')} />
          <Controls />
          <Background color="#d8e7ff" gap={24} />
        </ReactFlow>
      </div>
    </section>
  );
}

function PeopleView({ state, setState }: { state: AppState; setState: Dispatch<SetStateAction<AppState>> }) {
  const [query, setQuery] = useState('');
  const [talentOnly, setTalentOnly] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string>('');
  const [showSubordinates, setShowSubordinates] = useState(false);
  const [subordinateQuery, setSubordinateQuery] = useState('');
  const [evidenceFilter, setEvidenceFilter] = useState<'all' | 'strong' | 'medium' | 'weak'>('all');
  const normalized = query.trim().toLowerCase();
  const people = state.people.filter((person) => {
    if (talentOnly && !person.tags.includes('关键人才池')) return false;
    if (!normalized) return true;
    return [person.name, person.company, person.currentDepartment, person.currentTitle, ...person.tags]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalized));
  });
  const selectedPerson = state.people.find((person) => person.id === selectedPersonId) ?? people[0];
  useEffect(() => {
    setSubordinateQuery('');
    setShowSubordinates(false);
  }, [selectedPerson?.id]);
  const personEvidence = selectedPerson
    ? state.evidence.filter((item) => selectedPerson.evidenceIds.includes(item.id)).slice(0, 8)
    : [];
  const filteredEvidence = personEvidence.filter((item) => {
    if (evidenceFilter === 'all') return true;
    return evidenceStrength(item.confidence).tone === evidenceFilter;
  });
  const personRoles = selectedPerson
    ? state.roleAssignments.filter((role) => role.personId === selectedPerson.id || role.personName === selectedPerson.name)
    : [];
  const managerLines = selectedPerson
    ? state.reportingLines.filter((line) => line.subordinateName === selectedPerson.name && line.isCurrent)
    : [];
  const subordinateLines = selectedPerson
    ? state.reportingLines.filter((line) => line.managerName === selectedPerson.name && line.isCurrent)
    : [];
  const visibleSubordinateLines = subordinateLines.filter((line) =>
    subordinateQuery.trim() ? line.subordinateName.includes(subordinateQuery.trim()) : true,
  );
  const personEvents = selectedPerson
    ? state.changeEvents.filter((event) => event.personId === selectedPerson.id || event.personName === selectedPerson.name)
    : [];
  const talentCount = state.people.filter((person) => person.tags.includes('关键人才池')).length;
  const toggleTalent = () => {
    if (!selectedPerson) return;
    setState((current) => {
      const next: AppState = structuredClone(current);
      const person = next.people.find((item) => item.id === selectedPerson.id);
      if (!person) return current;
      const hasTalent = person.tags.includes('关键人才池');
      person.tags = hasTalent ? person.tags.filter((tag) => tag !== '关键人才池') : [...person.tags, '关键人才池'];
      person.updatedAt = new Date().toISOString();
      next.project.updatedAt = person.updatedAt;
      return appendAudit(next, 'talent-updated', `${hasTalent ? '移出' : '加入'}重点人才池：${person.name}`, {
        view: 'people',
      });
    });
  };

  return (
    <section className="view-stack">
      <div className="toolbar">
        <input value={query} placeholder="搜索人员、公司、部门、岗位" onChange={(event) => setQuery(event.target.value)} />
        <button
          type="button"
          className={talentOnly ? 'secondary-button active-filter' : 'secondary-button'}
          onClick={() => setTalentOnly((value) => !value)}
        >
          <Star size={16} />
          {talentOnly ? '已筛选：重点人才池' : '重点人才池'}
        </button>
        <span className="muted-text">
          {people.length} 人 · 重点人才 {talentCount} 人
        </span>
      </div>
      <div className="people-workbench">
        <section className="tool-panel">
          <div className="section-heading">
            <h2>人员清单</h2>
            <span className="small-badge">{state.people.length}</span>
          </div>
          <div className="table-like">
            <div className="table-head">
              <span>姓名</span>
              <span>公司</span>
              <span>部门</span>
              <span>岗位</span>
              <span>状态</span>
            </div>
            {people.map((person) => (
              <button
                className={selectedPerson?.id === person.id ? 'table-row selectable selected' : 'table-row selectable'}
                key={person.id}
                type="button"
                onClick={() => setSelectedPersonId(person.id)}
              >
                <strong>{person.name}</strong>
                <span>{person.company ?? '公司待确认'}</span>
                <span>{person.currentDepartment ?? '部门待确认'}</span>
                <span>{person.currentTitle ?? '岗位待确认'}</span>
                <em className={person.status === 'left' ? 'danger-text' : ''}>{person.status}</em>
              </button>
            ))}
          </div>
        </section>

        <section className="tool-panel person-detail-panel">
          {selectedPerson ? (
            <>
              <div className="person-detail-head">
                <div>
                  <h2>{selectedPerson.name}</h2>
                  <p>
                    {selectedPerson.company ?? '公司待确认'} · {selectedPerson.currentDepartment ?? '部门待确认'} ·{' '}
                    {selectedPerson.currentTitle ?? '岗位待确认'}
                  </p>
                </div>
                <span className={`freshness-badge ${freshnessLabel(selectedPerson.updatedAt).tone}`}>
                  {freshnessLabel(selectedPerson.updatedAt).label}
                </span>
              </div>
              <div className="tag-row">
                {selectedPerson.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
                {selectedPerson.status === 'left' && <span className="danger-tag">已离开</span>}
              </div>
              <button type="button" className="secondary-button talent-toggle" onClick={toggleTalent}>
                <Star size={16} />
                {selectedPerson.tags.includes('关键人才池') ? '移出重点人才池' : '加入重点人才池'}
              </button>

              <div className="detail-section">
                <h3>汇报关系</h3>
                <p>
                  上级：{managerLines.map((line) => line.managerName).join('、') || '待确认'}；直属下级：
                  {subordinateLines.length} 人
                </p>
                {subordinateLines.length > 0 && (
                  <>
                    <button type="button" className="text-button compact" onClick={() => setShowSubordinates((value) => !value)}>
                      {showSubordinates ? '收起下级名单' : '展开下级名单'}
                    </button>
                    {showSubordinates && (
                      <>
                        {subordinateLines.length > 8 && (
                          <input
                            className="subordinate-search"
                            value={subordinateQuery}
                            placeholder="搜索下级姓名"
                            onChange={(event) => setSubordinateQuery(event.target.value)}
                          />
                        )}
                        <div className="subordinate-list">
                          {visibleSubordinateLines.map((line) => (
                            <span key={line.id}>{line.subordinateName}</span>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>

              <div className="detail-section">
                <h3>任职记录</h3>
                {personRoles.slice(0, 4).map((role) => (
                  <p key={role.id}>
                    {role.orgUnitName ?? '组织待确认'} · {role.title} · {role.status}
                  </p>
                ))}
                {personRoles.length === 0 && <p>暂无任职记录。</p>}
              </div>

              <div className="detail-section">
                <div className="detail-section-head">
                  <h3>证据时间线</h3>
                  <select value={evidenceFilter} onChange={(event) => setEvidenceFilter(event.target.value as typeof evidenceFilter)}>
                    <option value="all">全部证据</option>
                    <option value="strong">强证据</option>
                    <option value="medium">待验证</option>
                    <option value="weak">弱证据</option>
                  </select>
                </div>
                {filteredEvidence.map((item) => (
                  <article className="evidence-row" key={item.id}>
                    <span className={`evidence-pill ${evidenceStrength(item.confidence).tone}`}>
                      {evidenceStrength(item.confidence).label}
                    </span>
                    <div>
                      <strong>{formatDate(item.date ?? item.extractedAt)}</strong>
                      <p>{item.text}</p>
                      <em>{item.sourceName}</em>
                    </div>
                  </article>
                ))}
                {personEvents.map((event) => (
                  <article className="evidence-row" key={event.id}>
                    <span className="evidence-pill medium">变更</span>
                    <div>
                      <strong>{formatDate(event.date ?? event.createdAt)}</strong>
                      <p>{event.description}</p>
                    </div>
                  </article>
                ))}
                {filteredEvidence.length === 0 && personEvents.length === 0 && (
                  <p>当前筛选下暂无证据，请切回“全部证据”。</p>
                )}
              </div>
            </>
          ) : (
            <EmptyState title="暂无人员" body="导入资料并接受候选后会生成人员详情。" />
          )}
        </section>
      </div>

      <section className="tool-panel">
        <div className="section-heading">
          <h2>组织单元</h2>
          <span className="small-badge">{state.orgUnits.length}</span>
        </div>
        <div className="org-chip-grid">
          {state.orgUnits.slice(0, 80).map((unit) => (
            <span key={unit.id}>
              {unit.name} · {unit.function ?? '职能待确认'}
            </span>
          ))}
        </div>
      </section>
    </section>
  );
}

function TimelineView({ state, staleEvents }: { state: AppState; staleEvents: AppState['changeEvents'] }) {
  const events = [...staleEvents, ...state.changeEvents].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <section className="view-stack">
      <div className="timeline">
        {events.map((event) => (
          <article className="timeline-item" key={event.id}>
            <span>{formatDate(event.date ?? event.createdAt)}</span>
            <strong>{event.personName ?? event.type}</strong>
            <p>{event.description}</p>
            {event.sourceName && <em>{event.sourceName}</em>}
          </article>
        ))}
        {events.length === 0 && <EmptyState title="暂无变更" body="接受离职、调任、汇报线变化候选后会形成时间线。" />}
      </div>
    </section>
  );
}

function ExportView({
  state,
  filters,
  password,
  setPassword,
  setState,
  exportPackage,
  importPackage,
  exportPng,
  exportPptx,
  applyReportTemplate,
}: {
  state: AppState;
  filters: OrgMapFilters;
  password: string;
  setPassword: (value: string) => void;
  setState: (updater: AppState | ((current: AppState) => AppState)) => void;
  exportPackage: () => void;
  importPackage: (file: File | undefined) => void;
  exportPng: () => void;
  exportPptx: () => void;
  applyReportTemplate: (template: ReportTemplateKey) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState('');
  const previewGraph = useMemo(() => buildOrgGraph(state, filters), [state, filters]);
  const exportNarrative = useMemo(() => buildExecutiveNarrative(state), [state]);
  const pendingCount = state.candidates.filter((candidate) => candidate.status === 'pending').length;
  const riskCount = exportNarrative.risks.filter((risk) => risk.tone !== 'good').length;
  const failedSourceCount = state.sources.filter((source) => sourceHealth(source).tone === 'danger').length;
  const publishChecks = [
    {
      label: '汇报模板',
      value: reportTemplateLabel(state.project.settings.reportTemplate),
      done: true,
    },
    {
      label: '画布预览',
      value: `${orgChartModeLabel(state.project.settings.orgChartMode)} · ${previewGraph.nodes.length} 节点`,
      done: previewGraph.nodes.length > 0 && previewGraph.nodes.length <= state.project.settings.defaultVisibleNodeLimit,
    },
    {
      label: '候选复核',
      value: pendingCount === 0 ? '无待确认候选' : `${pendingCount} 条待确认`,
      done: pendingCount === 0,
    },
    {
      label: '文件识别',
      value: failedSourceCount === 0 ? '无失败文件' : `${failedSourceCount} 个文件需人工辅助`,
      done: failedSourceCount === 0,
    },
    {
      label: '孤立人员',
      value: exportNarrative.metrics.orphanPeopleCount === 0 ? '无孤立人员' : `${exportNarrative.metrics.orphanPeopleCount} 人未接入汇报线`,
      done: exportNarrative.metrics.orphanPeopleCount === 0,
    },
    {
      label: '敏感分级',
      value: sensitivityLevelLabel(state.project.settings.sensitivityLevel),
      done: true,
    },
    {
      label: '导出版式',
      value: orgChartExportFormatLabel(state.project.settings.orgChartExportFormat),
      done: true,
    },
    {
      label: '风险提示',
      value: riskCount === 0 ? '无重点风险' : `${riskCount} 项需说明`,
      done: riskCount === 0,
    },
  ];
  const activePrivacyPreset = useMemo(() => {
    const privacy = state.project.settings.exportPrivacy;
    if (!privacy.names && !privacy.companies && !privacy.sources && !privacy.notes) return 'internal';
    if (!privacy.names && !privacy.companies && privacy.sources && !privacy.notes) return 'leader';
    if (privacy.names && privacy.companies && privacy.sources && privacy.notes) return 'external';
    return 'custom';
  }, [state.project.settings.exportPrivacy]);
  const updatePrivacy = (field: keyof AppState['project']['settings']['exportPrivacy'], value: boolean) => {
    const fieldLabels: Record<keyof AppState['project']['settings']['exportPrivacy'], string> = {
      names: '姓名',
      companies: '公司/组织',
      sources: '来源',
      notes: '备注/说明',
    };
    setState((current) =>
      appendAudit(
        {
          ...current,
          project: {
            ...current.project,
            updatedAt: new Date().toISOString(),
            settings: {
              ...current.project.settings,
              anonymizeExports: field === 'names' ? value : current.project.settings.anonymizeExports,
              exportPrivacy: {
                ...current.project.settings.exportPrivacy,
                [field]: value,
              },
            },
          },
        },
        'privacy-changed',
        `${value ? '开启' : '关闭'}${fieldLabels[field]}脱敏`,
        { view: 'export' },
      ),
    );
  };
  const applyPrivacyPreset = (preset: 'internal' | 'leader' | 'external') => {
    const presets = {
      internal: { names: false, companies: false, sources: false, notes: false },
      leader: { names: false, companies: false, sources: true, notes: false },
      external: { names: true, companies: true, sources: true, notes: true },
    };
    setState((current) =>
      appendAudit(
        {
          ...current,
          project: {
            ...current.project,
            updatedAt: new Date().toISOString(),
            settings: {
              ...current.project.settings,
              anonymizeExports: presets[preset].names,
              exportPrivacy: presets[preset],
            },
          },
        },
        'privacy-changed',
        `套用${preset === 'internal' ? '内部版' : preset === 'leader' ? '领导版' : '外发版'}脱敏预设`,
        { view: 'export' },
      ),
    );
  };
  const applySensitivityLevel = (level: SensitivityLevel) => {
    const privacyByLevel: Record<SensitivityLevel, AppState['project']['settings']['exportPrivacy']> = {
      internal: { names: false, companies: false, sources: false, notes: false },
      restricted: { names: false, companies: false, sources: true, notes: true },
      external: { names: true, companies: true, sources: true, notes: true },
    };
    setState((current) =>
      appendAudit(
        {
          ...current,
          project: {
            ...current.project,
            updatedAt: new Date().toISOString(),
            settings: {
              ...current.project.settings,
              sensitivityLevel: level,
              anonymizeExports: privacyByLevel[level].names,
              exportPrivacy: privacyByLevel[level],
            },
          },
        },
        'sensitivity-updated',
        `切换敏感分级为${sensitivityLevelLabel(level)}`,
        { view: 'export' },
      ),
    );
  };
  const applyExportFormat = (format: OrgChartExportFormat) => {
    setState((current) =>
      appendAudit(
        {
          ...current,
          project: {
            ...current.project,
            updatedAt: new Date().toISOString(),
            settings: {
              ...current.project.settings,
              orgChartExportFormat: format,
            },
          },
        },
        'report-template-applied',
        `切换组织图导出版式为${orgChartExportFormatLabel(format)}`,
        { view: 'export' },
      ),
    );
  };

  const refreshPreview = () => {
    try {
      setPreviewUrl(exportOrgGraphPng(state, filters));
    } catch {
      setPreviewUrl('');
    }
  };

  return (
    <section className="view-stack">
      <div className="export-grid">
        <section className="tool-panel">
          <div className="section-heading">
            <h2>汇报输出</h2>
            <span className="small-badge">
              {activePrivacyPreset === 'internal'
                ? '内部版'
                : activePrivacyPreset === 'leader'
                  ? '领导版'
                  : activePrivacyPreset === 'external'
                    ? '外发版'
                    : '自定义'}
            </span>
          </div>
          <p className="panel-note">
            导出会沿用组织图当前模式和筛选条件。当前画布：{canvasViewLabel(state.project.settings.activeCanvasView)} · {orgChartModeLabel(state.project.settings.orgChartMode)}。
          </p>
          <div className="section-subhead">
            <strong>汇报模板</strong>
            <span>{reportTemplateLabel(state.project.settings.reportTemplate)}</span>
          </div>
          <div className="preset-row report-template-row">
            {(Object.entries(reportTemplatePresets) as Array<[ReportTemplateKey, (typeof reportTemplatePresets)[ReportTemplateKey]]>).map(
              ([template, preset]) => (
                <button
                  key={template}
                  type="button"
                  className={state.project.settings.reportTemplate === template ? 'active' : ''}
                  onClick={() => applyReportTemplate(template)}
                >
                  {preset.label}
                </button>
              ),
            )}
          </div>
          <div className="section-subhead">
            <strong>脱敏口径</strong>
            <span>
              {activePrivacyPreset === 'internal'
                ? '内部版'
                : activePrivacyPreset === 'leader'
                  ? '领导版'
                  : activePrivacyPreset === 'external'
                    ? '外发版'
                    : '自定义'}
            </span>
          </div>
          <div className="section-subhead">
            <strong>敏感分级</strong>
            <span>{sensitivityLevelLabel(state.project.settings.sensitivityLevel)}</span>
          </div>
          <div className="sensitivity-row">
            {(['internal', 'restricted', 'external'] as SensitivityLevel[]).map((level) => (
              <button
                key={level}
                type="button"
                className={state.project.settings.sensitivityLevel === level ? 'active' : ''}
                onClick={() => applySensitivityLevel(level)}
              >
                <strong>{sensitivityLevelLabel(level)}</strong>
                <span>
                  {level === 'internal'
                    ? '真实姓名和来源保留'
                    : level === 'restricted'
                      ? '隐藏来源和敏感备注'
                      : '姓名、公司、来源全脱敏'}
                </span>
              </button>
            ))}
          </div>
          <div className="preset-row">
            <button
              type="button"
              className={activePrivacyPreset === 'internal' ? 'active' : ''}
              onClick={() => applyPrivacyPreset('internal')}
            >
              内部版
            </button>
            <button
              type="button"
              className={activePrivacyPreset === 'leader' ? 'active' : ''}
              onClick={() => applyPrivacyPreset('leader')}
            >
              领导版
            </button>
            <button
              type="button"
              className={activePrivacyPreset === 'external' ? 'active' : ''}
              onClick={() => applyPrivacyPreset('external')}
            >
              外发版
            </button>
          </div>
          <div className="privacy-options">
            <label className="toggle-line">
              <input
                type="checkbox"
                checked={state.project.settings.exportPrivacy.names}
                onChange={(event) => updatePrivacy('names', event.target.checked)}
              />
              <span>姓名脱敏</span>
            </label>
            <label className="toggle-line">
              <input
                type="checkbox"
                checked={state.project.settings.exportPrivacy.companies}
                onChange={(event) => updatePrivacy('companies', event.target.checked)}
              />
              <span>公司/组织脱敏</span>
            </label>
            <label className="toggle-line">
              <input
                type="checkbox"
                checked={state.project.settings.exportPrivacy.sources}
                onChange={(event) => updatePrivacy('sources', event.target.checked)}
              />
              <span>来源脱敏</span>
            </label>
            <label className="toggle-line">
              <input
                type="checkbox"
                checked={state.project.settings.exportPrivacy.notes}
                onChange={(event) => updatePrivacy('notes', event.target.checked)}
              />
              <span>备注/说明脱敏</span>
            </label>
          </div>
          <div className="section-subhead">
            <strong>组织图导出版式</strong>
            <span>{orgChartExportFormatLabel(state.project.settings.orgChartExportFormat)}</span>
          </div>
          <div className="preset-row">
            {(['ppt16x9', 'a4Landscape', 'longImage'] as OrgChartExportFormat[]).map((format) => (
              <button
                key={format}
                type="button"
                className={state.project.settings.orgChartExportFormat === format ? 'active' : ''}
                onClick={() => applyExportFormat(format)}
              >
                {orgChartExportFormatLabel(format)}
              </button>
            ))}
          </div>
          <div className="publish-checklist" aria-label="发布前检查">
            <div className="section-subhead">
              <strong>发布前检查</strong>
              <span>{publishChecks.filter((item) => item.done).length}/{publishChecks.length} 已通过</span>
            </div>
            <div className="publish-check-grid">
              {publishChecks.map((item) => (
                <div key={item.label} className={item.done ? 'publish-check done' : 'publish-check attention'}>
                  <span>
                    <Check size={14} />
                  </span>
                  <div>
                    <strong>{item.label}</strong>
                    <em>{item.value}</em>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="button-row">
            <button type="button" className="primary-button" onClick={exportPptx}>
              <Download size={16} />
              导出 PPTX
            </button>
            <button type="button" className="secondary-button" onClick={exportPng}>
              <ImageDown size={16} />
              导出组织图 PNG
            </button>
            <button type="button" className="secondary-button" onClick={refreshPreview}>
              <Maximize2 size={16} />
              刷新预览
            </button>
          </div>
          <div className="export-preview">
            <div className="preview-meta">
              当前预览：{previewGraph.nodes.length} 个节点 · {previewGraph.edges.length} 条线 ·{' '}
              {canvasViewLabel(state.project.settings.activeCanvasView)}
            </div>
            {previewUrl ? <img src={previewUrl} alt="组织图导出预览" /> : <span>刷新预览后可检查 PPT 首页组织图密度。</span>}
          </div>
        </section>

        <section className="tool-panel">
          <div className="section-heading">
            <h2>加密项目包</h2>
            <span className="small-badge">.mapping.zip</span>
          </div>
          <label className="field wide">
            <span>项目包密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 6 个字符"
            />
          </label>
          <div className="button-row">
            <button type="button" className="primary-button" onClick={exportPackage}>
              <ShieldCheck size={16} />
              导出加密包
            </button>
            <label className="file-button">
              <Upload size={16} />
              导入加密包
              <input
                type="file"
                accept=".zip,.mapping.zip"
                onChange={(event) => void importPackage(event.target.files?.[0])}
              />
            </label>
          </div>
        </section>
      </div>
    </section>
  );
}

function StatusLine({ label, value, tone }: { label: string; value: string; tone?: 'good' }) {
  return (
    <div className="status-line">
      <span>{label}</span>
      <strong className={tone === 'good' ? 'good-text' : ''}>{value}</strong>
    </div>
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
