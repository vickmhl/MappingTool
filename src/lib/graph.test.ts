import { describe, expect, it } from 'vitest';
import { createMapBusinessDemoState } from '../data/seed';
import { calculateOrgInsights } from './insights';
import { buildOrgGraph } from './graph';

describe('org graph performance', () => {
  it('keeps formal org chart rendering bounded and report-ready at 5,000+ people scale', () => {
    const state = createMapBusinessDemoState();
    state.project.settings.orgChartMode = 'formal';

    const graphStart = performance.now();
    const graph = buildOrgGraph(state, {
      company: '',
      search: '',
      focusPersonName: '',
      minConfidence: 0.75,
      visibleLimit: 300,
      maxDepth: 3,
    });
    const graphDuration = performance.now() - graphStart;

    const insightStart = performance.now();
    const metrics = calculateOrgInsights(state);
    const insightDuration = performance.now() - insightStart;

    expect(state.people.length).toBeGreaterThan(5000);
    expect(graph.nodes.length).toBeLessThanOrEqual(300);
    expect(graph.lanes.length).toBeGreaterThan(5);
    expect(graph.diagnostics.hiddenDirectReports).toBeGreaterThan(50);
    expect(metrics.peopleCount).toBe(state.people.length);
    expect(graphDuration).toBeLessThan(1000);
    expect(insightDuration).toBeLessThan(1500);
  });

  it('keeps the tree chart compact enough for direct previewing', () => {
    const state = createMapBusinessDemoState();
    state.project.settings.orgChartMode = 'formal';
    state.project.settings.activeCanvasView = 'mindmap';

    const graph = buildOrgGraph(state, {
      company: '',
      search: '',
      focusPersonName: '',
      minConfidence: 0.72,
      visibleLimit: 24,
      maxDepth: 1,
    });

    const minX = Math.min(...graph.nodes.map((node) => node.x));
    const maxX = Math.max(...graph.nodes.map((node) => node.x));
    expect(maxX - minX).toBeLessThan(1450);
    expect(graph.nodes.some((node) => node.mindMapSide === 'left')).toBe(true);
    expect(graph.nodes.some((node) => node.mindMapSide === 'right')).toBe(true);
  });

  it('keeps the recruiting tree chart from overlapping adjacent depth columns', () => {
    const state = createMapBusinessDemoState();
    state.project.settings.orgChartMode = 'formal';
    state.project.settings.activeCanvasView = 'detail';

    const graph = buildOrgGraph(state, {
      company: '',
      search: '',
      focusPersonName: '',
      minConfidence: 0.55,
      visibleLimit: 42,
      maxDepth: 2,
    });

    const sideNodes = graph.nodes.filter(
      (node) => (node.mindMapSide === 'left' || node.mindMapSide === 'right') && node.depth >= 1,
    );
    const minHorizontalStep = sideNodes.reduce((minGap, node) => {
      const parentEdge = graph.edges.find((edge) => edge.target === node.id);
      if (!parentEdge) return minGap;
      const parent = graph.nodes.find((candidate) => candidate.id === parentEdge.source);
      if (!parent) return minGap;
      return Math.min(minGap, Math.abs(node.x - parent.x));
    }, Number.POSITIVE_INFINITY);

    expect(minHorizontalStep).toBeGreaterThan(210);
  });

  it('keeps the executive report chart compact enough for first-screen reading', () => {
    const state = createMapBusinessDemoState();
    state.project.settings.orgChartMode = 'formal';
    state.project.settings.activeCanvasView = 'executive';

    const graph = buildOrgGraph(state, {
      company: '',
      search: '',
      focusPersonName: '',
      minConfidence: 0.72,
      visibleLimit: 28,
      maxDepth: 2,
    });

    const minX = Math.min(...graph.nodes.map((node) => node.x));
    const maxX = Math.max(...graph.nodes.map((node) => node.x));
    expect(maxX - minX).toBeLessThan(3400);
    expect(graph.nodes.filter((node) => node.depth === 1).length).toBeGreaterThanOrEqual(8);
    expect(graph.nodes.find((node) => node.depth === 0)?.levelLabel).toBe('L0 Exec');
  });

  it('keeps the recruiting regular chart grouped by top-level branches instead of spreading by depth lanes', () => {
    const state = createMapBusinessDemoState();
    state.project.settings.orgChartMode = 'formal';
    state.project.settings.activeCanvasView = 'recruiting';

    const graph = buildOrgGraph(state, {
      company: '',
      search: '',
      focusPersonName: '',
      minConfidence: 0.55,
      visibleLimit: 48,
      maxDepth: 2,
    });

    const minX = Math.min(...graph.nodes.map((node) => node.x));
    const maxX = Math.max(...graph.nodes.map((node) => node.x));
    const l1Nodes = graph.nodes.filter((node) => node.depth === 1);
    const l2Nodes = graph.nodes.filter((node) => node.depth === 2);

    expect(maxX - minX).toBeLessThan(3600);
    expect(l1Nodes.length).toBeGreaterThanOrEqual(8);
    expect(l2Nodes.length).toBeGreaterThanOrEqual(20);
    expect(new Set(l2Nodes.map((node) => node.y)).size).toBeGreaterThan(2);
  });
});
