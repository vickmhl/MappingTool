import { describe, expect, it } from 'vitest';
import { createMapBusinessDemoState } from './seed';
import { buildOrgGraph, layoutIdForCanvasView, ORG_MAP_LAYOUT_ID } from '../lib/graph';
import { normalizeName } from '../lib/ids';

const makeFilters = (overrides: Partial<Parameters<typeof buildOrgGraph>[1]> = {}) => ({
  company: '',
  search: '',
  focusPersonName: '',
  minConfidence: 0.72,
  visibleLimit: 28,
  maxDepth: 2,
  onlyTalent: false,
  onlyRecentChanges: false,
  onlyManagers: false,
  ...overrides,
});

describe('seed data', () => {
  it('creates a large virtual map business sample for canvas testing', () => {
    const state = createMapBusinessDemoState();

    expect(state.people.length).toBeGreaterThan(5000);
    expect(state.reportingLines.length).toBeGreaterThan(5000);
    expect(state.orgUnits.length).toBeGreaterThan(150);
    expect(state.sources[0].warnings?.[0]).toContain('虚拟数据');
  });

  it('assigns ali-style p-sequence tags across the virtual sample', () => {
    const state = createMapBusinessDemoState();
    const pTags = new Set(
      state.people.flatMap((person) => person.tags.filter((tag) => /^P\d{1,2}$/i.test(tag))),
    );

    expect(pTags.has('P11')).toBe(true);
    expect(pTags.has('P10')).toBe(true);
    expect(pTags.has('P9')).toBe(true);
    expect(pTags.has('P8')).toBe(true);
    expect(pTags.has('P7')).toBe(true);
    expect(pTags.has('P6')).toBe(true);
  });

  it('stores ali-style p-sequence as virtual notes instead of primary org labels', () => {
    const state = createMapBusinessDemoState();
    const firstVirtual = state.people.find((person) => person.tags.includes('虚拟样例'));

    expect(firstVirtual?.sensitiveNote).toContain('虚拟职级参考：阿里 P');
  });

  it('uses view-specific saved canvas positions when building the org graph', () => {
    const state = createMapBusinessDemoState();
    const targetName = state.people[0]?.name ?? '';
    const targetId = `person:${normalizeName(targetName)}`;
    state.project.settings.orgChartMode = 'explore';
    state.project.settings.activeCanvasView = 'recruiting';
    state.canvasLayouts = {
      [layoutIdForCanvasView('recruiting')]: {
        updatedAt: '2026-05-29T00:00:00.000Z',
        nodes: {
          [targetId]: {
            x: 480,
            y: 120,
            updatedAt: '2026-05-29T00:00:00.000Z',
          },
        },
      },
    };

    const graph = buildOrgGraph(state, makeFilters({ search: targetName, minConfidence: 0.5, visibleLimit: 20 }));
    const node = graph.nodes.find((item) => item.id === targetId);

    expect(node?.x).toBe(480);
    expect(node?.y).toBe(120);
  });

  it('ignores legacy generic org-map layouts for current V3 views', () => {
    const state = createMapBusinessDemoState();
    const targetName = state.people[0]?.name ?? '';
    const targetId = `person:${normalizeName(targetName)}`;
    state.project.settings.orgChartMode = 'formal';
    state.project.settings.activeCanvasView = 'executive';
    state.canvasLayouts = {
      [ORG_MAP_LAYOUT_ID]: {
        updatedAt: '2026-05-29T00:00:00.000Z',
        nodes: {
          [targetId]: {
            x: 2400,
            y: 960,
            updatedAt: '2026-05-29T00:00:00.000Z',
          },
        },
      },
    };

    const graph = buildOrgGraph(state, makeFilters());
    const node = graph.nodes.find((item) => item.id === targetId);

    expect(node?.x).not.toBe(2400);
    expect(node?.y).not.toBe(960);
  });

  it('builds a formal org chart with lanes and compressed direct reports', () => {
    const state = createMapBusinessDemoState();
    state.project.settings.orgChartMode = 'formal';

    const graph = buildOrgGraph(state, makeFilters({ minConfidence: 0.5, visibleLimit: 120 }));

    expect(graph.lanes.length).toBeGreaterThan(3);
    expect(graph.diagnostics.hiddenDirectReports).toBeGreaterThan(0);
    expect(graph.edges[0]?.relationType).toBe('reports-to');
  });

  it('keeps saved positions in report org chart layouts', () => {
    const state = createMapBusinessDemoState();
    const targetName = state.people[0]?.name ?? '';
    const targetId = `person:${normalizeName(targetName)}`;
    state.project.settings.orgChartMode = 'formal';
    state.project.settings.activeCanvasView = 'executive';
    state.canvasLayouts = {
      [layoutIdForCanvasView('executive')]: {
        updatedAt: '2026-05-29T00:00:00.000Z',
        nodes: {
          [targetId]: {
            x: 720,
            y: 188,
            updatedAt: '2026-05-29T00:00:00.000Z',
          },
        },
      },
    };

    const graph = buildOrgGraph(state, makeFilters({ minConfidence: 0.5, visibleLimit: 32, maxDepth: 1 }));
    const node = graph.nodes.find((item) => item.id === targetId);

    expect(node?.x).toBe(720);
    expect(node?.y).toBe(188);
  });
});
