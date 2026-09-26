import type { PhotoRecord } from './contracts';

const PHOTO_LIBRARY_LIMIT = 100;

const extensionByMimeType = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
]);

export type PhotoEvictionPrediction =
  | { accepted: true; evictions: PhotoRecord[] }
  | { accepted: false; evictions: []; error: string };

export function buildStagingPath(
  userId: string,
  mimeType: string,
  objectId: string,
): string {
  const extension = extensionByMimeType.get(mimeType);
  if (!extension) throw new Error('不支持的图片格式。');

  return `staging/${userId}/${objectId}.${extension}`;
}

export function predictPhotoEvictions(
  photos: PhotoRecord[],
  incomingCount: number,
): PhotoEvictionPrediction {
  const normalizedCount = Number.isInteger(incomingCount) && incomingCount > 0
    ? incomingCount
    : 0;
  const requiredEvictions = Math.max(
    0,
    photos.length + normalizedCount - PHOTO_LIBRARY_LIMIT,
  );

  if (requiredEvictions === 0) return { accepted: true, evictions: [] };

  const evictions = photos
    .filter((photo) => !photo.isReserved)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id))
    .slice(0, requiredEvictions);

  if (evictions.length !== requiredEvictions) {
    return {
      accepted: false,
      evictions: [],
      error: '图片库没有足够的非保留图片可供替换。',
    };
  }

  return { accepted: true, evictions };
}

export function detectPhotoMimeType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }

  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return 'image/webp';
  }

  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }

  return null;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}
