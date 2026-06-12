import { describe, expect, it } from 'vitest';
import { createMapBusinessDemoState } from '../data/seed';
import { buildOrgHierarchyModel } from './reportModel';

describe('report model', () => {
  it('keeps the HRBP report hierarchy bounded for presentation use', () => {
    const state = createMapBusinessDemoState();
    const model = buildOrgHierarchyModel(state);

    expect(model.root).toBeDefined();
    expect(model.firstLayer.length).toBeGreaterThanOrEqual(8);
    expect(model.firstLayer.length).toBeLessThanOrEqual(10);
    expect(model.secondLayerGroups.length).toBeLessThanOrEqual(6);
    expect(model.secondLayerGroups.every((group) => group.children.length <= 4)).toBe(true);
  });
});
