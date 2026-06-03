import type { AppState, OrgChartExportFormat, OrgMapFilters, Person } from '../types';
import { buildOrgGraph } from './graph';
import { buildExecutiveNarrative } from './insights';
import { normalizeName } from './ids';

function maskName(name: string): string {
  if (!name) return '';
  if (/^[\u4e00-\u9fa5]+$/.test(name)) {
    return `${name.slice(0, 1)}某`;
  }
  return `${name.slice(0, 1)}***`;
}

function displayPerson(person: Person, anonymize: boolean): string {
  return anonymize ? maskName(person.name) : person.name;
}

function maskKnownPeopleText(state: AppState, text: string): string {
  if (!shouldMaskNames(state)) return text;
  return state.people
    .slice()
    .sort((a, b) => b.name.length - a.name.length)
    .slice(0, 200)
    .reduce((current, person) => current.split(person.name).join(maskName(person.name)), text);
}

function shouldMaskNames(state: AppState): boolean {
  return state.project.settings.anonymizeExports || state.project.settings.exportPrivacy?.names;
}

function shouldMaskCompanies(state: AppState): boolean {
  return Boolean(state.project.settings.exportPrivacy?.companies);
}

function displayCompany(state: AppState, value?: string): string {
  if (!value) return '待确认';
  return shouldMaskCompanies(state) ? '公司已脱敏' : value;
}

function freshnessText(updatedAt: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86_400_000));
  if (Number.isNaN(days)) return '更新未知';
  if (days <= 30) return '30天内更新';
  return `${days}天未更新`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportFormatLabel(format: OrgChartExportFormat): string {
  if (format === 'a4Landscape') return 'A4 横版';
  if (format === 'longImage') return '长图';
  return 'PPT 16:9';
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [''];

  const lines: string[] = [];
  let current = '';
  for (const char of clean) {
    const next = current + char;
    if (context.measureText(next).width <= maxWidth || current.length === 0) {
      current = next;
      continue;
    }
    lines.push(current);
    current = char;
    if (lines.length === maxLines - 1) break;
  }
  if (lines.length < maxLines) lines.push(current);
  if (lines.length > maxLines) lines.length = maxLines;
  if (lines.length === maxLines && context.measureText(clean).width > maxWidth) {
    const last = lines[maxLines - 1] ?? '';
    lines[maxLines - 1] = last.length > 1 ? `${last.slice(0, Math.max(1, last.length - 1))}…` : '…';
  }
  return lines.filter(Boolean);
}

function drawCanvasPill(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  options: { fill: string; color: string; radius?: number; font?: string },
): number {
  context.save();
  context.font = options.font ?? '600 11px Microsoft YaHei, sans-serif';
  const width = Math.max(44, context.measureText(label).width + 18);
  const height = 22;
  context.fillStyle = options.fill;
  context.beginPath();
  context.roundRect(x, y, width, height, options.radius ?? 999);
  context.fill();
  context.fillStyle = options.color;
  context.textBaseline = 'middle';
  context.fillText(label, x + 9, y + height / 2);
  context.restore();
  return width;
}

function collectExportHighlights(
  state: AppState,
  graph: ReturnType<typeof buildOrgGraph>,
): string[] {
  const visibleNames = new Set(graph.nodes.map((node) => normalizeName(node.label)));
  const eventNotes = state.changeEvents
    .filter((event) => event.personName && visibleNames.has(normalizeName(event.personName)))
    .sort((a, b) => new Date(b.date ?? b.createdAt).getTime() - new Date(a.date ?? a.createdAt).getTime())
    .map((event) => maskKnownPeopleText(state, event.description));

  const summaryNotes = [
    graph.diagnostics.hiddenDirectReports > 0 ? `已收起 ${graph.diagnostics.hiddenDirectReports} 个下钻人员，正式汇报请先看一级和二级负责人。` : '',
    graph.diagnostics.weakRelationCount > 0 ? `有 ${graph.diagnostics.weakRelationCount} 条低置信度汇报线，导出前建议复核。` : '',
    graph.truncated ? `当前筛选命中 ${graph.totalBeforeLimit} 人，本次导出按 ${graph.nodes.length} 个节点输出。` : '',
  ].filter(Boolean);

  return [...eventNotes, ...summaryNotes].slice(0, 4);
}

