import type { AppState, CanvasLayout, OrgChartMode, OrgMapFilters, Person, ReportingLine } from '../types';
import { normalizeName } from './ids';

export const ORG_MAP_LAYOUT_ID = 'org-map';
export type CanvasViewKey = 'executive' | 'recruiting' | 'detail' | 'mindmap';

const EXPLORE_CARD_WIDTH = 210;
const EXPLORE_CARD_HEIGHT = 98;
const FORMAL_CARD_WIDTH = 250;
const FORMAL_CARD_HEIGHT = 116;
const FORMAL_X_GAP = 84;
const FORMAL_Y_GAP = 168;
const RECRUITING_CARD_WIDTH = 198;
const RECRUITING_CARD_HEIGHT = 96;
const RECRUITING_GROUP_GAP_X = 30;
const RECRUITING_ROOT_GAP_Y = 86;
const RECRUITING_LEVEL_GAP_Y = 24;

export interface OrgGraphNode {
  id: string;
  label: string;
  title?: string;
  company?: string;
  department?: string;
  status?: Person['status'];
  updatedAt: string;
  evidenceCount: number;
  isTalent: boolean;
  isFocus: boolean;
  depth: number;
  levelLabel: string;
  span: number;
  descendantCount: number;
  visibleSpan: number;
  hiddenDirectCount: number;
  averageConfidence: number;
  changeCount: number;
  laneId?: string;
  mindMapSide?: 'root' | 'left' | 'right';
  x: number;
  y: number;
}

export interface OrgGraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  confidence: number;
  relationType: ReportingLine['relationType'];
}

export interface OrgGraphLane {
  id: string;
  label: string;
  company?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  headcount: number;
  managerCount: number;
  talentCount: number;
}

export interface OrgGraphDiagnostics {
  mode: OrgChartMode;
  visibleManagers: number;
  hiddenDirectReports: number;
  maxVisibleDepth: number;
  recentChangePeopleCount: number;
  weakRelationCount: number;
  wideSpanManagerCount: number;
}

export interface OrgGraph {
  nodes: OrgGraphNode[];
  edges: OrgGraphEdge[];
  lanes: OrgGraphLane[];
  focusChain: string[];
  diagnostics: OrgGraphDiagnostics;
  truncated: boolean;
  totalBeforeLimit: number;
}

function personMatches(person: Person, filters: OrgMapFilters): boolean {
  const search = normalizeName(filters.search);
  if (filters.company && person.company !== filters.company) return false;
  if (!search) return true;

  return [person.name, person.company, person.currentTitle, person.currentDepartment, ...person.aliases]
    .filter(Boolean)
    .some((value) => normalizeName(value ?? '').includes(search));
}

function exactOrFuzzyName(name: string, people: Person[]): string {
  const normalized = normalizeName(name);
  if (!normalized) return '';
  const exact = people.find((person) => normalizeName(person.name) === normalized);
  if (exact) return normalizeName(exact.name);
  const fuzzy = people.find((person) => {
    const personName = normalizeName(person.name);
    return personName.includes(normalized) || normalized.includes(personName);
  });
  return fuzzy ? normalizeName(fuzzy.name) : normalized;
}

function currentMode(state: AppState): OrgChartMode {
  return state.project.settings.orgChartMode ?? 'formal';
}

function levelLabelForPerson(person: Person, depth: number): string {
  if (depth === 0) return 'L0 Exec';
  if (depth === 1) return 'L1 BU Lead';
  if (depth === 2) return 'L2 Dept Lead';
  if (depth === 3) return 'L3 Team Lead';
  const text = `${person.currentTitle ?? ''} ${person.tags.join(' ')}`;
  if (/GM|President|VP|Executive|Core/i.test(text)) return 'L0 Exec';
  if (/BU|Business Unit|Group Lead/i.test(text)) return 'L1 BU Lead';
  if (/Director|Department|Head/i.test(text)) return 'L2 Dept Lead';
  if (/Manager|Lead|Supervisor/i.test(text)) return 'L3 Team Lead';
  return 'IC\/Specialist';
}

function topAncestorForName(
  name: string,
  managerBySubordinate: Map<string, string>,
  depthByName: Map<string, number>,
): string {
  let current = name;
  let guard = 0;
  while ((depthByName.get(current) ?? 0) > 1 && guard < 40) {
    const manager = managerBySubordinate.get(current);
    if (!manager) break;
    current = manager;
    guard += 1;
  }
  return current;
}

function sortNamesByPerson(names: string[], peopleByName: Map<string, Person>, depthByName: Map<string, number>): string[] {
  return names.slice().sort((a, b) => {
    const personA = peopleByName.get(a);
    const personB = peopleByName.get(b);
    return (
      (depthByName.get(a) ?? 0) - (depthByName.get(b) ?? 0) ||
      (personA?.currentDepartment ?? '').localeCompare(personB?.currentDepartment ?? '', 'zh-Hans-CN') ||
      (personA?.currentTitle ?? '').localeCompare(personB?.currentTitle ?? '', 'zh-Hans-CN') ||
      (personA?.name ?? a).localeCompare(personB?.name ?? b, 'zh-Hans-CN')
    );
  });
}

