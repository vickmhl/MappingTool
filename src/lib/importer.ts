import type { ImportResult, SourceDocument } from '../types';
import { buildImportExtraction, splitIntoChunks } from './extractor';
import { sha256FromBuffer, sha256FromText } from './hash';
import { createId, nowIso } from './ids';
import { recognizeImageBlob } from './ocr';
import { parsePptxFile } from './pptx';

export interface ImportOptions {
  enableOcr: boolean;
  onProgress?: (message: string) => void;
}

function sourceTypeForFile(file: File): SourceDocument['type'] {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pptx')) return 'pptx';
  if (/\.(png|jpe?g|webp|bmp)$/i.test(name) || file.type?.startsWith('image/')) return 'ocr';
  if (name.endsWith('.md')) return 'markdown';
  return 'text';
}

export async function importSourceFile(file: File, options: ImportOptions): Promise<ImportResult> {
  const type = sourceTypeForFile(file);
  const importedAt = nowIso();
  const hash = await sha256FromBuffer(await file.arrayBuffer());
  const warnings: string[] = [];
  let rawChunks: string[] = [];
  let pages: number | undefined;

  options.onProgress?.(`???? ${file.name}`);

  if (type === 'pptx') {
    const parsed = await parsePptxFile(file, options);
    rawChunks = parsed.chunks.flatMap((chunk) => splitIntoChunks(chunk));
    pages = parsed.pages;
    warnings.push(...parsed.warnings);
  } else if (type === 'ocr') {
    if (!options.enableOcr) {
      warnings.push('?????????? OCR????????????????????????');
    } else {
      try {
        const result = await recognizeImageBlob(file, (progress) => {
          if (progress.progress > 0) {
            options.onProgress?.(`OCR ${file.name}: ${Math.round(progress.progress * 100)}%`);
          }
        });
        rawChunks = splitIntoChunks(result.text);
        if (result.confidence < 0.55) {
          warnings.push('?? OCR ?????????????????????');
        }
      } catch (error) {
        warnings.push(`?? OCR ???${error instanceof Error ? error.message : String(error)}?????????????`);
      }
    }
  } else {
    const text = await file.text();
    rawChunks = splitIntoChunks(text);
  }

  if (rawChunks.length === 0) {
    warnings.push('??????????????????????????');
  }

  const source: SourceDocument = {
    id: createId('src'),
    fileName: file.name,
    type,
    importedAt,
    hash: `${hash}:${await sha256FromText(file.name)}`,
    textPreview: rawChunks.slice(0, 2).join(' ').slice(0, 220),
    totalChunks: rawChunks.length,
    pages,
    warnings,
  };

  const extracted = buildImportExtraction(source, rawChunks);

  return {
    source,
    evidence: extracted.evidence,
    candidates: extracted.candidates,
    warnings,
  };
}