export function exportOrgGraphPng(
  state: AppState,
  filters: OrgMapFilters,
  anonymize = shouldMaskNames(state),
  format: OrgChartExportFormat = state.project.settings.orgChartExportFormat ?? 'ppt16x9',
): string {
  const graph = buildOrgGraph(state, filters);
  const activeView = state.project.settings.activeCanvasView;
  const isReport = activeView === 'executive' || activeView === 'mindmap';
  const isMindMap = activeView === 'mindmap' || activeView === 'detail';
  const nodeWidth = isReport ? (isMindMap ? 220 : 236) : isMindMap ? 194 : 220;
  const nodeHeight = isReport ? (isMindMap ? 92 : 118) : isMindMap ? 74 : 108;
  const modeText = isReport ? '汇报模式' : '招聘模式';
  const styleText = isMindMap ? '树状图' : '常规架构图';
  const notes = collectExportHighlights(state, graph);
  const bounds = [
    ...graph.nodes.map((node) => ({ x1: node.x, y1: node.y, x2: node.x + nodeWidth + 30, y2: node.y + nodeHeight + 24 })),
    ...graph.lanes.map((lane) => ({ x1: lane.x, y1: lane.y, x2: lane.x + lane.width, y2: lane.y + lane.height })),
  ];
  const minX = bounds.length ? Math.min(...bounds.map((item) => item.x1)) : 0;
  const minY = bounds.length ? Math.min(...bounds.map((item) => item.y1)) : 0;
  const maxX = bounds.length ? Math.max(...bounds.map((item) => item.x2)) : 1120;
  const maxY = bounds.length ? Math.max(...bounds.map((item) => item.y2)) : 620;
  const chartPadding = 42;
  const headerHeight = format === 'longImage' ? 98 : 116;
  const footerHeight = format === 'longImage' ? 116 : 160;
  const contentWidth = Math.max(1120, maxX - minX + chartPadding * 2);
  const contentHeight = Math.max(560, maxY - minY + chartPadding * 2);
  const fixedSize =
    format === 'ppt16x9'
      ? { width: 1920, height: 1080 }
      : format === 'a4Landscape'
        ? { width: 1754, height: 1240 }
        : undefined;
  const width = fixedSize?.width ?? contentWidth;
  const height = fixedSize?.height ?? contentHeight + headerHeight + footerHeight + 24;
  const boardX = fixedSize ? 36 : 0;
  const boardY = headerHeight + 20;
  const boardWidth = fixedSize ? width - 72 : contentWidth;
  const boardHeight = fixedSize ? height - headerHeight - footerHeight - 38 : contentHeight;
  const scale = fixedSize ? Math.min((boardWidth - 28) / contentWidth, (boardHeight - 28) / contentHeight, format === 'a4Landscape' ? 1.04 : 1.12) : 1;
  const offsetX = fixedSize ? boardX + Math.max(14, (boardWidth - contentWidth * scale) / 2) : 0;
  const offsetY = fixedSize ? boardY + Math.max(14, (boardHeight - contentHeight * scale) / 2) : boardY;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('浏览器不支持 Canvas 导出。');
  }

  context.fillStyle = '#f6f7f9';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, headerHeight);
  context.strokeStyle = '#dbe4ef';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, headerHeight - 0.5);
  context.lineTo(width, headerHeight - 0.5);
  context.stroke();
  context.fillStyle = '#172033';
  context.font = fixedSize ? '700 30px Microsoft YaHei, sans-serif' : '700 26px Microsoft YaHei, sans-serif';
  context.fillText(state.project.name, 38, 46);
  context.fillStyle = '#5f6b7a';
  context.font = '15px Microsoft YaHei, sans-serif';
  context.fillText(
    `${modeText} · ${styleText} · ${graph.nodes.length} 个节点 · ${graph.edges.length} 条关系 · ${exportFormatLabel(format)}`,
    40,
    76,
  );
  let metricX = width - 32;
  const metricLabels = [
    `${graph.diagnostics.hiddenDirectReports} 收起`,
    `${graph.diagnostics.weakRelationCount} 待复核`,
    `${graph.diagnostics.recentChangePeopleCount} 变更`,
  ];
  for (const label of metricLabels.reverse()) {
    context.save();
    context.font = '600 12px Microsoft YaHei, sans-serif';
    const pillWidth = Math.max(44, context.measureText(label).width + 18);
    context.restore();
    metricX -= pillWidth;
    drawCanvasPill(context, metricX, 34, label, { fill: '#eef4ff', color: '#1e3a8a', font: '600 12px Microsoft YaHei, sans-serif' });
    metricX -= 10;
  }

  context.save();
  context.shadowColor = 'rgba(15, 23, 42, 0.08)';
  context.shadowBlur = 28;
  context.shadowOffsetY = 10;
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.roundRect(boardX, boardY, boardWidth, boardHeight, 20);
  context.fill();
  context.restore();
  context.strokeStyle = '#d9e3f0';
  context.lineWidth = 1;
  context.stroke();

  context.save();
  context.beginPath();
  context.roundRect(boardX, boardY, boardWidth, boardHeight, 20);
  context.clip();
  const chartFill = context.createLinearGradient(boardX, boardY, boardX, boardY + boardHeight);
  chartFill.addColorStop(0, '#ffffff');
  chartFill.addColorStop(1, '#fbfcfe');
  context.fillStyle = chartFill;
  context.fillRect(boardX, boardY, boardWidth, boardHeight);
  context.restore();

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  context.save();
  context.translate(offsetX - (minX - chartPadding) * scale, offsetY - (minY - chartPadding) * scale);
  context.scale(scale, scale);
  context.lineJoin = 'round';
  context.lineCap = 'round';

  for (const lane of graph.lanes) {
    context.fillStyle = '#f4f8fd';
    context.strokeStyle = '#dbe5f1';
    context.lineWidth = 1.2;
    context.beginPath();
    context.roundRect(lane.x, lane.y, lane.width, lane.height, 16);
    context.fill();
    context.stroke();
    context.fillStyle = '#1e3a8a';
    context.font = '700 15px Microsoft YaHei, sans-serif';
    context.fillText((shouldMaskCompanies(state) ? '业务单元已脱敏' : lane.label).slice(0, 24), lane.x + 16, lane.y + 24);
    context.fillStyle = '#646a73';
    context.font = '12px Microsoft YaHei, sans-serif';
    context.fillText(`${lane.headcount} 人 · ${lane.managerCount} 管理者 · ${lane.talentCount} 重点`, lane.x + 16, lane.y + 44);
  }

  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;

    context.strokeStyle = edge.confidence < 0.72 ? '#d92d20' : isMindMap ? '#7d8da1' : '#8da2bf';
    context.lineWidth = isMindMap ? 1.45 : 1.85;
    if (edge.confidence < 0.75 || edge.relationType === 'dotted-line') context.setLineDash([8, 6]);
    else context.setLineDash([]);
    context.beginPath();
    if (isMindMap) {
      const side = target.mindMapSide === 'left' ? 'left' : 'right';
      const startX = source.x + (side === 'left' ? 0 : nodeWidth);
      const startY = source.y + nodeHeight / 2;
      const endX = target.x + (side === 'left' ? nodeWidth : 0);
      const endY = target.y + nodeHeight / 2;
      const midX = (startX + endX) / 2;
      context.moveTo(startX, startY);
      context.lineTo(midX, startY);
      context.lineTo(midX, endY);
      context.lineTo(endX, endY);
    } else {
      const startX = source.x + nodeWidth / 2;
      const startY = source.y + nodeHeight;
      const endX = target.x + nodeWidth / 2;
      const endY = target.y;
      const midY = startY + Math.max(28, (endY - startY) / 2);
      context.moveTo(startX, startY);
      context.lineTo(startX, midY);
      context.lineTo(endX, midY);
      context.lineTo(endX, endY);
    }
    context.stroke();
  }
  context.setLineDash([]);

  for (const node of graph.nodes) {
    const accent = node.status === 'left' ? '#d92d20' : node.depth === 0 ? '#1e3a8a' : node.changeCount > 0 ? '#b76e00' : isReport ? '#2563eb' : node.isTalent ? '#0f8a5f' : '#7d8da1';
    context.fillStyle = node.status === 'left' ? '#fff1f0' : node.changeCount > 0 ? '#fffaf0' : '#ffffff';
    context.strokeStyle = node.isFocus ? '#2563eb' : node.status === 'left' ? '#d92d20' : node.changeCount > 0 ? '#efd99a' : '#d7e1ef';
    context.lineWidth = node.isFocus ? 2.2 : 1.45;
    context.beginPath();
    context.roundRect(node.x, node.y, nodeWidth, nodeHeight, isMindMap && node.depth >= 2 ? 2 : 10);
    context.fill();
    context.stroke();
    context.fillStyle = accent;
    context.fillRect(node.x, node.y, nodeWidth, isMindMap && node.depth >= 2 ? 3 : 6);

    const orgText = shouldMaskCompanies(state) ? '组织已脱敏' : node.department ?? node.company ?? '组织待确认';
    const displayName = anonymize ? maskName(node.label) : node.label;
    const noteCount = node.changeCount + (node.hiddenDirectCount > 0 ? 1 : 0) + (node.averageConfidence < 0.75 ? 1 : 0);

    if (isReport) {
      context.fillStyle = '#1f2329';
      context.font = `700 ${isMindMap ? 14 : 16}px Microsoft YaHei, sans-serif`;
      wrapCanvasText(context, orgText, nodeWidth - 24, 2).forEach((line, index) => {
        context.fillText(line, node.x + 12, node.y + 28 + index * 18);
      });
      context.fillStyle = '#4e5969';
      context.font = '12px Microsoft YaHei, sans-serif';
      context.fillText(`一号位 ${displayName}`.slice(0, isMindMap ? 18 : 20), node.x + 12, node.y + (isMindMap ? 62 : 70));
      let pillX = node.x + 12;
      pillX += drawCanvasPill(context, pillX, node.y + nodeHeight - 28, `团队 ${Math.max(node.descendantCount, node.span, node.visibleSpan)}`, {
        fill: '#eef4ff',
        color: '#1e3a8a',
      }) + 6;
      pillX += drawCanvasPill(context, pillX, node.y + nodeHeight - 28, `直属 ${node.visibleSpan}`, {
        fill: '#f3f6fa',
        color: '#475569',
      }) + 6;
      if ((!isMindMap || node.depth <= 1) && noteCount > 0) {
        drawCanvasPill(context, pillX, node.y + nodeHeight - 28, `备注 ${noteCount}`, {
          fill: '#fff4dd',
          color: '#b26a00',
        });
      }
    } else {
      context.fillStyle = '#1f2329';
      context.font = '700 15px Microsoft YaHei, sans-serif';
      context.fillText(displayName.slice(0, 16), node.x + 12, node.y + 25);
      context.font = '12px Microsoft YaHei, sans-serif';
      context.fillStyle = '#4e5969';
      context.fillText((node.title ?? '职位待确认').slice(0, 18), node.x + 12, node.y + 48);
      context.fillStyle = '#646a73';
      context.fillText(orgText.slice(0, 18), node.x + 12, node.y + 68);
      if (!isMindMap) {
        let pillX = node.x + 12;
        if (node.isTalent) {
          pillX += drawCanvasPill(context, pillX, node.y + nodeHeight - 28, '重点人才', {
            fill: '#eaf8f2',
            color: '#0f6b4f',
          }) + 6;
        }
        drawCanvasPill(
          context,
          pillX,
          node.y + nodeHeight - 28,
          `${node.visibleSpan}/${node.span} 下属${node.hiddenDirectCount ? ` · +${node.hiddenDirectCount}` : ''}`,
          {
            fill: '#f3f6fa',
            color: '#475569',
          },
        );
      }
    }
  }
  context.restore();

  const footerY = height - footerHeight + 18;
  const summaryCards = [
    { label: '当前视图', value: `${modeText} · ${styleText}` },
    { label: '画布节点', value: `${graph.nodes.length} / ${graph.totalBeforeLimit}` },
    { label: '待复核', value: `${graph.diagnostics.weakRelationCount} 条` },
  ];
  summaryCards.forEach((item, index) => {
    const x = 38 + index * 206;
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.roundRect(x, footerY, 182, 84, 16);
    context.fill();
    context.strokeStyle = '#d9e3f0';
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = '#64748b';
    context.font = '600 13px Microsoft YaHei, sans-serif';
    context.fillText(item.label, x + 16, footerY + 28);
    context.fillStyle = '#172033';
    context.font = '700 22px Microsoft YaHei, sans-serif';
    context.fillText(item.value, x + 16, footerY + 58);
  });

  const notePanelX = fixedSize ? 680 : 38 + summaryCards.length * 206;
  const notePanelWidth = width - notePanelX - 38;
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.roundRect(notePanelX, footerY, notePanelWidth, 84, 16);
  context.fill();
  context.strokeStyle = '#d9e3f0';
  context.lineWidth = 1;
  context.stroke();
  context.fillStyle = '#64748b';
  context.font = '600 13px Microsoft YaHei, sans-serif';
  context.fillText('关键备注', notePanelX + 16, footerY + 28);
  context.fillStyle = '#172033';
  context.font = '13px Microsoft YaHei, sans-serif';
  const noteText =
    notes.length > 0
      ? notes.map((note) => `• ${clipText(note, fixedSize ? 44 : 64)}`).join('   ')
      : '• 当前导出未发现需要额外说明的结构异常。';
  wrapCanvasText(context, noteText, notePanelWidth - 32, 2).forEach((line, index) => {
    context.fillText(line, notePanelX + 16, footerY + 56 + index * 18);
  });

  return canvas.toDataURL('image/png');
}

