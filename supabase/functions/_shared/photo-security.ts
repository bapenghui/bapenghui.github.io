export const PHOTO_MAX_FILE_BYTES = 10 * 1_024 * 1_024;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedOrientations = new Set(['landscape', 'portrait', 'square']);
const allowedExtensions = new Set(['jpg', 'png', 'webp', 'avif']);

interface FinalizeMetadata {
  title: string;
  summary: string;
  altText: string;
  category: string;
  tags: string[];
}

export interface FinalizePhotoInput {
  stagingPath: string;
  metadata: FinalizeMetadata;
  orientation: 'landscape' | 'portrait' | 'square';
  isPublished: boolean;
  isReserved: boolean;
  isFeatured: boolean;
  sortOrder: number;
}

export interface WebFinalizePhotoInput {
  sourceType: 'web';
  pageUrl: string;
  imageUrl: string;
  metadata: FinalizeMetadata;
  orientation: 'landscape' | 'portrait' | 'square';
  isPublished: boolean;
  isReserved: boolean;
  isFeatured: boolean;
  sortOrder: number;
}

type FinalizeInputResult =
  | { ok: true; value: FinalizePhotoInput }
  | { ok: false; error: { code: 'INVALID_FINALIZE_INPUT'; message: string } };

type WebFinalizeInputResult =
  | { ok: true; value: WebFinalizePhotoInput }
  | { ok: false; error: { code: 'INVALID_FINALIZE_INPUT'; message: string } };

export function validateIdempotencyKey(value: string | null): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

export function validateStagingPath(path: string, userId: string): boolean {
  if (!uuidPattern.test(userId) || typeof path !== 'string') return false;
  const parts = path.split('/');
  if (parts.length !== 3 || parts[0] !== 'staging' || parts[1] !== userId) return false;

  const filename = parts[2];
  if (!filename) return false;
  const [objectId = '', extension = '', ...rest] = filename.split('.');
  return rest.length === 0
    && uuidPattern.test(objectId)
    && allowedExtensions.has(extension.toLowerCase());
}

export function normalizeFinalizePhotoInput(
  input: unknown,
  userId: string,
): FinalizeInputResult {
  if (!isRecord(input) || !isRecord(input.metadata)) return invalidInput();

  const stagingPath = typeof input.stagingPath === 'string' ? input.stagingPath : '';
  const orientation = typeof input.orientation === 'string' ? input.orientation : '';
  const sortOrder = input.sortOrder;
  const rawTags = input.metadata.tags;

  if (!validateStagingPath(stagingPath, userId)
    || !allowedOrientations.has(orientation)
    || typeof input.isPublished !== 'boolean'
    || typeof input.isReserved !== 'boolean'
    || typeof input.isFeatured !== 'boolean'
    || typeof sortOrder !== 'number'
    || !Number.isSafeInteger(sortOrder)
    || sortOrder < -2_147_483_648
    || sortOrder > 2_147_483_647
    || !Array.isArray(rawTags)
    || !rawTags.every((tag) => typeof tag === 'string')) {
    return invalidInput();
  }

  const metadata: FinalizeMetadata = {
    title: stringValue(input.metadata.title).trim(),
    summary: stringValue(input.metadata.summary).trim(),
    altText: stringValue(input.metadata.altText).trim(),
    category: stringValue(input.metadata.category).trim(),
    tags: [...new Set(rawTags.map((tag) => tag.trim()).filter(Boolean))],
  };

  const validMetadata = metadata.title.length > 0
    && metadata.title.length <= 120
    && metadata.summary.length <= 600
    && metadata.altText.length > 0
    && metadata.altText.length <= 240
    && metadata.category.length > 0
    && metadata.category.length <= 40
    && metadata.tags.length <= 12
    && metadata.tags.every((tag) => tag.length <= 30);

  if (!validMetadata) return invalidInput();

  return {
    ok: true,
    value: {
      stagingPath,
      metadata,
      orientation: orientation as FinalizePhotoInput['orientation'],
      isPublished: input.isPublished,
      isReserved: input.isReserved,
      isFeatured: input.isFeatured,
      sortOrder,
    },
  };
}

export function normalizeWebFinalizePhotoInput(input: unknown): WebFinalizeInputResult {
  if (!isRecord(input) || input.sourceType !== 'web' || !isRecord(input.metadata)) {
    return invalidInput();
  }
  const pageUrl = normalizePublicHttpsUrl(stringValue(input.pageUrl));
  const imageUrl = normalizePublicHttpsUrl(stringValue(input.imageUrl));
  const orientation = stringValue(input.orientation);
  const sortOrder = input.sortOrder;
  const rawTags = input.metadata.tags;
  if (!pageUrl.ok || !imageUrl.ok
    || !allowedOrientations.has(orientation)
    || typeof input.isPublished !== 'boolean'
    || typeof input.isReserved !== 'boolean'
    || typeof input.isFeatured !== 'boolean'
    || typeof sortOrder !== 'number'
    || !Number.isSafeInteger(sortOrder)
    || sortOrder < -2_147_483_648
    || sortOrder > 2_147_483_647
    || !Array.isArray(rawTags)
    || !rawTags.every((tag) => typeof tag === 'string')) return invalidInput();

  const metadata: FinalizeMetadata = {
    title: stringValue(input.metadata.title).trim(),
    summary: stringValue(input.metadata.summary).trim(),
    altText: stringValue(input.metadata.altText).trim(),
    category: stringValue(input.metadata.category).trim(),
    tags: [...new Set(rawTags.map((tag) => tag.trim()).filter(Boolean))],
  };
  const validMetadata = metadata.title.length > 0
    && metadata.title.length <= 120
    && metadata.summary.length <= 600
    && metadata.altText.length > 0
    && metadata.altText.length <= 240
    && metadata.category.length > 0
    && metadata.category.length <= 40
    && metadata.tags.length <= 12
    && metadata.tags.every((tag) => tag.length <= 30);
  if (!validMetadata) return invalidInput();

  return {
    ok: true,
    value: {
      sourceType: 'web',
      pageUrl: pageUrl.value,
      imageUrl: imageUrl.value,
      metadata,
      orientation: orientation as WebFinalizePhotoInput['orientation'],
      isPublished: input.isPublished,
      isReserved: input.isReserved,
      isFeatured: input.isFeatured,
      sortOrder,
    },
  };
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

export function extensionForMimeType(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/avif') return 'avif';
  throw new Error('UNSUPPORTED_FILE_TYPE');
}

function invalidInput(): { ok: false; error: { code: 'INVALID_FINALIZE_INPUT'; message: string } } {
  return {
    ok: false,
    error: {
      code: 'INVALID_FINALIZE_INPUT',
      message: '图片路径、元数据或保存选项无效。',
    },
  };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}
import { normalizePublicHttpsUrl } from './web-extraction.ts';
