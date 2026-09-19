import { describe, expect, it } from 'vitest';
import { formatDate, isPublicEntry, sortByUpdatedDesc } from './content-utils';

describe('content utilities', () => {
  it('excludes draft and private entries from the public site', () => {
    expect(isPublicEntry({ draft: false, visibility: 'public' })).toBe(true);
    expect(isPublicEntry({ draft: true, visibility: 'public' })).toBe(false);
    expect(isPublicEntry({ draft: false, visibility: 'private' })).toBe(false);
  });

  it('sorts content by the most recent update first', () => {
    const entries = [
      { id: 'older', data: { updatedAt: new Date('2026-09-01') } },
      { id: 'newer', data: { updatedAt: new Date('2026-09-18') } },
    ];

    expect(sortByUpdatedDesc(entries).map((entry) => entry.id)).toEqual(['newer', 'older']);
  });

  it('formats dates consistently for Chinese readers', () => {
    expect(formatDate(new Date('2026-09-19T00:00:00Z'))).toBe('2026年9月19日');
  });
});
