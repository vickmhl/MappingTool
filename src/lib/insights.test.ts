import { describe, expect, it } from 'vitest';
import { createEmptyState, createMapBusinessDemoState } from '../data/seed';
import { buildExecutiveNarrative, calculateOrgInsights } from './insights';

describe('org insights', () => {
  it('scores a large virtual sample as reportable', () => {
    const state = createMapBusinessDemoState();
    const metrics = calculateOrgInsights(state);
    const narrative = buildExecutiveNarrative(state);

    expect(metrics.peopleCount).toBeGreaterThan(800);
    expect(metrics.readinessScore).toBeGreaterThan(80);
    expect(metrics.lineCoverageScore).toBeGreaterThan(95);
    expect(narrative.summaryBullets.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps an empty project in preparation status', () => {
    const state = createEmptyState();
    const metrics = calculateOrgInsights(state);
    const narrative = buildExecutiveNarrative(state);

    expect(metrics.readinessScore).toBe(0);
    expect(metrics.readinessLabel).toBe('先补证据再汇报');
    expect(narrative.nextActions[0]).toContain('导入');
  });

  it('normalizes custom readiness weights and produces business signals', () => {
    const state = createMapBusinessDemoState();
    state.project.settings.insightWeights = {
      coverage: 10,
      confidence: 60,
      freshness: 20,
      confirmation: 10,
    };

    const narrative = buildExecutiveNarrative(state);

    expect(Math.round(narrative.metrics.normalizedWeights.confidence * 100)).toBe(60);
    expect(narrative.businessSignals.length).toBeGreaterThan(0);
    expect(narrative.businessSignals[0].recommendedAction.length).toBeGreaterThan(6);
  });
});
