import { describe, expect, it } from 'vitest';
import type { PhotoRecord } from './contracts';
import {
  buildPhotoUpdate,
  canConfirmPhotoDeletion,
  getPhotoCapacitySummary,
  mapPhotoRow,
} from './admin-state';

const basePhoto: PhotoRecord = {
  id: '00000000-0000-4000-8000-000000000002',
  ownerId: '00000000-0000-4000-8000-000000000001',
  title: '机房里的夜晚',
  summary: '一次部署记录。',
  altText: '暗色机柜与状态灯',
  category: '技术现场',
  tags: ['部署', '现场'],
  storagePath: 'published/night.webp',
  sourceType: 'local',
  sourcePageUrl: null,
  sourceImageUrl: null,
  orientation: 'landscape',
  isFeatured: false,
  isReserved: false,
  isPublished: false,
  sortOrder: 0,
  publishedAt: null,
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
};

describe('photo admin state', () => {
  it('maps a database row into the browser photo contract', () => {
    expect(mapPhotoRow({
      id: basePhoto.id,
      owner_id: basePhoto.ownerId,
      title: basePhoto.title,
      summary: basePhoto.summary,
      alt_text: basePhoto.altText,
      category: basePhoto.category,
      tags: basePhoto.tags,
      storage_path: basePhoto.storagePath,
      source_type: basePhoto.sourceType,
      source_page_url: null,
      source_image_url: null,
      orientation: basePhoto.orientation,
      is_featured: false,
      is_reserved: false,
      is_published: false,
      sort_order: 0,
      published_at: null,
      created_at: basePhoto.createdAt,
      updated_at: basePhoto.updatedAt,
    })).toEqual(basePhoto);
  });

  it('normalizes editable values and timestamps first publication', () => {
    expect(buildPhotoUpdate({
      title: '  新标题  ',
      summary: '  新摘要 ',
      altText: ' 新说明 ',
      category: ' 生活 ',
      tags: [' 夜晚 ', '夜晚', ' 散步 '],
      orientation: 'portrait',
      isFeatured: true,
      isReserved: true,
      isPublished: true,
      sortOrder: 8,
      publishedAt: null,
    }, '2026-09-26T12:00:00.000Z')).toEqual({
      title: '新标题',
      summary: '新摘要',
      alt_text: '新说明',
      category: '生活',
      tags: ['夜晚', '散步'],
      orientation: 'portrait',
      is_featured: true,
      is_reserved: true,
      is_published: true,
      sort_order: 8,
      published_at: '2026-09-26T12:00:00.000Z',
    });
  });

  it('requires the exact photo title before deletion', () => {
    expect(canConfirmPhotoDeletion('机房里的夜晚', '机房里的夜晚')).toBe(true);
    expect(canConfirmPhotoDeletion(' 机房里的夜晚 ', '机房里的夜晚')).toBe(true);
    expect(canConfirmPhotoDeletion('机房夜晚', '机房里的夜晚')).toBe(false);
  });

  it('finds the oldest non-reserved photo as the next replacement', () => {
    const reserved = {
      ...basePhoto,
      id: '00000000-0000-4000-8000-000000000001',
      isReserved: true,
      createdAt: '2026-09-01T00:00:00.000Z',
    };
    const newest = {
      ...basePhoto,
      id: '00000000-0000-4000-8000-000000000003',
      createdAt: '2026-09-22T00:00:00.000Z',
      isPublished: true,
    };

    expect(getPhotoCapacitySummary([newest, reserved, basePhoto])).toEqual({
      total: 3,
      reserved: 1,
      drafts: 2,
      available: 97,
      nextEvictionCandidate: basePhoto,
    });
  });
});
