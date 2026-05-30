import pptxgen from 'pptxgenjs';
import type { AppState, OrgChartExportFormat, OrgMapFilters, Person } from '../types';
import { buildOrgGraph } from './graph';
import { buildExecutiveNarrative } from './insights';

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
  const nodeWidth = isReport ? (isMindMap ? 214 : 226) : isMindMap ? 202 : 216;
  const nodeHeight = isReport ? (isMindMap ? 84 : 106) : isMindMap ? 70 : 106;
  const modeText = isReport ? '汇报模式' : '招聘模式';
  const styleText = isMindMap ? '树状图' : '常规架构图';
  const bounds = [
    ...graph.nodes.map((node) => ({ x1: node.x, y1: node.y, x2: node.x + nodeWidth + 34, y2: node.y + nodeHeight + 28 })),
    ...graph.lanes.map((lane) => ({ x1: lane.x, y1: lane.y, x2: lane.x + lane.width, y2: lane.y + lane.height })),
  ];
  const minX = bounds.length ? Math.min(...bounds.map((item) => item.x1)) : 0;
  const minY = bounds.length ? Math.min(...bounds.map((item) => item.y1)) : 0;
  const maxX = bounds.length ? Math.max(...bounds.map((item) => item.x2)) : 1120;
  const maxY = bounds.length ? Math.max(...bounds.map((item) => item.y2)) : 620;
  const chartPadding = 36;
  const headerHeight = format === 'longImage' ? 96 : 128;
  const contentWidth = Math.max(1120, maxX - minX + chartPadding * 2);
  const contentHeight = Math.max(560, maxY - minY + chartPadding * 2);
  const fixedSize =
    format === 'ppt16x9'
      ? { width: 1920, height: 1080 }
      : format === 'a4Landscape'
        ? { width: 1754, height: 1240 }
        : undefined;
  const width = fixedSize?.width ?? contentWidth;
  const height = fixedSize?.height ?? contentHeight + headerHeight + 36;
  const scale = fixedSize ? Math.min((width - 110) / contentWidth, (height - headerHeight - 56) / contentHeight, 1.18) : 1;
  const offsetX = fixedSize ? Math.max(54, (width - contentWidth * scale) / 2) : 0;
  const offsetY = headerHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('浏览器不支持 Canvas 导出。');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#0f172a';
  context.fillRect(0, 0, width, fixedSize ? 92 : 74);
  context.fillStyle = '#ffffff';
  context.font = '700 30px Microsoft YaHei, sans-serif';
  context.fillText(state.project.name, 40, 45);
  context.fillStyle = '#cbd5e1';
  context.font = '15px Microsoft YaHei, sans-serif';
  context.fillText(
    `${modeText} · ${styleText} · ${graph.nodes.length} 个节点 · ${graph.edges.length} 条关系 · ${format === 'ppt16x9' ? 'PPT 16:9' : format === 'a4Landscape' ? 'A4 横版' : '长图'}`,
    40,
    73,
  );
  context.fillStyle = '#f8fafc';
  context.fillRect(0, fixedSize ? 92 : 74, width, height - (fixedSize ? 92 : 74));

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  context.save();
  context.translate(offsetX - (minX - chartPadding) * scale, offsetY - (minY - chartPadding) * scale);
  context.scale(scale, scale);

  for (const lane of graph.lanes) {
    context.fillStyle = '#f0f6ff';
    context.strokeStyle = '#c7ddff';
    context.lineWidth = 1.2;
    context.beginPath();
    context.roundRect(lane.x, lane.y, lane.width, lane.height, 12);
    context.fill();
    context.stroke();
    context.fillStyle = '#1d4ed8';
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

    context.strokeStyle = edge.confidence < 0.72 ? '#d54941' : isMindMap ? '#1f2329' : '#1677ff';
    context.lineWidth = isMindMap ? 1.4 : 2;
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
    context.fillStyle = node.status === 'left' ? '#fff1f0' : node.changeCount > 0 ? '#fffaf0' : '#ffffff';
    context.strokeStyle = node.status === 'left' ? '#d54941' : node.isFocus ? '#0b5cff' : node.changeCount > 0 ? '#efd99a' : '#c7d6e8';
    context.lineWidth = 1.5;
    context.beginPath();
    context.roundRect(node.x, node.y, nodeWidth, nodeHeight, isMindMap && node.depth >= 2 ? 0 : 8);
    context.fill();
    context.stroke();

    const orgText = shouldMaskCompanies(state) ? '组织已脱敏' : node.department ?? node.company ?? '组织待确认';
    const displayName = anonymize ? maskName(node.label) : node.label;
    const noteCount = node.changeCount + (node.hiddenDirectCount > 0 ? 1 : 0) + (node.averageConfidence < 0.75 ? 1 : 0);

    if (isReport) {
      context.fillStyle = '#1f2329';
      context.font = `700 ${isMindMap ? 14 : 16}px Microsoft YaHei, sans-serif`;
      context.fillText(orgText.slice(0, isMindMap ? 14 : 16), node.x + 12, node.y + 25);
      context.fillStyle = '#4e5969';
      context.font = '12px Microsoft YaHei, sans-serif';
      context.fillText(`一号位 ${displayName}`.slice(0, 19), node.x + 12, node.y + 48);
      context.font = '650 12px Microsoft YaHei, sans-serif';
      context.fillText(`下属 ${Math.max(node.span, node.visibleSpan)} 人`, node.x + 12, node.y + 68);
      if (!isMindMap || node.depth <= 1) {
        context.fillStyle = '#0b5cff';
        context.fillText(`备注${noteCount > 0 ? ` ${noteCount}` : ''}`, node.x + 12, node.y + nodeHeight - 12);
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
        context.fillStyle = node.isTalent ? '#00a870' : '#4e5969';
        context.fillText(
          `${node.isTalent ? '重点 · ' : ''}${node.visibleSpan}/${node.span} 下属${node.hiddenDirectCount ? ` · +${node.hiddenDirectCount}` : ''}`,
          node.x + 12,
          node.y + 92,
        );
      }
    }
  }
  context.restore();

  return canvas.toDataURL('image/png');
}

