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
  const contentWidth = Math.max(1200, ...graph.nodes.map((node) => node.x + 260), ...graph.lanes.map((lane) => lane.x + lane.width + 40), 1200);
  const contentHeight = Math.max(720, ...graph.nodes.map((node) => node.y + 150), ...graph.lanes.map((lane) => lane.y + lane.height + 40), 720);
  const fixedSize =
    format === 'ppt16x9'
      ? { width: 1920, height: 1080 }
      : format === 'a4Landscape'
        ? { width: 1754, height: 1240 }
        : undefined;
  const width = fixedSize?.width ?? contentWidth;
  const height = fixedSize?.height ?? contentHeight;
  const scale = fixedSize ? Math.min((width - 96) / contentWidth, (height - 150) / contentHeight, 1) : 1;
  const offsetX = fixedSize ? Math.max(48, (width - contentWidth * scale) / 2) : 0;
  const offsetY = fixedSize ? 108 : 0;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('浏览器不支持 Canvas 导出。');
  }

  context.fillStyle = '#f5f7fb';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#1f2329';
  context.font = '700 26px Microsoft YaHei, sans-serif';
  context.fillText(state.project.name, 40, 44);
  context.fillStyle = '#646a73';
  context.font = '14px Microsoft YaHei, sans-serif';
  context.fillText(
    `${state.project.settings.orgChartMode === 'formal' ? '正式组织架构图' : '探索画布'} · ${graph.nodes.length} 节点 · ${graph.edges.length} 条关系 · ${format === 'ppt16x9' ? 'PPT 16:9' : format === 'a4Landscape' ? 'A4 横版' : '长图'}`,
    40,
    70,
  );

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  context.save();
  context.translate(offsetX, offsetY);
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

    context.strokeStyle = edge.confidence < 0.72 ? '#d54941' : '#1677ff';
    context.lineWidth = 2;
    if (edge.confidence < 0.75 || edge.relationType === 'dotted-line') context.setLineDash([8, 6]);
    else context.setLineDash([]);
    context.beginPath();
    const startX = source.x + 116;
    const startY = source.y + 120;
    const endX = target.x + 116;
    const endY = target.y;
    const midY = startY + Math.max(28, (endY - startY) / 2);
    context.moveTo(startX, startY);
    context.lineTo(startX, midY);
    context.lineTo(endX, midY);
    context.lineTo(endX, endY);
    context.stroke();
  }
  context.setLineDash([]);

  for (const node of graph.nodes) {
    context.fillStyle = node.status === 'left' ? '#fff1f0' : node.changeCount > 0 ? '#fffaf0' : '#ffffff';
    context.strokeStyle = node.status === 'left' ? '#d54941' : node.isFocus ? '#0b5cff' : node.changeCount > 0 ? '#efd99a' : '#c7d6e8';
    context.lineWidth = 1.5;
    context.beginPath();
    context.roundRect(node.x, node.y, 232, 124, 8);
    context.fill();
    context.stroke();

    context.fillStyle = '#1f2329';
    context.font = '700 17px Microsoft YaHei, sans-serif';
    context.fillText(anonymize ? maskName(node.label) : node.label, node.x + 14, node.y + 28);
    context.fillStyle = '#1677ff';
    context.font = '11px Microsoft YaHei, sans-serif';
    context.fillText(node.levelLabel, node.x + 152, node.y + 28);
    context.font = '13px Microsoft YaHei, sans-serif';
    context.fillStyle = '#4e5969';
    context.fillText((node.title ?? '职位待确认').slice(0, 18), node.x + 14, node.y + 52);
    context.fillStyle = '#646a73';
    const orgText = shouldMaskCompanies(state) ? '组织已脱敏' : node.department ?? node.company ?? '组织待确认';
    context.fillText(orgText.slice(0, 18), node.x + 14, node.y + 72);
    context.fillStyle = node.isTalent ? '#00a870' : '#8a9a95';
    context.font = '12px Microsoft YaHei, sans-serif';
    context.fillText(`${node.isTalent ? '重点人才 · ' : ''}${freshnessText(node.updatedAt)}`, node.x + 14, node.y + 94);
    context.fillStyle = '#4e5969';
    context.fillText(`${Math.round(node.averageConfidence * 100) || '--'}% 证据 · ${node.visibleSpan}/${node.span} 下属${node.hiddenDirectCount ? ` · +${node.hiddenDirectCount}` : ''}`, node.x + 14, node.y + 114);
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

  const cover = pptx.addSlide();
  cover.background = { color: 'F8FAF9' };
  cover.addText(state.project.name, {
    x: 0.6,
    y: 0.6,
    w: 11.8,
    h: 0.6,
    fontFace: 'Microsoft YaHei',
    fontSize: 26,
    bold: true,
    color: '10201C',
  });
  cover.addText(
    [
      `公司：${shouldMaskCompanies(state) ? '已脱敏' : state.project.companies.length}`,
      `人员：${state.people.length}`,
      `汇报线：${state.reportingLines.length}`,
      `准备度：${narrative.metrics.readinessScore}分`,
      `待确认：${state.candidates.filter((candidate) => candidate.status === 'pending').length}`,
    ].join('  |  '),
    {
      x: 0.6,
      y: 1.28,
      w: 11.8,
      h: 0.34,
      fontSize: 12,
      color: '48635A',
    },
  );
  cover.addImage({ data: graphPng, x: 0.55, y: 1.85, w: 12.25, h: 5.2 });

  const summarySlide = pptx.addSlide();
  summarySlide.background = { color: 'FFFFFF' };
  summarySlide.addText('管理结论与下一步', {
    x: 0.6,
    y: 0.45,
    w: 8,
    h: 0.4,
    fontSize: 20,
    bold: true,
    color: '10201C',
  });
  summarySlide.addText(maskKnownPeopleText(state, narrative.headline), {
    x: 0.6,
    y: 0.95,
    w: 12,
    h: 0.45,
    fontSize: 14,
    bold: true,
    color: '24423A',
  });
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
      y: 1.58,
      w: 5.9,
      h: 2.0,
      border: { type: 'solid', color: 'D6E0DC', pt: 0.7 },
      fontFace: 'Microsoft YaHei',
      fontSize: 9,
      color: '10201C',
      margin: 0.06,
    },
  );
  summarySlide.addText('关键结论', { x: 6.8, y: 1.58, w: 2.4, h: 0.28, fontSize: 13, bold: true, color: '10201C' });
  summarySlide.addText(narrative.summaryBullets.map((item) => `• ${maskKnownPeopleText(state, item)}`).join('\n'), {
    x: 6.8,
    y: 1.95,
    w: 5.4,
    h: 1.45,
    fontSize: 10,
    color: '354B45',
    breakLine: false,
    fit: 'shrink',
  });
  summarySlide.addText('建议动作', { x: 0.6, y: 4.08, w: 2.4, h: 0.28, fontSize: 13, bold: true, color: '10201C' });
  summarySlide.addText(narrative.nextActions.map((item) => `• ${maskKnownPeopleText(state, item)}`).join('\n'), {
    x: 0.6,
    y: 4.45,
    w: 5.9,
    h: 1.35,
    fontSize: 10,
    color: '354B45',
    fit: 'shrink',
  });
  summarySlide.addText('业务解释', { x: 6.8, y: 4.08, w: 2.4, h: 0.28, fontSize: 13, bold: true, color: '10201C' });
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
      y: 4.45,
      w: 5.5,
      h: 1.65,
      border: { type: 'solid', color: 'D6E0DC', pt: 0.7 },
      fontFace: 'Microsoft YaHei',
      fontSize: 8,
      color: '10201C',
      margin: 0.05,
    },
  );

  const evidenceSlide = pptx.addSlide();
  evidenceSlide.background = { color: 'FFFFFF' };
  evidenceSlide.addText('证据健康度与组织风险', {
    x: 0.6,
    y: 0.45,
    w: 8,
    h: 0.4,
    fontSize: 20,
    bold: true,
    color: '10201C',
  });
  const evidenceRows = [
    ['强证据', `${narrative.metrics.strongEvidenceCount}`, '置信度不低于85%的证据片段'],
    ['弱信号', `${narrative.metrics.weakSignalCount}`, '弱证据与弱候选合计'],
    ['超期人员', `${narrative.metrics.stalePeopleCount}`, '超过时效阈值未更新'],
    ['组织孤点', `${narrative.metrics.orphanPeopleCount}`, '尚未接入当前汇报线'],
    ['最大管理跨度', `${narrative.metrics.maxSpan}`, '单一管理者可见直属下级'],
  ];
  evidenceSlide.addTable([['维度', '数量', '解释'], ...evidenceRows] as any, {
    x: 0.6,
    y: 1.05,
    w: 6,
    h: 2.8,
    border: { type: 'solid', color: 'D6E0DC', pt: 0.7 },
    fontFace: 'Microsoft YaHei',
    fontSize: 9,
    color: '10201C',
    margin: 0.06,
  });
  evidenceSlide.addText('重点管理跨度', { x: 7.0, y: 1.05, w: 3, h: 0.3, fontSize: 13, bold: true, color: '10201C' });
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
      y: 1.45,
      w: 5.2,
      h: 2.4,
      border: { type: 'solid', color: 'D6E0DC', pt: 0.7 },
      fontFace: 'Microsoft YaHei',
      fontSize: 9,
      color: '10201C',
      margin: 0.06,
    },
  );
  evidenceSlide.addText('专业口径', { x: 0.6, y: 4.25, w: 2.6, h: 0.3, fontSize: 13, bold: true, color: '10201C' });
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
      y: 4.65,
      w: 11.6,
      h: 1.2,
      fontSize: 10,
      color: '354B45',
      fit: 'shrink',
    },
  );

  const peopleSlide = pptx.addSlide();
  peopleSlide.background = { color: 'FFFFFF' };
  peopleSlide.addText('关键人员清单', {
    x: 0.6,
    y: 0.45,
    w: 8,
    h: 0.4,
    fontSize: 20,
    bold: true,
    color: '10201C',
  });
  const peopleRows = state.people.slice(0, 14).map((person) => [
    displayPerson(person, anonymize),
    displayCompany(state, person.company),
    person.currentDepartment ?? '待确认',
    person.currentTitle ?? '待确认',
    person.status === 'left' ? '已离开' : '在职/待确认',
  ]);
  peopleSlide.addTable([['姓名', '公司', '部门', '岗位', '状态'], ...peopleRows] as any, {
    x: 0.6,
    y: 1.05,
    w: 12,
    h: 5.8,
    border: { type: 'solid', color: 'D6E0DC', pt: 0.7 },
    fontFace: 'Microsoft YaHei',
    fontSize: 9,
    color: '10201C',
    fill: { color: 'FFFFFF' },
    margin: 0.06,
  });

  const changesSlide = pptx.addSlide();
  changesSlide.background = { color: 'FFFFFF' };
  changesSlide.addText('近期变更与风险', {
    x: 0.6,
    y: 0.45,
    w: 8,
    h: 0.4,
    fontSize: 20,
    bold: true,
    color: '10201C',
  });
  const changeRows = state.changeEvents.slice(0, 18).map((event) => [
    event.date ?? event.createdAt.slice(0, 10),
    anonymize && event.personName ? maskName(event.personName) : event.personName ?? '-',
    event.type,
    state.project.settings.exportPrivacy?.notes ? '说明已脱敏' : event.description,
    state.project.settings.exportPrivacy?.sources ? '来源已脱敏' : event.sourceName ?? '-',
  ]);
  changesSlide.addTable([['日期', '人员', '类型', '说明', '来源'], ...changeRows] as any, {
    x: 0.6,
    y: 1.05,
    w: 12,
    h: 5.8,
    border: { type: 'solid', color: 'D6E0DC', pt: 0.7 },
    fontFace: 'Microsoft YaHei',
    fontSize: 9,
    color: '10201C',
    margin: 0.06,
  });

  await pptx.writeFile({ fileName });
}
