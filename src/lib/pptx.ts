import JSZip from 'jszip';
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
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
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
  }

  const mediaFiles = Object.keys(zip.files).filter((name) =>
    /^ppt\/media\/.+\.(png|jpg|jpeg)$/i.test(name),
  );

  if (mediaFiles.length > 0 && chunks.length === 0) {
    warnings.push('PPTX 未解析到可选中文字，可能主要由截图组成。');
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
    warnings.push(`发现 ${mediaFiles.length} 张图片；如组织图是截图，请开启本地 OCR 后重新导入。`);
  }

  return {
    chunks,
    pages: slideFiles.length,
    warnings,
  };
}
