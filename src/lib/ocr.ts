export interface OcrProgress {
  status: string;
  progress: number;
}

export interface OcrResult {
  text: string;
  confidence: number;
}

export async function recognizeImageBlob(
  blob: Blob,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrResult> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('chi_sim+eng', 1, {
    logger: (message: OcrProgress) => onProgress?.(message),
  });

  try {
    const result = await worker.recognize(blob);
    return {
      text: result.data.text.trim(),
      confidence: Math.max(0, Math.min(1, (result.data.confidence ?? 0) / 100)),
    };
  } finally {
    await worker.terminate();
  }
}