export async function exportReportPptx(
  state: AppState,
  filters: OrgMapFilters,
  fileName = `${state.project.name}.pptx`,
): Promise<void> {
  const anonymize = shouldMaskNames(state);
  const narrative = buildExecutiveNarrative(state);
  const graphPng = exportOrgGraphPng(state, filters, anonymize, 'ppt16x9');
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = '竞对组织架构 Mapping 工具';
  pptx.subject = '组织架构 mapping 汇报';
  pptx.title = state.project.name;
  pptx.company = 'Local Browser';
  pptx.theme = {
    headFontFace: 'Microsoft YaHei',
    bodyFontFace: 'Microsoft YaHei',
  };
  const pendingCount = state.candidates.filter((candidate) => candidate.status === 'pending').length;
  const deck = {
    bg: 'F7F9FC',
    ink: '172033',
    muted: '5B667A',
    blue: '1677FF',
    softBlue: 'EAF2FF',
    green: '00A870',
    line: 'DDE6F3',
    panel: 'FFFFFF',
  };
  const addSlideTitle = (slide: any, eyebrow: string, title: string, subtitle?: string) => {
    slide.background = { color: deck.bg };
    slide.addText(eyebrow, {
      x: 0.55,
      y: 0.28,
      w: 2.3,
      h: 0.24,
      fontSize: 8,
      bold: true,
      color: deck.blue,
      fill: { color: deck.softBlue },
      align: 'center',
      margin: 0.03,
    });
    slide.addText(title, { x: 0.55, y: 0.63, w: 8.6, h: 0.42, fontSize: 20, bold: true, color: deck.ink });
    if (subtitle) {
      slide.addText(subtitle, { x: 0.55, y: 1.05, w: 11.8, h: 0.28, fontSize: 9, color: deck.muted, fit: 'shrink' });
    }
  };
  const addMetricCard = (slide: any, x: number, label: string, value: string, accent = deck.blue) => {
    slide.addText(value, {
      x,
      y: 1.3,
      w: 2.25,
      h: 0.45,
      fontSize: 18,
      bold: true,
      color: deck.ink,
      fill: { color: deck.panel },
      line: { color: deck.line, pt: 0.7 },
      margin: 0.08,
    });
    slide.addText(label, { x, y: 1.76, w: 2.25, h: 0.22, fontSize: 8, bold: true, color: accent, margin: 0.02 });
  };

  const cover = pptx.addSlide();
  addSlideTitle(cover, 'LOCAL ORG MAPPING', state.project.name, maskKnownPeopleText(state, narrative.headline));
  addMetricCard(cover, 0.55, shouldMaskCompanies(state) ? '公司已脱敏' : '覆盖公司', shouldMaskCompanies(state) ? '已脱敏' : `${state.project.companies.length} 家`);
  addMetricCard(cover, 3.05, '人员', `${state.people.length} 人`, deck.green);
  addMetricCard(cover, 5.55, '汇报线', `${state.reportingLines.length} 条`);
  addMetricCard(cover, 8.05, '准备度', `${narrative.metrics.readinessScore} 分`, narrative.metrics.readinessScore >= 80 ? deck.green : 'D99000');
  addMetricCard(cover, 10.55, '待确认', `${pendingCount} 条`, pendingCount > 0 ? 'D54941' : deck.green);
  cover.addText('', {
    x: 0.48,
    y: 2.18,
    w: 12.35,
    h: 4.66,
    fill: { color: deck.panel },
    line: { color: deck.line, pt: 1 },
    margin: 0,
  });
  cover.addImage({ data: graphPng, x: 0.65, y: 2.35, w: 12.0, h: 4.33 });

  const summarySlide = pptx.addSlide();
  addSlideTitle(summarySlide, 'EXECUTIVE SUMMARY', '管理结论与下一步', maskKnownPeopleText(state, narrative.headline));
  addMetricCard(summarySlide, 0.55, '汇报准备度', `${narrative.metrics.readinessScore} 分`);
  addMetricCard(summarySlide, 3.05, '覆盖度', `${narrative.metrics.coverageScore} 分`);
  addMetricCard(summarySlide, 5.55, '可信度', `${narrative.metrics.confidenceScore} 分`, deck.green);
  addMetricCard(summarySlide, 8.05, '时效性', `${narrative.metrics.freshnessScore} 分`, 'D99000');
  summarySlide.addTable(
    [
      ['指标', '结果', '口径'],
      ['汇报准备度', `${narrative.metrics.readinessScore}分`, narrative.metrics.readinessLabel],
      ['覆盖度', `${narrative.metrics.coverageScore}分`, '任职、汇报线、人员证据综合'],
      ['可信度', `${narrative.metrics.confidenceScore}分`, '证据与汇报线平均置信度'],
      ['时效性', `${narrative.metrics.freshnessScore}分`, `${state.project.settings.staleAfterDays}天内更新占比`],
    ] as any,
    {
      x: 0.6,
      y: 2.26,
      w: 5.9,
      h: 1.65,
      border: { type: 'solid', color: deck.line, pt: 0.7 },
      fontFace: 'Microsoft YaHei',
      fontSize: 9,
      color: deck.ink,
      fill: { color: deck.panel },
      margin: 0.06,
    },
  );
  summarySlide.addText('关键结论', { x: 6.8, y: 2.26, w: 2.4, h: 0.28, fontSize: 13, bold: true, color: deck.ink });
  summarySlide.addText(narrative.summaryBullets.map((item) => `• ${maskKnownPeopleText(state, item)}`).join('\n'), {
    x: 6.8,
    y: 2.62,
    w: 5.4,
    h: 1.3,
    fontSize: 10,
    color: '354B45',
    fill: { color: deck.panel },
    line: { color: deck.line, pt: 0.7 },
    breakLine: false,
    fit: 'shrink',
    margin: 0.1,
  });
  summarySlide.addText('建议动作', { x: 0.6, y: 4.25, w: 2.4, h: 0.28, fontSize: 13, bold: true, color: deck.ink });
  summarySlide.addText(narrative.nextActions.map((item) => `• ${maskKnownPeopleText(state, item)}`).join('\n'), {
    x: 0.6,
    y: 4.6,
    w: 5.9,
    h: 1.35,
    fontSize: 10,
    color: '354B45',
    fill: { color: deck.panel },
    line: { color: deck.line, pt: 0.7 },
    fit: 'shrink',
    margin: 0.1,
  });
  summarySlide.addText('业务解释', { x: 6.8, y: 4.25, w: 2.4, h: 0.28, fontSize: 13, bold: true, color: deck.ink });
  summarySlide.addTable(
    [
      ['信号', '解释'],
      ...narrative.businessSignals.slice(0, 4).map((signal) => [
        signal.title,
        state.project.settings.exportPrivacy?.notes ? '说明已脱敏' : maskKnownPeopleText(state, signal.interpretation),
      ]),
    ] as any,
    {
      x: 6.8,
      y: 4.6,
      w: 5.5,
      h: 1.65,
      border: { type: 'solid', color: deck.line, pt: 0.7 },
      fontFace: 'Microsoft YaHei',
      fontSize: 8,
      color: deck.ink,
      fill: { color: deck.panel },
      margin: 0.05,
    },
  );

  const evidenceSlide = pptx.addSlide();
  addSlideTitle(evidenceSlide, 'DATA QUALITY', '证据健康度与组织风险', '用于判断这份 mapping 是否适合进入管理汇报或高招动作。');
  const evidenceRows = [
    ['强证据', `${narrative.metrics.strongEvidenceCount}`, '置信度不低于85%的证据片段'],
    ['弱信号', `${narrative.metrics.weakSignalCount}`, '弱证据与弱候选合计'],
    ['超期人员', `${narrative.metrics.stalePeopleCount}`, '超过时效阈值未更新'],
    ['组织孤点', `${narrative.metrics.orphanPeopleCount}`, '尚未接入当前汇报线'],
    ['最大管理跨度', `${narrative.metrics.maxSpan}`, '单一管理者可见直属下级'],
  ];
  evidenceSlide.addTable([['维度', '数量', '解释'], ...evidenceRows] as any, {
    x: 0.6,
    y: 1.55,
    w: 6,
    h: 2.8,
    border: { type: 'solid', color: deck.line, pt: 0.7 },
    fontFace: 'Microsoft YaHei',
    fontSize: 9,
    color: deck.ink,
    fill: { color: deck.panel },
    margin: 0.06,
  });
  evidenceSlide.addText('重点管理跨度', { x: 7.0, y: 1.55, w: 3, h: 0.3, fontSize: 13, bold: true, color: deck.ink });
  evidenceSlide.addTable(
    [
      ['负责人', '直属下级', '部门'],
      ...narrative.metrics.wideSpanManagers.slice(0, 6).map((item) => [
        anonymize ? maskName(item.name) : item.name,
        `${item.count}`,
        item.department ?? '待确认',
      ]),
    ] as any,
    {
      x: 7,
      y: 1.95,
      w: 5.2,
      h: 2.4,
      border: { type: 'solid', color: deck.line, pt: 0.7 },
      fontFace: 'Microsoft YaHei',
      fontSize: 9,
      color: deck.ink,
      fill: { color: deck.panel },
      margin: 0.06,
    },
  );
  evidenceSlide.addText('专业口径', { x: 0.6, y: 4.55, w: 2.6, h: 0.3, fontSize: 13, bold: true, color: deck.ink });
  const weights = narrative.metrics.normalizedWeights;
  evidenceSlide.addText(
    [
      `覆盖度口径：任职覆盖 ${narrative.metrics.roleCoverageScore} 分，汇报线覆盖 ${narrative.metrics.lineCoverageScore} 分，证据覆盖 ${narrative.metrics.evidenceCoverageScore} 分。`,
      `准备度权重：覆盖 ${Math.round(weights.coverage * 100)}%，可信 ${Math.round(weights.confidence * 100)}%，时效 ${Math.round(weights.freshness * 100)}%，确认 ${Math.round(weights.confirmation * 100)}%。`,
      `导出版本：${state.project.settings.reportTemplate}；隐私设置会影响姓名、公司、来源和备注显示。`,
      `建议模板：${narrative.templateAdvice.reason}`,
    ].join('\n'),
    {
      x: 0.6,
      y: 4.9,
      w: 11.6,
      h: 1.2,
      fontSize: 10,
      color: '354B45',
      fill: { color: deck.panel },
      line: { color: deck.line, pt: 0.7 },
      fit: 'shrink',
      margin: 0.1,
    },
  );

  const peopleSlide = pptx.addSlide();
  addSlideTitle(peopleSlide, 'TALENT LIST', '关键人员清单', '优先展示可用于高招 mapping 和业务复核的人员信息。');
  const peopleRows = state.people.slice(0, 14).map((person) => [
    displayPerson(person, anonymize),
    displayCompany(state, person.company),
    person.currentDepartment ?? '待确认',
    person.currentTitle ?? '待确认',
    person.status === 'left' ? '已离开' : '在职/待确认',
  ]);
  peopleSlide.addTable([['姓名', '公司', '部门', '岗位', '状态'], ...peopleRows] as any, {
    x: 0.6,
    y: 1.42,
    w: 12,
    h: 5.45,
    border: { type: 'solid', color: deck.line, pt: 0.7 },
    fontFace: 'Microsoft YaHei',
    fontSize: 9,
    color: deck.ink,
    fill: { color: deck.panel },
    margin: 0.06,
  });

  const changesSlide = pptx.addSlide();
  addSlideTitle(changesSlide, 'CHANGE LOG', '近期变更与风险', '用于解释组织变化、离职、调岗和信息冲突。');
  const changeRows = state.changeEvents.slice(0, 18).map((event) => [
    event.date ?? event.createdAt.slice(0, 10),
    anonymize && event.personName ? maskName(event.personName) : event.personName ?? '-',
    event.type,
    state.project.settings.exportPrivacy?.notes ? '说明已脱敏' : event.description,
    state.project.settings.exportPrivacy?.sources ? '来源已脱敏' : event.sourceName ?? '-',
  ]);
  changesSlide.addTable([['日期', '人员', '类型', '说明', '来源'], ...changeRows] as any, {
    x: 0.6,
    y: 1.42,
    w: 12,
    h: 5.45,
    border: { type: 'solid', color: deck.line, pt: 0.7 },
    fontFace: 'Microsoft YaHei',
    fontSize: 9,
    color: deck.ink,
    fill: { color: deck.panel },
    margin: 0.06,
  });

  await pptx.writeFile({ fileName });
}
