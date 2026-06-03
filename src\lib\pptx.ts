import { recognizeImageBlob } from './ocr';

export interface PptxParseOptions {
  enableOcr: boolean;
  onProgress?: (message: string) => void;
}

export interface PptxParseResult {
  chunks: string[];
  pages: number;
  warnings: string[];
}

function decodeXml(value: string): string {
  const element = document.createElement('textarea');
  element.innerHTML = value;
  return element.value;
}

function extractSlideText(xml: string): string {
  const parts = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((match) =>
    decodeXml(match[1]).trim(),
  );
  return parts.filter(Boolean).join(' ');
}

function slideNumber(path: string): number {
  return Number(path.match(/slide(\d+)\.xml/)?.[1] ?? 0);
}

export async function parsePptxFile(
  file: File,
  options: PptxParseOptions,
): Promise<PptxParseResult> {
  const { default: JSZip } = await import('jszip');
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error('这个 PPTX 无法打开，可能文件已损坏、被加密，或不是标准 .pptx。请另存为新的 PPTX 后再导入。');
  }

  const warnings: string[] = [];
  const chunks: string[] = [];

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  for (const slidePath of slideFiles) {
    const slideXml = await zip.file(slidePath)?.async('text');
    if (!slideXml) continue;

    const text = extractSlideText(slideXml);
    if (text) {
      chunks.push(`第 ${slideNumber(slidePath)} 页：${text}`);
    }

    if (/<p:cxnSp\b/.test(slideXml)) {
      warnings.push(`第 ${slideNumber(slidePath)} 页检测到连接线；首版会保留文字，但上下级关系仍需要在确认页或画布里复核。`);
    }
  }

  const diagramFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/diagrams\/data\d+\.xml$/.test(name))
    .sort();

  for (const diagramPath of diagramFiles) {
    const diagramXml = await zip.file(diagramPath)?.async('text');
    if (!diagramXml) continue;
    const diagramText = extractSlideText(diagramXml);
    if (diagramText) {
      chunks.push(`SmartArt ${diagramPath}: ${diagramText}`);
    }
  }

  if (diagramFiles.length > 0) {
    warnings.push(`检测到 ${diagramFiles.length} 个 SmartArt/组织图对象；已尝试读取其中的文字，但层级线仍需要人工确认。`);
  }

  const mediaFiles = Object.keys(zip.files).filter((name) =>
    /^ppt\/media\/.+\.(png|jpg|jpeg)$/i.test(name),
  );

  if (mediaFiles.length > 0 && chunks.length === 0) {
    warnings.push('PPTX 未解析到可选中文字，可能主要由截图组成。请开启 OCR 后重试，或到组织图页手动新增人员和汇报线。');
  }

  if (options.enableOcr && mediaFiles.length > 0) {
    for (const mediaPath of mediaFiles.slice(0, 12)) {
      try {
        options.onProgress?.(`正在 OCR ${mediaPath}`);
        const blob = await zip.file(mediaPath)?.async('blob');
        if (!blob) continue;

        const result = await recognizeImageBlob(blob, (progress) => {
          if (progress.progress > 0) {
            options.onProgress?.(`OCR ${mediaPath}: ${Math.round(progress.progress * 100)}%`);
          }
        });

        if (result.text) {
          chunks.push(`图片 OCR ${mediaPath}：${result.text}`);
        } else {
          warnings.push(`${mediaPath} OCR 未识别到文字。`);
        }
      } catch (error) {
        warnings.push(`${mediaPath} OCR 失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (mediaFiles.length > 12) {
      warnings.push(`图片数量较多，首版仅 OCR 前 12 张图片，剩余 ${mediaFiles.length - 12} 张请人工复核。`);
    }
  }

  if (mediaFiles.length > 0 && !options.enableOcr) {
    warnings.push(`发现 ${mediaFiles.length} 张图片；如组织图是截图，请开启本地 OCR 后重新导入，OCR 结果会进入人工确认。`);
  }

  if (slideFiles.length === 0) {
    warnings.push('没有找到标准幻灯片页面，请确认文件是普通 PPTX，而不是模板、加密文件或损坏文件。');
  }

  return {
    chunks,
    pages: slideFiles.length,
    warnings,
  };
}
