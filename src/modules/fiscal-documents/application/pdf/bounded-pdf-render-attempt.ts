export interface PdfRenderAttemptContext {
  readonly signal: AbortSignal;
  readonly isOpen: () => boolean;
}

export class PdfRenderTimeoutError extends Error {
  readonly code = 'RENDER_TIMEOUT';

  constructor(readonly timeoutMs: number) {
    super(`PDF render exceeded the configured ${timeoutMs}ms deadline.`);
    this.name = 'PdfRenderTimeoutError';
  }
}

/**
 * Runs one cooperative render attempt. Once its deadline closes, late bytes are
 * ignored and cannot resolve this attempt as a success. The renderer receives
 * an AbortSignal so streams/documents can release their own resources.
 */
export function runBoundedPdfRenderAttempt<T>(
  operation: (context: PdfRenderAttemptContext) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('PDF render timeout must be a positive integer.');
  }

  const controller = new AbortController();
  let open = true;

  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!open) return;
      open = false;
      controller.abort(new PdfRenderTimeoutError(timeoutMs));
      reject(new PdfRenderTimeoutError(timeoutMs));
    }, timeoutMs);

    void operation({ signal: controller.signal, isOpen: () => open }).then(
      (value) => {
        if (!open) return;
        open = false;
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        if (!open) return;
        open = false;
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