function averageConfidenceFor(name: string, confidenceByName: Map<string, number[]>): number {
  const values = confidenceByName.get(name) ?? [];
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildReportVisibleNames(
  people: Person[],
  peopleByName: Map<string, Person>,
  childrenByManager: Map<string, string[]>,
  depthByName: Map<string, number>,
  directSpanAll: Map<string, number>,
  confidenceByName: Map<string, number[]>,
  limit: number,
): Set<string> {
  const orderedNames = sortNamesByPerson(
    people.map((person) => normalizeName(person.name)),
    peopleByName,
    depthByName,
  );
  const visibleNames = new Set<string>();
  const levelTwoManagers: string[] = [];

  for (const name of orderedNames) {
    const depth = depthByName.get(name) ?? 0;
    if (depth <= 2 && visibleNames.size < limit) visibleNames.add(name);
    if (depth === 2) levelTwoManagers.push(name);
  }

  if (visibleNames.size >= limit) return visibleNames;

  const expandableManagers = levelTwoManagers.slice().sort((a, b) => {
    const spanDelta = (directSpanAll.get(a) ?? 0) - (directSpanAll.get(b) ?? 0);
    if (spanDelta !== 0) return spanDelta;
    return (peopleByName.get(a)?.currentDepartment ?? '').localeCompare(
      peopleByName.get(b)?.currentDepartment ?? '',
      'zh-Hans-CN',
    );
  });

  for (const manager of expandableManagers) {
    const directCount = directSpanAll.get(manager) ?? 0;
    if (directCount === 0 || directCount > 5) continue;
    const averageConfidence = averageConfidenceFor(manager, confidenceByName);
    if (averageConfidence > 0 && averageConfidence < 0.75) continue;

    const candidates = sortNamesByPerson(
      (childrenByManager.get(manager) ?? []).filter((child) => (depthByName.get(child) ?? 0) === 3),
      peopleByName,
      depthByName,
    );
    if (candidates.length === 0 || visibleNames.size + candidates.length > limit) continue;
    for (const child of candidates) visibleNames.add(child);
  }

  return visibleNames;
}

function collectDescendants(name: string, childrenByManager: Map<string, string[]>): Set<string> {
  const descendants = new Set<string>();
  const queue = [name];
  descendants.add(name);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of childrenByManager.get(current) ?? []) {
      if (descendants.has(child)) continue;
      descendants.add(child);
      queue.push(child);
    }
  }
  return descendants;
}

function collectAncestors(name: string, managerBySubordinate: Map<string, string>): string[] {
  const ancestors: string[] = [];
  let current = name;
  let guard = 0;
  while (guard < 40) {
    const manager = managerBySubordinate.get(current);
    if (!manager || ancestors.includes(manager)) break;
    ancestors.unshift(manager);
    current = manager;
    guard += 1;
  }
  return ancestors;
}

export function nodeIdForName(name: string): string {
  return `person:${normalizeName(name)}`;
}

export function layoutIdForCanvasView(view: CanvasViewKey): string {
  return `${ORG_MAP_LAYOUT_ID}:${view}`;
}

export function getOrgMapLayout(state: AppState): CanvasLayout | undefined {
  const view = state.project.settings.activeCanvasView ?? 'recruiting';
  return state.canvasLayouts?.[layoutIdForCanvasView(view)];
}

