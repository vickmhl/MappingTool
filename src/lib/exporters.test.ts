import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMapBusinessDemoState } from '../data/seed';
import { exportOrgGraphPng, exportReportPptx } from './exporters';

const writeFileMock = vi.fn();
const addSlideMock = vi.fn();

vi.mock('pptxgenjs', () => {
  class MockSlide {
    addText = vi.fn();
    addImage = vi.fn();
    addShape = vi.fn();
    addTable = vi.fn();
    background = '';
  }

  class MockPptxGen {
    static ShapeType = { line: 'line' };
    ShapeType = MockPptxGen.ShapeType;
    layout = '';
    author = '';
    subject = '';
    title = '';
    company = '';
    theme = {};

    addSlide() {
      const slide = new MockSlide();
      addSlideMock(slide);
      return slide;
    }

    writeFile = writeFileMock;
  }

  return {
    default: MockPptxGen,
  };
});

function installCanvasMock(): void {
  const gradient = { addColorStop: vi.fn() };
  const context = {
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    clip: vi.fn(),
    setLineDash: vi.fn(),
    measureText: (value: string) => ({ width: value.length * 8 }),
    createLinearGradient: () => gradient,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetY: 0,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textBaseline: 'alphabetic',
    lineJoin: 'round',
    lineCap: 'round',
  } as unknown as CanvasRenderingContext2D;

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,mock-export');
}

describe('exporters', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    writeFileMock.mockReset().mockResolvedValue(undefined);
    addSlideMock.mockReset();
    installCanvasMock();
  });

  it('renders the current org graph to a PNG data URL', () => {
    const state = createMapBusinessDemoState();
    const dataUrl = exportOrgGraphPng(
      state,
      {
        company: '',
        search: '',
        focusPersonName: '',
        minConfidence: 0.72,
        visibleLimit: 28,
        maxDepth: 2,
        onlyTalent: false,
        onlyRecentChanges: false,
        onlyManagers: false,
      },
      false,
      'ppt16x9',
    );

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('generates a PPTX report through the export writer', async () => {
    const state = createMapBusinessDemoState();

    await exportReportPptx(
      state,
      {
        company: '',
        search: '',
        focusPersonName: '',
        minConfidence: 0.72,
        visibleLimit: 28,
        maxDepth: 2,
        onlyTalent: false,
        onlyRecentChanges: false,
        onlyManagers: false,
      },
      'qa-export.pptx',
    );

    expect(addSlideMock).toHaveBeenCalled();
    expect(writeFileMock).toHaveBeenCalledWith({ fileName: 'qa-export.pptx' });
  });
});
