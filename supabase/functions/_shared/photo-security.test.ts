import { describe, expect, it } from 'vitest';
import {
  detectPhotoMimeType,
  normalizeFinalizePhotoInput,
  normalizeWebFinalizePhotoInput,
  validateIdempotencyKey,
  validateStagingPath,
} from './photo-security';

const userId = '00000000-0000-4000-8000-000000000001';
const objectId = '11111111-1111-4111-8111-111111111111';

describe('finalize photo security boundary', () => {
  it('accepts only a UUID idempotency key', () => {
    expect(validateIdempotencyKey(objectId)).toBe(true);
    expect(validateIdempotencyKey('../same-request')).toBe(false);
  });

  it('accepts only the authenticated user staging path', () => {
    expect(validateStagingPath(`staging/${userId}/${objectId}.webp`, userId)).toBe(true);
    expect(validateStagingPath(`staging/another-user/${objectId}.webp`, userId)).toBe(false);
    expect(validateStagingPath(`staging/${userId}/../secret.webp`, userId)).toBe(false);
    expect(validateStagingPath(`published/${userId}/${objectId}.webp`, userId)).toBe(false);
  });

  it('identifies the real image type from file bytes', () => {
    expect(detectPhotoMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectPhotoMimeType(new TextEncoder().encode('RIFF1234WEBP'))).toBe('image/webp');
    expect(detectPhotoMimeType(new TextEncoder().encode('not an image'))).toBeNull();
  });

  it('normalizes valid metadata and upload options', () => {
    expect(normalizeFinalizePhotoInput({
      stagingPath: `staging/${userId}/${objectId}.jpg`,
      metadata: {
        title: '  工作台  ',
        summary: '  装配过程 ',
        altText: '  桌面上的机械结构 ',
        category: ' 项目 ',
        tags: ['机器人', ' 现场 ', '机器人'],
      },
      orientation: 'portrait',
      isPublished: true,
      isReserved: false,
      isFeatured: false,
      sortOrder: 2,
    }, userId)).toEqual({
      ok: true,
      value: {
        stagingPath: `staging/${userId}/${objectId}.jpg`,
        metadata: {
          title: '工作台',
          summary: '装配过程',
          altText: '桌面上的机械结构',
          category: '项目',
          tags: ['机器人', '现场'],
        },
        orientation: 'portrait',
        isPublished: true,
        isReserved: false,
        isFeatured: false,
        sortOrder: 2,
      },
    });
  });

  it('rejects invalid paths, metadata and option types', () => {
    expect(normalizeFinalizePhotoInput({
      stagingPath: `staging/${userId}/${objectId}.svg`,
      metadata: { title: '', altText: '', category: '', summary: '', tags: [] },
      orientation: 'diagonal',
      isPublished: 'yes',
    }, userId)).toMatchObject({ ok: false, error: { code: 'INVALID_FINALIZE_INPUT' } });
  });

  it('normalizes a web candidate while preserving attribution URLs', () => {
    expect(normalizeWebFinalizePhotoInput({
      sourceType: 'web',
      pageUrl: 'https://example.com/gallery',
      imageUrl: 'https://cdn.example.com/image.webp',
      metadata: {
        title: '网页图片', summary: '', altText: '网页中的图片', category: '灵感', tags: [],
      },
      orientation: 'landscape',
      isPublished: true,
      isReserved: false,
      isFeatured: false,
      sortOrder: 0,
    })).toMatchObject({
      ok: true,
      value: {
        pageUrl: 'https://example.com/gallery',
        imageUrl: 'https://cdn.example.com/image.webp',
      },
    });
  });
});