export function buildOrgGraph(state: AppState, filters: OrgMapFilters, layout = getOrgMapLayout(state)): OrgGraph {
  const mode = currentMode(state);
  const activeCanvasView = state.project.settings.activeCanvasView;
  const isMindMap = activeCanvasView === 'mindmap' || activeCanvasView === 'detail';
  const isReportView = activeCanvasView === 'executive' || activeCanvasView === 'mindmap';
  const candidatePeople = state.people.filter((person) => !filters.company || person.company === filters.company);
  const peopleByName = new Map(candidatePeople.map((person) => [normalizeName(person.name), person]));
  const allCandidateNames = new Set(peopleByName.keys());
  const focusName = exactOrFuzzyName(filters.focusPersonName, candidatePeople);

  const eligibleLines = state.reportingLines.filter(
    (line) =>
      line.isCurrent &&
      line.confidence >= filters.minConfidence &&
      allCandidateNames.has(normalizeName(line.managerName)) &&
      allCandidateNames.has(normalizeName(line.subordinateName)),
  );

  const managerBySubordinate = new Map<string, string>();
  const childrenByManager = new Map<string, string[]>();
  const directSpanAll = new Map<string, number>();
  const confidenceByName = new Map<string, number[]>();
  for (const line of eligibleLines) {
    const manager = normalizeName(line.managerName);
    const subordinate = normalizeName(line.subordinateName);
    managerBySubordinate.set(subordinate, manager);
    childrenByManager.set(manager, [...(childrenByManager.get(manager) ?? []), subordinate]);
    directSpanAll.set(manager, (directSpanAll.get(manager) ?? 0) + 1);
    confidenceByName.set(manager, [...(confidenceByName.get(manager) ?? []), line.confidence]);
    confidenceByName.set(subordinate, [...(confidenceByName.get(subordinate) ?? []), line.confidence]);
  }

  const roots = [...peopleByName.keys()].filter((name) => !managerBySubordinate.has(name));
  const depthByName = new Map<string, number>();
  const queue = [...roots];
  roots.forEach((name) => depthByName.set(name, 0));

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = depthByName.get(current) ?? 0;
    for (const child of childrenByManager.get(current) ?? []) {
      if (depthByName.has(child)) continue;
      depthByName.set(child, currentDepth + 1);
      queue.push(child);
    }
  }

  for (const name of peopleByName.keys()) {
    if (!depthByName.has(name)) depthByName.set(name, 0);
  }

  const focusAncestors = focusName ? collectAncestors(focusName, managerBySubordinate) : [];
  const focusDescendants = focusName ? collectDescendants(focusName, childrenByManager) : new Set<string>();
  const focusManager = focusName ? managerBySubordinate.get(focusName) : undefined;
  const focusSiblings = new Set(focusManager ? childrenByManager.get(focusManager) ?? [] : []);
  const focusSet = new Set<string>([...focusAncestors, ...focusDescendants, ...focusSiblings]);
  if (focusName) focusSet.add(focusName);

  const useReportDefault = isReportView && !focusName && !filters.search.trim();
  const reportVisibleNames = useReportDefault
    ? buildReportVisibleNames(
        candidatePeople,
        peopleByName,
        childrenByManager,
        depthByName,
        directSpanAll,
        confidenceByName,
        Math.min(filters.visibleLimit, 28),
      )
    : undefined;

  const basePeople = useReportDefault
    ? candidatePeople.filter((person) => reportVisibleNames?.has(normalizeName(person.name)))
    : candidatePeople.filter((person) => {
        const name = normalizeName(person.name);
        if (focusName && !focusSet.has(name)) return false;
        if (!focusName && !personMatches(person, filters)) return false;
        return true;
      });
  const focusDepth = focusName ? depthByName.get(focusName) ?? 0 : 0;
  const depthLimitedPeople = useReportDefault
    ? basePeople
    : basePeople.filter((person) => {
        const name = normalizeName(person.name);
        const depth = depthByName.get(name) ?? 0;
        if (focusName) {
          if (focusAncestors.includes(name) || focusSiblings.has(name)) return true;
          return depth - focusDepth <= filters.maxDepth;
        }
        if (filters.search.trim()) return true;
        return depth <= filters.maxDepth;
      });

  const orderedPeople = depthLimitedPeople
    .slice()
    .sort((a, b) => {
      const nameA = normalizeName(a.name);
      const nameB = normalizeName(b.name);
      const topA = topAncestorForName(nameA, managerBySubordinate, depthByName);
      const topB = topAncestorForName(nameB, managerBySubordinate, depthByName);
      return (
        (depthByName.get(nameA) ?? 0) - (depthByName.get(nameB) ?? 0) ||
        topA.localeCompare(topB, 'zh-Hans-CN') ||
        (a.currentDepartment ?? '').localeCompare(b.currentDepartment ?? '', 'zh-Hans-CN') ||
        (a.currentTitle ?? '').localeCompare(b.currentTitle ?? '', 'zh-Hans-CN') ||
        a.name.localeCompare(b.name, 'zh-Hans-CN')
      );
    });
  const limitedPeople = orderedPeople.slice(0, filters.visibleLimit);
  const visibleNameSet = new Set(limitedPeople.map((person) => normalizeName(person.name)));
  const visibleLines = eligibleLines.filter(
    (line) =>
      visibleNameSet.has(normalizeName(line.managerName)) &&
      visibleNameSet.has(normalizeName(line.subordinateName)),
  );
  const visibleChildrenByManager = new Map<string, string[]>();
  for (const line of visibleLines) {
    const manager = normalizeName(line.managerName);
    const subordinate = normalizeName(line.subordinateName);
    visibleChildrenByManager.set(manager, [...(visibleChildrenByManager.get(manager) ?? []), subordinate]);
  }

  const changeCountByName = new Map<string, number>();
  for (const event of state.changeEvents) {
    if (!event.personName) continue;
    const date = new Date(event.date ?? event.createdAt).getTime();
    if (!Number.isFinite(date) || Date.now() - date > 90 * 86_400_000) continue;
    const name = normalizeName(event.personName);
    changeCountByName.set(name, (changeCountByName.get(name) ?? 0) + 1);
  }

  const positions: Map<string, { x: number; y: number; side?: 'root' | 'left' | 'right' }> = mode === 'formal'
    ? isMindMap
      ? buildMindMapPositions(
          limitedPeople,
          peopleByName,
          visibleChildrenByManager,
          managerBySubordinate,
          depthByName,
          layout,
          activeCanvasView === 'detail' ? 'recruiting' : 'report',
        )
      : isReportView
        ? buildExecutivePositions(limitedPeople, peopleByName, visibleChildrenByManager, managerBySubordinate, depthByName, layout)
        : activeCanvasView === 'recruiting'
          ? buildRecruitingPositions(limitedPeople, peopleByName, visibleChildrenByManager, managerBySubordinate, depthByName, layout)
          : buildFormalPositions(limitedPeople, peopleByName, visibleChildrenByManager, managerBySubordinate, depthByName, layout)
    : buildExplorePositions(limitedPeople, layout, depthByName);

  const laneByName = new Map<string, string>();
  const nodes: OrgGraphNode[] = limitedPeople.map((person) => {
    const name = normalizeName(person.name);
    const depth = depthByName.get(name) ?? 0;
    const topAncestor = topAncestorForName(name, managerBySubordinate, depthByName);
    const laneId = isMindMap || depth <= 1 ? undefined : `lane:${topAncestor}`;
    if (laneId) laneByName.set(name, laneId);
    const span = directSpanAll.get(name) ?? 0;
    const descendantCount = Math.max(0, collectDescendants(name, childrenByManager).size - 1);
    const visibleSpan = visibleChildrenByManager.get(name)?.length ?? 0;
    const confidenceValues = confidenceByName.get(name) ?? [];
    return {
      id: nodeIdForName(person.name),
      label: person.name,
      title: person.currentTitle,
      company: person.company,
      department: person.currentDepartment,
      status: person.status,
      updatedAt: person.updatedAt,
      evidenceCount: person.evidenceIds.length,
      isTalent: person.tags.includes('关键人才') || person.tags.includes('重点人才'),
      isFocus: Boolean(focusName && name === focusName),
      depth,
      levelLabel: levelLabelForPerson(person, depth),
      span,
      descendantCount,
      visibleSpan,
      hiddenDirectCount: Math.max(0, span - visibleSpan),
      averageConfidence:
        confidenceValues.length === 0
          ? 0
          : confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length,
      changeCount: changeCountByName.get(name) ?? 0,
      laneId,
      mindMapSide: positions.get(name)?.side,
      x: positions.get(name)?.x ?? 80,
      y: positions.get(name)?.y ?? 70,
    };
  });

  const edges: OrgGraphEdge[] = visibleLines.map((line) => ({
    id: line.id,
    source: nodeIdForName(line.managerName),
    target: nodeIdForName(line.subordinateName),
    label: line.relationType === 'dotted-line' ? 'Dotted' : line.relationType === 'manages' ? 'Manages' : 'Reports to',
    confidence: line.confidence,
    relationType: line.relationType,
  }));

  const lanes = mode === 'formal' && !isMindMap ? buildFormalLanes(nodes) : [];
  const visibleManagers = nodes.filter((node) => node.visibleSpan > 0).length;
  const focusChain = focusName
    ? [...focusAncestors, focusName]
        .map((name) => peopleByName.get(name)?.name)
        .filter((value): value is string => Boolean(value))
    : [];

  return {
    nodes,
    edges,
    lanes,
    focusChain,
    diagnostics: {
      mode,
      visibleManagers,
      hiddenDirectReports: nodes.reduce((sum, node) => sum + node.hiddenDirectCount, 0),
      maxVisibleDepth: Math.max(0, ...nodes.map((node) => node.depth)),
      recentChangePeopleCount: nodes.filter((node) => node.changeCount > 0).length,
      weakRelationCount: edges.filter((edge) => edge.confidence < 0.75).length,
      wideSpanManagerCount: nodes.filter((node) => node.span >= 12).length,
    },
    truncated: depthLimitedPeople.length > filters.visibleLimit,
    totalBeforeLimit: depthLimitedPeople.length,
  };
}

