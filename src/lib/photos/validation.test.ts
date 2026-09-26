import { describe, expect, it } from 'vitest';
import {
  PHOTO_MAX_FILE_BYTES,
  normalizePublicPageUrl,
  validateLocalPhoto,
  validatePhotoMetadata,
} from './validation';

describe('photo validation', () => {
  it('accepts supported image files up to 10 MiB', () => {
    expect(validateLocalPhoto({
      name: 'workbench.webp',
      size: PHOTO_MAX_FILE_BYTES,
      type: 'image/webp',
    })).toEqual({ ok: true });
  });

  it('rejects unsupported and oversized image files', () => {
    expect(validateLocalPhoto({
      name: 'diagram.svg',
      size: 1_024,
      type: 'image/svg+xml',
    })).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_FILE_TYPE' } });

    expect(validateLocalPhoto({
      name: 'camera.jpg',
      size: PHOTO_MAX_FILE_BYTES + 1,
      type: 'image/jpeg',
    })).toMatchObject({ ok: false, error: { code: 'FILE_TOO_LARGE' } });
  });

  it('normalizes public HTTPS page URLs', () => {
    expect(normalizePublicPageUrl('  https://example.com/gallery#latest  ')).toEqual({
      ok: true,
      value: 'https://example.com/gallery',
    });
  });

  it.each([
    'http://example.com/gallery',
    'https://user:password@example.com/gallery',
    'https://localhost/gallery',
    'https://camera.local/gallery',
    'https://127.0.0.1/gallery',
    'https://10.0.0.8/gallery',
    'https://192.168.1.8/gallery',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/gallery',
  ])('rejects unsafe page URL %s', (url) => {
    expect(normalizePublicPageUrl(url)).toMatchObject({ ok: false });
  });

  it('trims valid metadata and removes duplicate tags', () => {
    expect(validatePhotoMetadata({
      title: '  机器人实验台  ',
      summary: '  调试过程记录。 ',
      altText: '  桌面上的机器人结构  ',
      category: '  项目  ',
      tags: ['机器人', ' 实验 ', '机器人', ''],
    })).toEqual({
      ok: true,
      value: {
        title: '机器人实验台',
        summary: '调试过程记录。',
        altText: '桌面上的机器人结构',
        category: '项目',
        tags: ['机器人', '实验'],
      },
    });
  });

  it('requires a title and useful alternative text', () => {
    expect(validatePhotoMetadata({
      title: '   ',
      summary: '',
      altText: '',
      category: '生活',
      tags: [],
    })).toMatchObject({ ok: false, error: { code: 'INVALID_METADATA' } });
  });
});
