import { describe, expect, it } from 'vitest';
import {
  extractPhotoCandidates,
  isPrivateOrReservedIpv4,
  normalizePublicHttpsUrl,
} from './web-extraction';

describe('web photo extraction', () => {
  it('normalizes a public HTTPS URL and strips the hash', () => {
    expect(normalizePublicHttpsUrl(' https://example.com/gallery#work ')).toEqual({
      ok: true,
      value: 'https://example.com/gallery',
    });
  });

  it.each([
    'http://example.com',
    'https://localhost/gallery',
    'https://camera.local/gallery',
    'https://127.0.0.1/gallery',
    'https://[::1]/gallery',
    'https://user:pass@example.com/gallery',
  ])('rejects an unsafe URL: %s', (url) => {
    expect(normalizePublicHttpsUrl(url)).toMatchObject({ ok: false });
  });

  it.each(['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '224.0.0.1'])
    ('recognizes private or reserved IPv4 address %s', (address) => {
      expect(isPrivateOrReservedIpv4(address)).toBe(true);
    });

  it('extracts, resolves and deduplicates image candidates without rendering HTML', () => {
    const html = `
      <meta property="og:image" content="/cover.webp">
      <img src="/cover.webp" alt="封面" width="1200" height="800">
      <img data-src="https://cdn.example.com/detail.jpg" alt="细节图">
      <img src="data:image/png;base64,AAAA" alt="inline">
    `;

    expect(extractPhotoCandidates(html, 'https://example.com/gallery')).toEqual([
      { imageUrl: 'https://example.com/cover.webp', altText: '', width: null, height: null },
      { imageUrl: 'https://cdn.example.com/detail.jpg', altText: '细节图', width: null, height: null },
    ]);
  });

  it('caps candidate output at 50 unique images', () => {
    const html = Array.from({ length: 70 }, (_, index) => `<img src="/image-${index}.jpg">`).join('');
    expect(extractPhotoCandidates(html, 'https://example.com')).toHaveLength(50);
  });
});