function buildExplorePositions(
  people: Person[],
  layout: CanvasLayout | undefined,
  depthByName: Map<string, number>,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const lanes = new Map<number, Person[]>();
  for (const person of people) {
    const depth = depthByName.get(normalizeName(person.name)) ?? 0;
    lanes.set(depth, [...(lanes.get(depth) ?? []), person]);
  }

  for (const [depth, lanePeople] of [...lanes.entries()].sort(([a], [b]) => a - b)) {
    const columns = depth === 0 ? 1 : depth === 1 ? 5 : 10;
    lanePeople.forEach((person, index) => {
      const name = normalizeName(person.name);
      const nodeId = nodeIdForName(person.name);
      const column = index % columns;
      const row = Math.floor(index / columns);
      positions.set(name, {
        x: layout?.nodes[nodeId]?.x ?? 80 + column * (EXPLORE_CARD_WIDTH + 50),
        y: layout?.nodes[nodeId]?.y ?? 70 + depth * 220 + row * (EXPLORE_CARD_HEIGHT + 20),
      });
    });
  }

  return positions;
}

interface RecruitingSubtreeLayout {
  width: number;
  height: number;
  children: Array<{
    name: string;
    offsetX: number;
    offsetY: number;
    subtree: RecruitingSubtreeLayout;
  }>;
}