interface ReportOrgCard {
  key: string;
  personName: string;
  title: string;
  department: string;
  company: string;
  directCount: number;
  totalCount: number;
  changeCount: number;
  evidenceCount: number;
  confidence: number;
  note: string;
}

interface OrgHierarchyModel {
  root?: ReportOrgCard;
  firstLayer: ReportOrgCard[];
  secondLayerGroups: Array<{ parent: ReportOrgCard; children: ReportOrgCard[] }>;
}

function clipText(value: string | undefined, maxLength: number): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function changeTypeText(type: string): string {
  const labels: Record<string, string> = {
    new: '新增',
    resigned: '离职',
    transfer: '调岗',
    'reporting-change': '汇报变化',
    conflict: '冲突',
    stale: '过期',
  };
  return labels[type] ?? type;
}

function buildOrgHierarchyModel(state: AppState): OrgHierarchyModel {
  const peopleByName = new Map(state.people.map((person) => [normalizeName(person.name), person]));
  const childrenByManager = new Map<string, string[]>();
  const managerBySubordinate = new Map<string, string>();
  const confidenceByName = new Map<string, number[]>();

  for (const line of state.reportingLines.filter((item) => item.isCurrent)) {
    const manager = normalizeName(line.managerName);
    const subordinate = normalizeName(line.subordinateName);
    if (!peopleByName.has(manager) || !peopleByName.has(subordinate)) continue;
    childrenByManager.set(manager, [...(childrenByManager.get(manager) ?? []), subordinate]);
    managerBySubordinate.set(subordinate, manager);
    confidenceByName.set(manager, [...(confidenceByName.get(manager) ?? []), line.confidence]);
    confidenceByName.set(subordinate, [...(confidenceByName.get(subordinate) ?? []), line.confidence]);
  }

  const recentChangeByName = new Map<string, number>();
  for (const event of state.changeEvents) {
    if (!event.personName) continue;
    const time = new Date(event.date ?? event.createdAt).getTime();
    if (Number.isFinite(time) && Date.now() - time > 90 * 86_400_000) continue;
    const name = normalizeName(event.personName);
    recentChangeByName.set(name, (recentChangeByName.get(name) ?? 0) + 1);
  }

  const descendantCache = new Map<string, number>();
  const countDescendants = (name: string): number => {
    if (descendantCache.has(name)) return descendantCache.get(name)!;
    const visited = new Set<string>();
    const queue = [...(childrenByManager.get(name) ?? [])];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      queue.push(...(childrenByManager.get(current) ?? []));
    }
    descendantCache.set(name, visited.size);
    return visited.size;
  };

  const makeCard = (name: string): ReportOrgCard => {
    const person = peopleByName.get(name);
    const directCount = childrenByManager.get(name)?.length ?? 0;
    const totalCount = countDescendants(name);
    const changeCount = recentChangeByName.get(name) ?? 0;
    const confidenceValues = confidenceByName.get(name) ?? [];
    const confidence =
      confidenceValues.length === 0
        ? 0
        : confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length;
    const notes = [
      directCount >= 18 ? `管理跨度 ${directCount}，建议拆二级` : '',
      changeCount > 0 ? `近90天 ${changeCount} 条变动` : '',
      confidence > 0 && confidence < 0.75 ? '汇报线需复核' : '',
      person?.sensitiveNote ? clipText(person.sensitiveNote, 20) : '',
    ].filter(Boolean);
    return {
      key: name,
      personName: person?.name ?? name,
      title: person?.currentTitle ?? '岗位待确认',
      department: person?.currentDepartment ?? '部门待确认',
      company: person?.company ?? '公司待确认',
      directCount,
      totalCount,
      changeCount,
      evidenceCount: person?.evidenceIds.length ?? 0,
      confidence,
      note: notes[0] ?? '结构可用于汇报，细节可点开复核',
    };
  };

  const sortByScale = (a: string, b: string): number =>
    countDescendants(b) - countDescendants(a) ||
    (childrenByManager.get(b)?.length ?? 0) - (childrenByManager.get(a)?.length ?? 0) ||
    (peopleByName.get(a)?.currentDepartment ?? '').localeCompare(peopleByName.get(b)?.currentDepartment ?? '', 'zh-Hans-CN');

  const roots = [...peopleByName.keys()]
    .filter((name) => !managerBySubordinate.has(name) && (childrenByManager.get(name)?.length ?? 0) > 0)
    .sort(sortByScale);
  const rootKey = roots[0] ?? [...childrenByManager.keys()].sort(sortByScale)[0];
  if (!rootKey) return { firstLayer: [], secondLayerGroups: [] };

  const firstLayerKeys = (childrenByManager.get(rootKey) ?? []).sort(sortByScale).slice(0, 6);
  const secondLayerGroups = firstLayerKeys
    .slice(0, 4)
    .map((parentKey) => ({
      parent: makeCard(parentKey),
      children: (childrenByManager.get(parentKey) ?? []).sort(sortByScale).slice(0, 4).map(makeCard),
    }))
    .filter((group) => group.children.length > 0);

  return {
    root: makeCard(rootKey),
    firstLayer: firstLayerKeys.map(makeCard),
    secondLayerGroups,
  };
}

