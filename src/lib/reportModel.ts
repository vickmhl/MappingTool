import type { AppState, Person } from '../types';
import { normalizeName } from './ids';

export interface ReportOrgCard {
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

export interface OrgHierarchyModel {
  root?: ReportOrgCard;
  firstLayer: ReportOrgCard[];
  secondLayerGroups: Array<{ parent: ReportOrgCard; children: ReportOrgCard[] }>;
}

export function clipText(value: string | undefined, maxLength: number): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function changeTypeText(type: string): string {
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

function personLevelRank(person: Person | undefined): number {
  const text = `${person?.currentTitle ?? ''} ${person?.tags.join(' ') ?? ''}`;
  if (/总经理|CEO|事业群|集团|总裁|VP|President|Executive/i.test(text)) return 0;
  if (/副总裁|总监|负责人|BU|Business Unit|Head/i.test(text)) return 1;
  if (/部门|Director|Lead|主管/i.test(text)) return 2;
  if (/经理|专家|Manager|Specialist/i.test(text)) return 3;
  return 4;
}

export function buildOrgHierarchyModel(state: AppState): OrgHierarchyModel {
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
    personLevelRank(peopleByName.get(a)) - personLevelRank(peopleByName.get(b)) ||
    countDescendants(b) - countDescendants(a) ||
    (childrenByManager.get(b)?.length ?? 0) - (childrenByManager.get(a)?.length ?? 0) ||
    (peopleByName.get(a)?.currentDepartment ?? '').localeCompare(
      peopleByName.get(b)?.currentDepartment ?? '',
      'zh-Hans-CN',
    );

  const roots = [...peopleByName.keys()]
    .filter((name) => !managerBySubordinate.has(name) && (childrenByManager.get(name)?.length ?? 0) > 0)
    .sort(sortByScale);
  const rootKey = roots[0] ?? [...childrenByManager.keys()].sort(sortByScale)[0];
  if (!rootKey) return { firstLayer: [], secondLayerGroups: [] };

  const firstLayerKeys = (childrenByManager.get(rootKey) ?? []).sort(sortByScale).slice(0, 10);
  const secondLayerGroups = firstLayerKeys
    .slice(0, 6)
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
