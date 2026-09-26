import { describe, expect, it } from 'vitest';
import type { PhotoRecord } from './contracts';
import {
  buildStagingPath,
  detectPhotoMimeType,
  predictPhotoEvictions,
} from './upload';

function photo(overrides: Partial<PhotoRecord>): PhotoRecord {
  return {
    id: crypto.randomUUID(),
    ownerId: '00000000-0000-4000-8000-000000000001',
    title: '未命名图片',
    summary: '',
    altText: '图片',
    category: '未分类',
    tags: [],
    storagePath: `published/${crypto.randomUUID()}.webp`,
    sourceType: 'local',
    sourcePageUrl: null,
    sourceImageUrl: null,
    orientation: 'landscape',
    isFeatured: false,
    isReserved: false,
    isPublished: true,
    sortOrder: 0,
    publishedAt: '2026-09-01T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('local photo upload', () => {
  it('builds a user-scoped staging path without using the original filename', () => {
    expect(buildStagingPath(
      '00000000-0000-4000-8000-000000000001',
      'image/png',
      '11111111-1111-4111-8111-111111111111',
    )).toBe(
      'staging/00000000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111.png',
    );
  });

  it('predicts the oldest non-reserved photo that one new upload will replace', () => {
    const photos = Array.from({ length: 100 }, (_, index) => photo({
      id: String(index).padStart(3, '0'),
      title: `图片 ${index}`,
      isReserved: index === 0,
      createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    }));

    expect(predictPhotoEvictions(photos, 1)).toEqual({
      accepted: true,
      evictions: [expect.objectContaining({ title: '图片 1' })],
    });
  });

  it('rejects a batch when reserved photos leave insufficient replaceable capacity', () => {
    const photos = Array.from({ length: 100 }, (_, index) => photo({
      id: String(index),
      isReserved: index >= 1,
      createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    }));

    expect(predictPhotoEvictions(photos, 2)).toEqual({
      accepted: false,
      evictions: [],
      error: '图片库没有足够的非保留图片可供替换。',
    });
  });

  it('detects supported image signatures and rejects misleading content', () => {
    expect(detectPhotoMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectPhotoMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
      .toBe('image/png');
    expect(detectPhotoMimeType(new TextEncoder().encode('RIFF1234WEBP'))).toBe('image/webp');
    expect(detectPhotoMimeType(new TextEncoder().encode('....ftypavif'))).toBe('image/avif');
    expect(detectPhotoMimeType(new TextEncoder().encode('<html>not an image</html>'))).toBeNull();
  });
});