function buildRecruitingPositions(
  people: Person[],
  peopleByName: Map<string, Person>,
  childrenByManager: Map<string, string[]>,
  managerBySubordinate: Map<string, string>,
  depthByName: Map<string, number>,
  layout: CanvasLayout | undefined,
): Map<string, { x: number; y: number }> {
  const visibleNames = new Set(people.map((person) => normalizeName(person.name)));
  const roots = people
    .map((person) => normalizeName(person.name))
    .filter((name) => !managerBySubordinate.has(name) || !visibleNames.has(managerBySubordinate.get(name)!));
  const orderedRoots = sortNamesByPerson(roots, peopleByName, depthByName);
  const visibleChildrenOf = (name: string): string[] =>
    sortNamesByPerson(
      (childrenByManager.get(name) ?? []).filter((child) => visibleNames.has(child)),
      peopleByName,
      depthByName,
    );

  const measureSubtree = (name: string, depth: number, ancestry: Set<string>): RecruitingSubtreeLayout => {
    if (ancestry.has(name)) {
      return { width: RECRUITING_CARD_WIDTH, height: RECRUITING_CARD_HEIGHT, children: [] };
    }

    const nextAncestry = new Set(ancestry);
    nextAncestry.add(name);
    const children = visibleChildrenOf(name).filter((child) => !nextAncestry.has(child));
    if (children.length === 0) {
      return { width: RECRUITING_CARD_WIDTH, height: RECRUITING_CARD_HEIGHT, children: [] };
    }

    const columns =
      depth === 0
        ? children.length
        : depth === 1
          ? children.length >= 8
            ? 2
            : 1
          : depth === 2
            ? children.length >= 6
              ? 2
              : 1
            : 1;
    const rows = chunkNames(children, Math.max(1, columns));
    const rowGapY = depth === 0 ? RECRUITING_ROOT_GAP_Y : RECRUITING_LEVEL_GAP_Y;
    const rowData = rows.map((row) => {
      const measured = row.map((child) => ({
        name: child,
        subtree: measureSubtree(child, depth + 1, nextAncestry),
      }));
      return {
        measured,
        width:
          measured.reduce((sum, child) => sum + child.subtree.width, 0) +
          Math.max(0, measured.length - 1) * RECRUITING_GROUP_GAP_X,
        height: Math.max(RECRUITING_CARD_HEIGHT, ...measured.map((child) => child.subtree.height)),
      };
    });

    const width = Math.max(RECRUITING_CARD_WIDTH, ...rowData.map((row) => row.width));
    let cursorY = RECRUITING_CARD_HEIGHT + rowGapY;
    const placedChildren: RecruitingSubtreeLayout['children'] = [];

    for (const row of rowData) {
      let cursorX = (width - row.width) / 2;
      for (const child of row.measured) {
        placedChildren.push({
          name: child.name,
          offsetX: cursorX,
          offsetY: cursorY,
          subtree: child.subtree,
        });
        cursorX += child.subtree.width + RECRUITING_GROUP_GAP_X;
      }
      cursorY += row.height + RECRUITING_LEVEL_GAP_Y;
    }

    return {
      width,
      height: Math.max(RECRUITING_CARD_HEIGHT, cursorY - RECRUITING_LEVEL_GAP_Y),
      children: placedChildren,
    };
  };

  const positions = new Map<string, { x: number; y: number }>();
  const placeSubtree = (name: string, subtree: RecruitingSubtreeLayout, originX: number, originY: number): void => {
    positions.set(name, {
      x: originX + subtree.width / 2 - RECRUITING_CARD_WIDTH / 2,
      y: originY,
    });
    for (const child of subtree.children) {
      placeSubtree(child.name, child.subtree, originX + child.offsetX, originY + child.offsetY);
    }
  };

  let cursorX = 72;
  for (const root of orderedRoots) {
    const subtree = measureSubtree(root, 0, new Set());
    placeSubtree(root, subtree, cursorX, 56);
    cursorX += subtree.width + 108;
  }

  return applySavedPositions(positions, people, layout);
}

function applySavedPositions<T extends { x: number; y: number }>(
  positions: Map<string, T>,
  people: Person[],
  layout: CanvasLayout | undefined,
): Map<string, T> {
  if (!layout) return positions;
  for (const person of people) {
    const name = normalizeName(person.name);
    const saved = layout.nodes[nodeIdForName(person.name)];
    const current = positions.get(name);
    if (!saved || !current) continue;
    positions.set(name, {
      ...current,
      x: saved.x,
      y: saved.y,
    });
  }
  return positions;
}

