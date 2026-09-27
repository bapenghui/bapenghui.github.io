import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from './site';

describe('site navigation', () => {
  it('opens the editable photo workspace from the sidebar image entry', () => {
    expect(NAV_ITEMS.find(({ label }) => label === '图片')?.href).toBe('/admin/photos/');
  });
});
