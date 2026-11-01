/**
 * EDENS AI — Client-Side Plant Image Preparation & Normalization
 *
 * Resizes high-resolution phone/camera photos to an optimal inspection resolution (<= 1024px)
 * and normalizes raster formats (JPEG, PNG, WebP, AVIF, HEIC-decoded, BMP, GIF) to clean JPEG
 * bytes (`FF D8 FF`). Prevents reverse-proxy `413 Payload Too Large` HTML errors, eliminates
 * multi-megabyte mobile upload timeouts, and ensures backend raster byte verification succeeds.
 */

export interface ImagePrepOptions {
  maxDimension?: number;
  quality?: number;
}

const MAX_INLINE_DATA_URL_LENGTH = 1_800_000; // ~1.35 MB binary JPEG ceiling

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith('data:')) {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read the selected photo file.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read the selected photo from your device.'));
    reader.readAsDataURL(blob);
  });
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(
        new Error(
          'This file could not be decoded as an image. Please choose a clear JPG, PNG, or WebP photo.'
        )
      );
    img.src = src;
  });
}

function renderImageToJpegDataUrl(
  img: HTMLImageElement,
  maxDimension: number,
  quality: number
): string | null {
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  if (!naturalW || !naturalH) return null;

  let targetW = naturalW;
  let targetH = naturalH;
  if (targetW > maxDimension || targetH > maxDimension) {
    const scale = Math.min(maxDimension / targetW, maxDimension / targetH);
    targetW = Math.max(1, Math.round(targetW * scale));
    targetH = Math.max(1, Math.round(targetH * scale));
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Fill white background so transparent PNGs convert cleanly to JPEG
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  if (!dataUrl || !dataUrl.startsWith('data:image/jpeg;base64,')) {
    return null;
  }
  return dataUrl;
}

/**
 * Normalizes and compresses a `File`, `Blob`, or `data:image/*` URL into a compact,
 * verified `data:image/jpeg;base64,...` payload ready for `/api/ai/diagnose`.
 */
export async function prepareImageForDiagnosis(
  input: File | Blob | string,
  options: ImagePrepOptions = {}
): Promise<string> {
  const maxDimension = options.maxDimension ?? 1024;
  const quality = options.quality ?? 0.85;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error('No plant photo was provided for inspection.');
    }

    // Non-DOM / Node test environment fallback
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      return trimmed;
    }

    // Already a compact JPEG data URL -> skip re-encoding unless oversized
    if (
      trimmed.startsWith('data:image/jpeg;base64,') &&
      trimmed.length <= 450_000 &&
      options.maxDimension === undefined
    ) {
      return trimmed;
    }

    try {
      const img = await loadHtmlImage(trimmed);
      let encoded = renderImageToJpegDataUrl(img, maxDimension, quality);
      if (encoded && encoded.length > MAX_INLINE_DATA_URL_LENGTH) {
        encoded = renderImageToJpegDataUrl(img, 800, 0.72);
      }
      if (encoded) return encoded;
    } catch {
      // If string is already a supported raster data URL, allow server validation to inspect it
      if (/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(trimmed)) {
        return trimmed;
      }
      throw new Error(
        'Selected photo format is not supported. Please upload a clear JPG, PNG, or WebP leaf photo.'
      );
    }
    return trimmed;
  }

  if (input.size === 0) {
    throw new Error('The selected photo file is empty (0 bytes). Please choose another photo.');
  }

  // Non-DOM fallback
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return readBlobAsDataUrl(input);
  }

  let objectUrl: string | null = null;
  try {
    objectUrl =
      typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(input)
        : await readBlobAsDataUrl(input);

    const img = await loadHtmlImage(objectUrl);
    let encoded = renderImageToJpegDataUrl(img, maxDimension, quality);
    if (encoded && encoded.length > MAX_INLINE_DATA_URL_LENGTH) {
      encoded = renderImageToJpegDataUrl(img, 800, 0.72);
    }
    if (encoded) {
      return encoded;
    }
  } catch (decodeErr: any) {
    // Fallback to raw data URL only if file MIME is natively supported and reasonably sized (< 6 MB)
    const mime = (input.type || '').toLowerCase();
    if (
      (mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/png' || mime === 'image/webp') &&
      input.size <= 6 * 1024 * 1024
    ) {
      return readBlobAsDataUrl(input);
    }
    throw new Error(
      decodeErr?.message ||
        'Could not process this image format. Please choose a clear JPG, PNG, or WebP photo.'
    );
  } finally {
    if (
      objectUrl &&
      objectUrl.startsWith('blob:') &&
      typeof URL !== 'undefined' &&
      typeof URL.revokeObjectURL === 'function'
    ) {
      URL.revokeObjectURL(objectUrl);
    }
  }

  return readBlobAsDataUrl(input);
}