function buildFormalPositions(
  people: Person[],
  peopleByName: Map<string, Person>,
  childrenByManager: Map<string, string[]>,
  managerBySubordinate: Map<string, string>,
  depthByName: Map<string, number>,
  layout: CanvasLayout | undefined,
): Map<string, { x: number; y: number }> {
  const visibleNames = new Set(people.map((person) => normalizeName(person.name)));
  const roots = people
    .map((person) => normalizeName(person.name))
    .filter((name) => !managerBySubordinate.has(name) || !visibleNames.has(managerBySubordinate.get(name)!));
  const orderedRoots = sortNamesByPerson(roots, peopleByName, depthByName);
  const maxDepth = Math.max(0, ...people.map((person) => depthByName.get(normalizeName(person.name)) ?? 0));
  if (maxDepth <= 1 && people.length > 6) {
    return applySavedPositions(
      buildShallowFormalPositions(people, peopleByName, childrenByManager, depthByName, orderedRoots),
      people,
      layout,
    );
  }
  const xByName = new Map<string, number>();
  let cursor = 0;

  const place = (name: string, ancestry: Set<string>): number => {
    if (xByName.has(name)) return xByName.get(name)!;
    if (ancestry.has(name)) {
      const fallback = cursor;
      cursor += 1;
      xByName.set(name, fallback);
      return fallback;
    }
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(name);
    const visibleChildren = sortNamesByPerson(
      (childrenByManager.get(name) ?? []).filter((child) => visibleNames.has(child)),
      peopleByName,
      depthByName,
    );
    if (visibleChildren.length === 0) {
      const leafColumn = cursor;
      cursor += 1;
      xByName.set(name, leafColumn);
      return leafColumn;
    }
    const childColumns = visibleChildren.map((child) => place(child, nextAncestry));
    const midpoint = (Math.min(...childColumns) + Math.max(...childColumns)) / 2;
    xByName.set(name, midpoint);
    return midpoint;
  };

  for (const root of orderedRoots) {
    place(root, new Set());
    cursor += 0.6;
  }

  const minColumn = Math.min(0, ...xByName.values());
  const positions = new Map<string, { x: number; y: number }>();
  for (const person of people) {
    const name = normalizeName(person.name);
    const depth = depthByName.get(name) ?? 0;
    const column = (xByName.get(name) ?? 0) - minColumn;
    positions.set(name, {
      x: 64 + column * (FORMAL_CARD_WIDTH + FORMAL_X_GAP),
      y: 64 + depth * FORMAL_Y_GAP,
    });
  }
  return applySavedPositions(positions, people, layout);
}

function buildExecutivePositions(
  people: Person[],
  peopleByName: Map<string, Person>,
  childrenByManager: Map<string, string[]>,
  managerBySubordinate: Map<string, string>,
  depthByName: Map<string, number>,
  layout: CanvasLayout | undefined,
): Map<string, { x: number; y: number }> {
  const visibleNames = new Set(people.map((person) => normalizeName(person.name)));
  const roots = people
    .map((person) => normalizeName(person.name))
    .filter((name) => !managerBySubordinate.has(name) || !visibleNames.has(managerBySubordinate.get(name)!));
  const orderedRoots = sortNamesByPerson(roots, peopleByName, depthByName);
  const root = orderedRoots[0];
  if (!root) return new Map();

  const positions = new Map<string, { x: number; y: number }>();
  const groupGapX = 42;
  const childGapX = 32;
  const levelRootY = 72;
  const levelOneY = 236;
  const levelTwoY = 404;
  const levelThreeGapY = FORMAL_CARD_HEIGHT + 34;

  const visibleChildrenOf = (name: string): string[] =>
    sortNamesByPerson(
      (childrenByManager.get(name) ?? []).filter((child) => visibleNames.has(child)),
      peopleByName,
      depthByName,
    );

  const levelOneNames = visibleChildrenOf(root);
  const levelOneGroups = levelOneNames.map((name) => {
    const levelTwoNames = visibleChildrenOf(name).filter((child) => (depthByName.get(child) ?? 0) === 2);
    const columns = 1;
    const width = FORMAL_CARD_WIDTH;
    return { name, levelTwoNames, columns, width };
  });

  const totalWidth =
    levelOneGroups.reduce((sum, group) => sum + group.width, 0) + Math.max(0, levelOneGroups.length - 1) * groupGapX;
  const startX = 92;
  const rootX = levelOneGroups.length > 0 ? startX + totalWidth / 2 - FORMAL_CARD_WIDTH / 2 : startX;
  positions.set(root, { x: rootX, y: levelRootY });

  let cursorX = startX;
  for (const group of levelOneGroups) {
    const groupStartX = cursorX;
    const groupCenterX = groupStartX + group.width / 2 - FORMAL_CARD_WIDTH / 2;
    positions.set(group.name, { x: groupCenterX, y: levelOneY });

    const rows = chunkNames(group.levelTwoNames, group.columns);
    rows.forEach((rowNames, rowIndex) => {
      const rowWidth = rowNames.length * FORMAL_CARD_WIDTH + Math.max(0, rowNames.length - 1) * childGapX;
      const rowStartX = groupStartX + Math.max(0, (group.width - rowWidth) / 2);

      rowNames.forEach((name, columnIndex) => {
        const childX = rowStartX + columnIndex * (FORMAL_CARD_WIDTH + childGapX);
        const childY = levelTwoY + rowIndex * (FORMAL_CARD_HEIGHT + 44);
        positions.set(name, { x: childX, y: childY });

        const levelThreeNames = visibleChildrenOf(name).filter((child) => (depthByName.get(child) ?? 0) === 3);
        levelThreeNames.forEach((levelThreeName, levelThreeIndex) => {
          positions.set(levelThreeName, {
            x: childX,
            y: childY + levelThreeGapY + levelThreeIndex * levelThreeGapY,
          });
        });
      });
    });

    cursorX += group.width + groupGapX;
  }

  const trailingRoots = orderedRoots.filter((name) => name !== root);
  let trailingX = startX + totalWidth + 120;
  for (const name of trailingRoots) {
    positions.set(name, { x: trailingX, y: levelOneY });
    trailingX += FORMAL_CARD_WIDTH + groupGapX;
  }

  let fallbackX = trailingX;
  for (const person of people) {
    const name = normalizeName(person.name);
    if (positions.has(name)) continue;
    const depth = depthByName.get(name) ?? 0;
    positions.set(name, {
      x: fallbackX,
      y: levelOneY + depth * 132,
    });
    fallbackX += FORMAL_CARD_WIDTH + childGapX;
  }

  return applySavedPositions(positions, people, layout);
}