export async function exportReportPptx(
  state: AppState,
  filters: OrgMapFilters,
  fileName = `${state.project.name}.pptx`,
): Promise<void> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const anonymize = shouldMaskNames(state);
  const narrative = buildExecutiveNarrative(state);
  const orgModel = buildOrgHierarchyModel(state);
  const exportGraph = buildOrgGraph(state, filters);
  const chartPreviewWide = exportOrgGraphPng(state, filters, anonymize, 'ppt16x9');
  const chartHighlights = collectExportHighlights(state, exportGraph);
  const activeCanvasLabel =
    state.project.settings.activeCanvasView === 'mindmap'
      ? '汇报模式 · 树状图'
      : state.project.settings.activeCanvasView === 'executive'
        ? '汇报模式 · 常规架构图'
        : state.project.settings.activeCanvasView === 'detail'
          ? '招聘模式 · 树状图'
          : '招聘模式 · 常规架构图';
  const pendingCount = state.candidates.filter((candidate) => candidate.status === 'pending').length;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = '竞对组织架构 Mapping 工具';
  pptx.subject = '组织架构 mapping 汇报';
  pptx.title = state.project.name;
  pptx.company = 'Local Browser';
  pptx.theme = {
    headFontFace: 'Microsoft YaHei',
    bodyFontFace: 'Microsoft YaHei',
  };

  const deck = {
    bg: 'F7F8FA',
    ink: '172033',
    muted: '5F6B7A',
    faint: '86909C',
    blue: '0B5CFF',
    blueDark: '1247B2',
    blueSoft: 'EAF2FF',
    cyanSoft: 'EEF9FF',
    green: '00A870',
    greenSoft: 'EAF8F2',
    amber: 'D99000',
    amberSoft: 'FFF7E8',
    red: 'D54941',
    redSoft: 'FFF1F0',
    line: 'DDE6F3',
    panel: 'FFFFFF',
  };

  const toneColor = (tone?: string): string => {
    if (tone === 'danger') return deck.red;
    if (tone === 'warning') return deck.amber;
    if (tone === 'good') return deck.green;
    return deck.blue;
  };

  const addHeader = (slide: any, eyebrow: string, title: string, subtitle?: string) => {
    slide.background = { color: deck.bg };
    slide.addText(eyebrow, {
      x: 0.58,
      y: 0.28,
      w: 2.35,
      h: 0.24,
      fontSize: 7.5,
      bold: true,
      color: deck.blue,
      fill: { color: deck.blueSoft },
      align: 'center',
      margin: 0.03,
    });
    slide.addText(title, { x: 0.6, y: 0.66, w: 8.8, h: 0.42, fontSize: 20, bold: true, color: deck.ink, fit: 'shrink' });
    if (subtitle) {
      slide.addText(clipText(subtitle, 86), { x: 0.62, y: 1.12, w: 11.8, h: 0.26, fontSize: 8.5, color: deck.muted, fit: 'shrink' });
    }
  };

  const addFooter = (slide: any, index: number) => {
    slide.addText(`本地生成 · ${freshnessText(state.project.updatedAt)} · ${index}`, {
      x: 10.9,
      y: 7.06,
      w: 1.8,
      h: 0.2,
      fontSize: 6.5,
      color: deck.faint,
      align: 'right',
      margin: 0,
    });
  };

  const addMetric = (slide: any, x: number, y: number, w: number, label: string, value: string, accent = deck.blue) => {
    slide.addText(value, {
      x,
      y,
      w,
      h: 0.42,
      fontSize: 17,
      bold: true,
      color: deck.ink,
      fill: { color: deck.panel },
      line: { color: deck.line, pt: 0.6 },
      margin: 0.08,
      fit: 'shrink',
    });
    slide.addText(label, { x, y: y + 0.44, w, h: 0.2, fontSize: 7.5, bold: true, color: accent, margin: 0.02, fit: 'shrink' });
  };

  const addSectionLabel = (slide: any, label: string, x: number, y: number, w = 2.2) => {
    slide.addText(label, {
      x,
      y,
      w,
      h: 0.25,
      fontSize: 10,
      bold: true,
      color: deck.ink,
      margin: 0,
    });
  };

  const addBulletPanel = (slide: any, x: number, y: number, w: number, h: number, title: string, items: string[]) => {
    slide.addText(title, { x, y, w, h: 0.28, fontSize: 12, bold: true, color: deck.ink, margin: 0 });
    slide.addText(items.map((item) => `• ${clipText(maskKnownPeopleText(state, item), 70)}`).join('\n'), {
      x,
      y: y + 0.36,
      w,
      h: h - 0.36,
      fontSize: 9,
      color: '334155',
      fit: 'shrink',
      breakLine: false,
      valign: 'top',
      margin: 0,
    });
  };

  const addOrgCard = (
    slide: any,
    card: ReportOrgCard,
    x: number,
    y: number,
    w: number,
    h: number,
    options: { accent?: string; root?: boolean } = {},
  ) => {
    const fill = options.root ? deck.blueDark : card.changeCount > 0 ? deck.amberSoft : deck.panel;
    const color = options.root ? 'FFFFFF' : deck.ink;
    const muted = options.root ? 'DDEBFF' : deck.muted;
    slide.addText('', {
      x,
      y,
      w,
      h,
      fill: { color: fill },
      line: { color: options.accent ?? deck.line, pt: options.root ? 0 : 0.75 },
      margin: 0,
    });
    slide.addText(clipText(shouldMaskCompanies(state) ? '部门已脱敏' : card.department, 18), {
      x: x + 0.12,
      y: y + 0.12,
      w: w - 0.24,
      h: 0.2,
      fontSize: options.root ? 8.5 : 8,
      bold: true,
      color: muted,
      margin: 0,
      fit: 'shrink',
    });
    slide.addText(`${anonymize ? maskName(card.personName) : card.personName}｜${clipText(card.title, 12)}`, {
      x: x + 0.12,
      y: y + 0.38,
      w: w - 0.24,
      h: 0.28,
      fontSize: options.root ? 13 : 10.5,
      bold: true,
      color,
      margin: 0,
      fit: 'shrink',
    });
    slide.addText(`下属 ${card.totalCount} 人 · 直属 ${card.directCount} · 证据 ${card.evidenceCount}`, {
      x: x + 0.12,
      y: y + 0.74,
      w: w - 0.24,
      h: 0.2,
      fontSize: 7.4,
      color: muted,
      margin: 0,
      fit: 'shrink',
    });
    slide.addText(`备注：${clipText(state.project.settings.exportPrivacy?.notes ? '说明已脱敏' : card.note, 28)}`, {
      x: x + 0.12,
      y: y + h - 0.32,
      w: w - 0.24,
      h: 0.18,
      fontSize: 6.8,
      color: muted,
      margin: 0,
      fit: 'shrink',
    });
  };

  const addLine = (slide: any, x: number, y: number, w: number, h: number) => {
    slide.addShape(pptx.ShapeType.line, { x, y, w, h, line: { color: 'B8C7DA', pt: 1 } });
  };

  let pageNumber = 1;

  const mainSlide = pptx.addSlide();
  addHeader(mainSlide, 'CANVAS EXPORT', state.project.name, `按 ${activeCanvasLabel} 导出，保留当前筛选条件与手动布局。`);
  mainSlide.addText('', {
    x: 0.62,
    y: 1.48,
    w: 8.68,
    h: 5.36,
    fill: { color: deck.panel },
    line: { color: deck.line, pt: 0.75 },
    margin: 0,
  });
  if (exportGraph.nodes.length > 0) {
    mainSlide.addImage({ data: chartPreviewWide, x: 0.78, y: 1.66, w: 8.36, h: 5.0 });
  } else {
    mainSlide.addText('暂无可导出的组织图，请先确认候选关系。', {
      x: 1.0,
      y: 3.75,
      w: 7.6,
      h: 0.38,
      fontSize: 16,
      bold: true,
      color: deck.ink,
      align: 'center',
    });
  }
  mainSlide.addText('', {
    x: 9.58,
    y: 1.48,
    w: 3.02,
    h: 5.36,
    fill: { color: deck.panel },
    line: { color: deck.line, pt: 0.75 },
    margin: 0,
  });
  mainSlide.addText('导出摘要', { x: 9.84, y: 1.72, w: 1.6, h: 0.24, fontSize: 12, bold: true, color: deck.blueDark, margin: 0 });
  mainSlide.addText(
    [
      `视图：${activeCanvasLabel}`,
      `节点：${exportGraph.nodes.length}`,
      `关系：${exportGraph.edges.length}`,
      `隐藏下钻：${exportGraph.diagnostics.hiddenDirectReports}`,
      `待复核：${exportGraph.diagnostics.weakRelationCount}`,
      `近期变更：${exportGraph.diagnostics.recentChangePeopleCount}`,
    ].join('\n'),
    {
      x: 9.84,
      y: 2.05,
      w: 2.44,
      h: 1.48,
      fontSize: 8.6,
      color: deck.ink,
      fit: 'shrink',
      margin: 0,
    },
  );
  addBulletPanel(
    mainSlide,
    9.84,
    3.8,
    2.44,
    1.9,
    '关键备注',
    chartHighlights.length > 0 ? chartHighlights : ['当前画布未发现需要额外说明的结构异常。'],
  );
  addFooter(mainSlide, pageNumber++);

  const overviewSlide = pptx.addSlide();
  addHeader(overviewSlide, 'COMPETITOR ORG MAPPING', '组织判断总览', maskKnownPeopleText(state, narrative.headline));
  addMetric(overviewSlide, 0.62, 1.55, 2.25, shouldMaskCompanies(state) ? '公司已脱敏' : '覆盖公司', shouldMaskCompanies(state) ? '已脱敏' : `${state.project.companies.length} 家`);
  addMetric(overviewSlide, 3.08, 1.55, 2.25, '人员样本', `${state.people.length} 人`, deck.green);
  addMetric(overviewSlide, 5.54, 1.55, 2.25, '当前汇报线', `${narrative.metrics.reportingLineCount} 条`);
  addMetric(overviewSlide, 8.0, 1.55, 2.25, '汇报准备度', `${narrative.metrics.readinessScore} 分`, narrative.metrics.readinessScore >= 82 ? deck.green : deck.amber);
  addMetric(overviewSlide, 10.46, 1.55, 2.25, '待确认', `${pendingCount} 条`, pendingCount > 0 ? deck.red : deck.green);
  overviewSlide.addText('', { x: 0.62, y: 2.45, w: 7.35, h: 3.82, fill: { color: deck.panel }, line: { color: deck.line, pt: 0.8 }, margin: 0 });
  addBulletPanel(overviewSlide, 0.9, 2.78, 6.75, 1.38, '管理层先看三件事', narrative.summaryBullets.slice(0, 3));
  overviewSlide.addShape(pptx.ShapeType.line, { x: 0.9, y: 4.4, w: 6.65, h: 0, line: { color: deck.line, pt: 0.6 } });
  addBulletPanel(overviewSlide, 0.9, 4.68, 6.75, 1.12, '建议动作', narrative.nextActions.slice(0, 2));
  overviewSlide.addText('', { x: 8.28, y: 2.45, w: 4.28, h: 3.82, fill: { color: deck.blueSoft }, line: { color: 'CFE0FF', pt: 0.8 }, margin: 0 });
  overviewSlide.addText('本页结论', { x: 8.58, y: 2.78, w: 1.4, h: 0.28, fontSize: 12, bold: true, color: deck.blueDark, margin: 0 });
  overviewSlide.addText(clipText(maskKnownPeopleText(state, narrative.nextActions[0] ?? narrative.headline), 78), {
    x: 8.58,
    y: 3.2,
    w: 3.55,
    h: 1.05,
    fontSize: 13,
    bold: true,
    color: deck.ink,
    fit: 'shrink',
    margin: 0,
  });
  overviewSlide.addText(
    `适用场景：向上汇报组织判断、同步高招 mapping 方向、标记需要复核的关键岗位。`,
    { x: 8.58, y: 4.58, w: 3.45, h: 0.8, fontSize: 8.5, color: deck.muted, fit: 'shrink', margin: 0 },
  );
  addFooter(overviewSlide, pageNumber++);

  const layerSlide = pptx.addSlide();
  addHeader(layerSlide, 'ORG DETAIL', '关键团队二级拆解', '优先展开管理跨度大、近期变动多或高招价值高的团队。');
  const groupWidth = 2.95;
  orgModel.secondLayerGroups.slice(0, 4).forEach((group, groupIndex) => {
    const x = 0.62 + groupIndex * 3.1;
    slideColumn(layerSlide, pptx, deck, group.parent, group.children, x, 1.55, groupWidth, anonymize, state);
  });
  if (orgModel.secondLayerGroups.length === 0) {
    layerSlide.addText('暂无二级团队信息。建议在确认页补齐部门负责人和汇报线后重新导出。', {
      x: 0.7,
      y: 2.8,
      w: 8.4,
      h: 0.38,
      fontSize: 15,
      bold: true,
      color: deck.ink,
    });
  }
  addFooter(layerSlide, pageNumber++);

  const businessSlide = pptx.addSlide();
  addHeader(businessSlide, 'BUSINESS VIEW', '业务单元画像与组织信号', '把组织图转换成 HRBP 能判断的业务与人才问题。');
  narrative.businessLines.slice(0, 6).forEach((line, index) => {
    const x = 0.62 + (index % 3) * 4.1;
    const y = 1.55 + Math.floor(index / 3) * 1.42;
    businessSlide.addText('', {
      x,
      y,
      w: 3.55,
      h: 1.05,
      fill: { color: line.tone === 'good' ? deck.greenSoft : line.tone === 'warning' ? deck.amberSoft : deck.redSoft },
      line: { color: toneColor(line.tone), pt: 0.65 },
      margin: 0,
    });
    businessSlide.addText(`${line.name}｜${line.strategicTag}`, { x: x + 0.14, y: y + 0.14, w: 3.1, h: 0.22, fontSize: 10, bold: true, color: deck.ink, margin: 0, fit: 'shrink' });
    businessSlide.addText(`${line.peopleCount} 人 · ${line.managerCount} 管理者 · ${line.talentCount} 重点人才`, {
      x: x + 0.14,
      y: y + 0.46,
      w: 3.1,
      h: 0.2,
      fontSize: 8,
      color: deck.muted,
      margin: 0,
      fit: 'shrink',
    });
    businessSlide.addText(clipText(line.note, 28), { x: x + 0.14, y: y + 0.72, w: 3.1, h: 0.18, fontSize: 7.3, color: deck.muted, margin: 0, fit: 'shrink' });
  });
  addSectionLabel(businessSlide, '需要 HR 决策的问题', 0.65, 4.65, 2.8);
  const gapText = narrative.positionGaps.slice(0, 4).map((gap) => `• ${gap.priority} ${gap.area}：${gap.gap}`).join('\n') || '• 暂无明显岗位缺口，建议继续补充重点人才标记。';
  businessSlide.addText(gapText, {
    x: 0.65,
    y: 5.02,
    w: 5.85,
    h: 1.05,
    fontSize: 9,
    color: '334155',
    fit: 'shrink',
    margin: 0,
  });
  addSectionLabel(businessSlide, '组织信号解释', 7.0, 4.65, 2.8);
  businessSlide.addText(
    narrative.businessSignals.slice(0, 3).map((signal) => `• ${signal.title}：${state.project.settings.exportPrivacy?.notes ? '说明已脱敏' : clipText(maskKnownPeopleText(state, signal.interpretation), 48)}`).join('\n'),
    { x: 7.0, y: 5.02, w: 5.4, h: 1.05, fontSize: 9, color: '334155', fit: 'shrink', margin: 0 },
  );
  addFooter(businessSlide, pageNumber++);

  const recruitingSlide = pptx.addSlide();
  addHeader(recruitingSlide, 'RECRUITING MODE', '高招 mapping 作战页', '把组织结构转换成可跟进的人、团队入口和复核动作。');
  recruitingSlide.addTable(
    [
      ['优先级', '人选', '层级', '部门', '建议动作'],
      ...narrative.recruitingActions.slice(0, 8).map((item) => [
        item.priority,
        anonymize ? maskName(item.personName) : item.personName,
        item.level,
        item.department,
        item.nextStep,
      ]),
    ] as any,
    {
      x: 0.62,
      y: 1.55,
      w: 8.0,
      h: 4.75,
      border: { type: 'solid', color: deck.line, pt: 0.55 },
      fontFace: 'Microsoft YaHei',
      fontSize: 7.7,
      color: deck.ink,
      fill: { color: deck.panel },
      margin: 0.04,
    },
  );
  addBulletPanel(
    recruitingSlide,
    9.0,
    1.55,
    3.4,
    2.1,
    '招聘侧使用方式',
    [
      '先按部门聚焦一号位，再展开二级团队。',
      '只把强证据人选进入触达池，弱证据先复核。',
      '变更密集团队优先做人才流动观察。',
    ],
  );
  addBulletPanel(
    recruitingSlide,
    9.0,
    4.15,
    3.4,
    1.9,
    '下一步',
    narrative.nextActions.slice(0, 3),
  );
  addFooter(recruitingSlide, pageNumber++);

  const riskSlide = pptx.addSlide();
  addHeader(riskSlide, 'RISK & METHOD', '风险、证据与汇报口径', '明确哪些结论可以汇报，哪些需要人工复核。');
  narrative.risks.slice(0, 3).forEach((risk, index) => {
    const x = 0.65;
    const y = 1.55 + index * 1.04;
    riskSlide.addText('', {
      x,
      y,
      w: 5.85,
      h: 0.84,
      fill: { color: risk.tone === 'danger' ? deck.redSoft : risk.tone === 'warning' ? deck.amberSoft : deck.greenSoft },
      line: { color: toneColor(risk.tone), pt: 0.7 },
      margin: 0,
    });
    riskSlide.addText(risk.title, { x: x + 0.16, y: y + 0.14, w: 1.8, h: 0.22, fontSize: 10, bold: true, color: deck.ink, margin: 0 });
    riskSlide.addText(clipText(maskKnownPeopleText(state, risk.body), 78), { x: x + 1.55, y: y + 0.16, w: 4.05, h: 0.42, fontSize: 8, color: deck.muted, fit: 'shrink', valign: 'top', margin: 0 });
  });
  addBulletPanel(
    riskSlide,
    7.15,
    1.55,
    5.0,
    2.2,
    '汇报前检查',
    [
      '强证据关系可进入管理汇报，弱证据保留复核标记。',
      '截图/OCR 信息只作为线索，不作为最终组织事实。',
      '涉及裁员、空降、调岗等备注，外发前确认隐私口径。',
    ],
  );
  addSectionLabel(riskSlide, '证据健康度', 0.65, 4.55, 2.2);
  [
    ['强证据', `${narrative.metrics.strongEvidenceCount}`, deck.green],
    ['弱信号', `${narrative.metrics.weakSignalCount}`, narrative.metrics.weakSignalCount > 0 ? deck.amber : deck.green],
    ['超期人员', `${narrative.metrics.stalePeopleCount}`, narrative.metrics.stalePeopleCount > 0 ? deck.amber : deck.green],
    ['口径冲突', `${narrative.metrics.conflictCount}`, narrative.metrics.conflictCount > 0 ? deck.red : deck.green],
  ].forEach(([label, value, accent], index) => addMetric(riskSlide, 0.65 + index * 1.55, 4.92, 1.28, label, value, accent));
  const weights = narrative.metrics.normalizedWeights;
  riskSlide.addText(
    [
      `准备度口径：覆盖 ${Math.round(weights.coverage * 100)}%，可信 ${Math.round(weights.confidence * 100)}%，时效 ${Math.round(weights.freshness * 100)}%，确认 ${Math.round(weights.confirmation * 100)}%。`,
      `导出隐私：姓名 ${state.project.settings.exportPrivacy?.names ? '脱敏' : '原样'}，公司 ${state.project.settings.exportPrivacy?.companies ? '脱敏' : '原样'}，备注 ${state.project.settings.exportPrivacy?.notes ? '脱敏' : '原样'}。`,
      '自动判断只作为结构化草稿，最终外发以人工确认后的组织关系为准。',
    ].join('\n'),
    { x: 7.35, y: 4.72, w: 5.0, h: 1.15, fontSize: 8.3, color: '334155', fit: 'shrink', margin: 0 },
  );
  const peopleRows = state.people.slice(0, 10).map((person) => [
    displayPerson(person, anonymize),
    displayCompany(state, person.company),
    person.currentDepartment ?? '待确认',
    person.currentTitle ?? '待确认',
    person.tags.slice(0, 2).join('、') || (person.status === 'left' ? '已离开' : '在职/待确认'),
  ]);
  addFooter(riskSlide, pageNumber++);

  const changeRows = state.changeEvents.slice(0, 10).map((event) => [
    event.date ?? event.createdAt.slice(0, 10),
    anonymize && event.personName ? maskName(event.personName) : event.personName ?? '-',
    changeTypeText(event.type),
    state.project.settings.exportPrivacy?.notes ? '说明已脱敏' : clipText(event.description, 42),
    state.project.settings.exportPrivacy?.sources ? '来源已脱敏' : clipText(event.sourceName ?? '-', 22),
  ]);
  if (peopleRows.length > 0) {
    const peopleSlide = pptx.addSlide();
    addHeader(peopleSlide, 'APPENDIX', '关键人员清单', '保留可编辑表格，便于 HRBP 二次筛选。');
    peopleSlide.addTable([['姓名', '公司', '部门', '岗位', '标签/状态'], ...peopleRows] as any, {
      x: 0.62,
      y: 1.48,
      w: 12.0,
      h: 5.1,
      border: { type: 'solid', color: deck.line, pt: 0.55 },
      fontFace: 'Microsoft YaHei',
      fontSize: 8.2,
      color: deck.ink,
      fill: { color: deck.panel },
      margin: 0.05,
    });
    addFooter(peopleSlide, pageNumber++);
  }

  if (changeRows.length > 0) {
    const changesSlide = pptx.addSlide();
    addHeader(changesSlide, 'APPENDIX', '近期变更与风险记录', '用于解释组织变化、离职、调岗和信息冲突。');
    changesSlide.addTable([['日期', '人员', '类型', '说明', '来源'], ...changeRows] as any, {
      x: 0.62,
      y: 1.48,
      w: 12.0,
      h: 5.1,
      border: { type: 'solid', color: deck.line, pt: 0.55 },
      fontFace: 'Microsoft YaHei',
      fontSize: 8,
      color: deck.ink,
      fill: { color: deck.panel },
      margin: 0.05,
    });
    addFooter(changesSlide, pageNumber++);
  }

  await pptx.writeFile({ fileName });
}