function buildMindMapPositions(
  people: Person[],
  peopleByName: Map<string, Person>,
  childrenByManager: Map<string, string[]>,
  managerBySubordinate: Map<string, string>,
  depthByName: Map<string, number>,
  layout: CanvasLayout | undefined,
  profile: 'report' | 'recruiting' = 'report',
): Map<string, { x: number; y: number; side?: 'root' | 'left' | 'right' }> {
  const visibleNames = new Set(people.map((person) => normalizeName(person.name)));
  const roots = people
    .map((person) => normalizeName(person.name))
    .filter((name) => !managerBySubordinate.has(name) || !visibleNames.has(managerBySubordinate.get(name)!));
  const orderedRoots = sortNamesByPerson(roots, peopleByName, depthByName);
  const root = orderedRoots[0] ?? normalizeName(people[0]?.name ?? '');
  const positions = new Map<string, { x: number; y: number; side?: 'root' | 'left' | 'right' }>();
  if (!root) return positions;

  const rootX = profile === 'recruiting' ? 640 : 560;
  const rootY = 320;
  const primaryGapX = profile === 'recruiting' ? 330 : 290;
  const depthGapX = profile === 'recruiting' ? 248 : 228;
  const rowGap = profile === 'recruiting' ? 132 : 116;
  positions.set(root, { x: rootX, y: rootY, side: 'root' });

  const visibleChildrenOf = (name: string): string[] =>
    sortNamesByPerson(
      (childrenByManager.get(name) ?? []).filter((child) => visibleNames.has(child)),
      peopleByName,
      depthByName,
    );

  const subtreeUnits = (name: string, ancestry: Set<string>): number => {
    if (ancestry.has(name)) return 1;
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(name);
    const children = visibleChildrenOf(name).filter((child) => !nextAncestry.has(child));
    if (children.length === 0) return 1;
    return Math.max(
      1,
      children.reduce((sum, child) => sum + subtreeUnits(child, nextAncestry), 0),
    );
  };

  const placeSubtree = (name: string, side: 'left' | 'right', depth: number, y: number, ancestry: Set<string>) => {
    if (ancestry.has(name)) return;
    const direction = side === 'left' ? -1 : 1;
    positions.set(name, {
      x: rootX + direction * (primaryGapX + Math.max(0, depth - 1) * depthGapX),
      y,
      side,
    });

    const nextAncestry = new Set(ancestry);
    nextAncestry.add(name);
    const children = visibleChildrenOf(name).filter((child) => !nextAncestry.has(child));
    const childUnits = children.map((child) => subtreeUnits(child, nextAncestry));
    const totalUnits = childUnits.reduce((sum, value) => sum + value, 0);
    let cursorY = y - ((totalUnits - 1) * rowGap) / 2;

    children.forEach((child, index) => {
      const units = childUnits[index] ?? 1;
      const childY = cursorY + ((units - 1) * rowGap) / 2;
      placeSubtree(child, side, depth + 1, childY, nextAncestry);
      cursorY += units * rowGap;
    });
  };

  const directChildren = visibleChildrenOf(root);
  const primaryBranches = directChildren.length > 0 ? directChildren : orderedRoots.filter((name) => name !== root);
  const leftBranches: string[] = [];
  const rightBranches: string[] = [];
  let leftUnits = 0;
  let rightUnits = 0;
  const sortedBranches = primaryBranches
    .slice()
    .sort((a, b) => subtreeUnits(b, new Set([root])) - subtreeUnits(a, new Set([root])));

  for (const branch of sortedBranches) {
    const units = subtreeUnits(branch, new Set([root]));
    if (rightUnits <= leftUnits) {
      rightBranches.push(branch);
      rightUnits += units;
    } else {
      leftBranches.push(branch);
      leftUnits += units;
    }
  }

  const placeBranchGroup = (branchRoots: string[], side: 'left' | 'right') => {
    const units = branchRoots.map((name) => subtreeUnits(name, new Set([root])));
    const totalUnits = units.reduce((sum, value) => sum + value, 0);
    let cursorY = rootY - ((totalUnits - 1) * rowGap) / 2;

    branchRoots.forEach((name, index) => {
      const branchUnits = units[index] ?? 1;
      const branchY = cursorY + ((branchUnits - 1) * rowGap) / 2;
      placeSubtree(name, side, 1, branchY, new Set([root]));
      cursorY += branchUnits * rowGap;
    });
  };

  placeBranchGroup(leftBranches, 'left');
  placeBranchGroup(rightBranches, 'right');

  let fallbackRow = 0;
  for (const person of people) {
    const name = normalizeName(person.name);
    if (positions.has(name)) continue;
    const depth = depthByName.get(name) ?? 0;
    const side = fallbackRow % 2 === 0 ? 'left' : 'right';
    const direction = side === 'left' ? -1 : 1;
    positions.set(name, {
      x: rootX + direction * (primaryGapX + Math.max(0, depth) * depthGapX),
      y: rootY + 170 + fallbackRow * 64,
      side,
    });
    fallbackRow += 1;
  }

  return applySavedPositions(positions, people, layout);
}

function buildShallowFormalPositions(
  people: Person[],
  peopleByName: Map<string, Person>,
  childrenByManager: Map<string, string[]>,
  depthByName: Map<string, number>,
  orderedRoots: string[],
): Map<string, { x: number; y: number }> {
  const visibleNames = new Set(people.map((person) => normalizeName(person.name)));
  const positions = new Map<string, { x: number; y: number }>();
  const stepX = FORMAL_CARD_WIDTH + FORMAL_X_GAP;
  const defaultStepY = FORMAL_CARD_HEIGHT + 34;
  let cursorX = 64;

  for (const root of orderedRoots) {
    const children = sortNamesByPerson(
      (childrenByManager.get(root) ?? []).filter((child) => visibleNames.has(child)),
      peopleByName,
      depthByName,
    );
    const columns = children.length > 6 ? 2 : children.length > 0 ? Math.min(4, Math.max(2, Math.ceil(Math.sqrt(children.length * 1.5)))) : 1;
    const stepY = children.length > 6 ? FORMAL_CARD_HEIGHT + 8 : defaultStepY;
    const rows = children.length > 0 ? Math.ceil(children.length / columns) : 1;
    const groupWidth = columns * FORMAL_CARD_WIDTH + (columns - 1) * FORMAL_X_GAP;
    const rootPerson = peopleByName.get(root);

    if (rootPerson && visibleNames.has(root)) {
      positions.set(root, {
        x: cursorX + groupWidth / 2 - FORMAL_CARD_WIDTH / 2,
        y: 64,
      });
    }

    if (children.length === 0 && rootPerson) {
      positions.set(root, { x: cursorX, y: 64 });
    } else {
      children.forEach((child, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        positions.set(child, {
          x: cursorX + column * stepX,
          y: 64 + FORMAL_Y_GAP + row * stepY,
        });
      });
    }

    cursorX += groupWidth + 96;
    if (rows > 2) cursorX += 24;
  }

  for (const person of people) {
    const name = normalizeName(person.name);
    if (!positions.has(name)) {
      const depth = depthByName.get(name) ?? 0;
      positions.set(name, {
        x: cursorX,
        y: 64 + depth * FORMAL_Y_GAP,
      });
      cursorX += stepX;
    }
  }

  return positions;
}

function chunkNames(names: string[], size: number): string[][] {
  if (size <= 0) return [names];
  const rows: string[][] = [];
  for (let index = 0; index < names.length; index += size) {
    rows.push(names.slice(index, index + size));
  }
  return rows;
}

function buildFormalLanes(nodes: OrgGraphNode[]): OrgGraphLane[] {
  const rows = new Map<string, OrgGraphNode[]>();
  for (const node of nodes) {
    if (!node.laneId) continue;
    rows.set(node.laneId, [...(rows.get(node.laneId) ?? []), node]);
  }

  return [...rows.entries()]
    .map(([id, laneNodes]) => {
      const lead = laneNodes.find((node) => node.depth === 1) ?? laneNodes[0];
      const minX = Math.min(...laneNodes.map((node) => node.x));
      const maxX = Math.max(...laneNodes.map((node) => node.x + FORMAL_CARD_WIDTH));
      const minY = Math.min(...laneNodes.map((node) => node.y));
      const maxY = Math.max(...laneNodes.map((node) => node.y + FORMAL_CARD_HEIGHT));
      return {
        id,
        label: lead.department ?? lead.title ?? lead.label,
        company: lead.company,
        x: minX - 26,
        y: minY - 58,
        width: Math.max(280, maxX - minX + 52),
        height: maxY - minY + 86,
        headcount: laneNodes.length,
        managerCount: laneNodes.filter((node) => node.span > 0).length,
        talentCount: laneNodes.filter((node) => node.isTalent).length,
      };
    })
    .sort((a, b) => a.x - b.x);
}