function slideColumn(
  slide: any,
  pptx: any,
  deck: Record<string, string>,
  parent: ReportOrgCard,
  children: ReportOrgCard[],
  x: number,
  y: number,
  w: number,
  anonymize: boolean,
  state: AppState,
): void {
  slide.addText('', {
    x,
    y,
    w,
    h: 4.75,
    fill: { color: deck.panel },
    line: { color: deck.line, pt: 0.65 },
    margin: 0,
  });
  slide.addText(clipText(parent.department, 16), { x: x + 0.12, y: y + 0.16, w: w - 0.24, h: 0.2, fontSize: 8, bold: true, color: deck.blue, margin: 0, fit: 'shrink' });
  slide.addText(`${anonymize ? maskName(parent.personName) : parent.personName}｜${clipText(parent.title, 10)}`, {
    x: x + 0.12,
    y: y + 0.44,
    w: w - 0.24,
    h: 0.25,
    fontSize: 10.5,
    bold: true,
    color: deck.ink,
    margin: 0,
    fit: 'shrink',
  });
  slide.addText(`下属 ${parent.totalCount} 人 · 直属 ${parent.directCount}`, {
    x: x + 0.12,
    y: y + 0.78,
    w: w - 0.24,
    h: 0.18,
    fontSize: 7.2,
    color: deck.muted,
    margin: 0,
    fit: 'shrink',
  });
  slide.addShape(pptx.ShapeType.line, { x: x + w / 2, y: y + 1.08, w: 0, h: 0.25, line: { color: 'B8C7DA', pt: 0.8 } });
  children.slice(0, 4).forEach((child, index) => {
    const childY = y + 1.42 + index * 0.78;
    slide.addText('', {
      x: x + 0.16,
      y: childY,
      w: w - 0.32,
      h: 0.56,
      fill: { color: child.changeCount > 0 ? deck.amberSoft : deck.bg },
      line: { color: child.changeCount > 0 ? deck.amber : deck.line, pt: 0.45 },
      margin: 0,
    });
    slide.addText(`${anonymize ? maskName(child.personName) : child.personName}｜${clipText(child.department, 12)}`, {
      x: x + 0.28,
      y: childY + 0.1,
      w: w - 0.56,
      h: 0.18,
      fontSize: 7.7,
      bold: true,
      color: deck.ink,
      margin: 0,
      fit: 'shrink',
    });
    slide.addText(`团队 ${child.totalCount} 人 · ${state.project.settings.exportPrivacy?.notes ? '备注已脱敏' : clipText(child.note, 14)}`, {
      x: x + 0.28,
      y: childY + 0.34,
      w: w - 0.56,
      h: 0.16,
      fontSize: 6.4,
      color: deck.muted,
      margin: 0,
      fit: 'shrink',
    });
  });
}
