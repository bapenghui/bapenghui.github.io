export interface WebPhotoCandidate {
  imageUrl: string;
  altText: string;
  width: number | null;
  height: number | null;
}

type UrlResult = { ok: true; value: string } | { ok: false };

const ipv4Pattern = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function normalizePublicHttpsUrl(rawUrl: string): UrlResult {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { ok: false };
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const invalidHost = !hostname
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || ipv4Pattern.test(hostname)
    || hostname.startsWith('[')
    || hostname.endsWith(']');

  if (url.protocol !== 'https:' || url.username || url.password || invalidHost) {
    return { ok: false };
  }

  url.hash = '';
  return { ok: true, value: url.toString() };
}

export function isPrivateOrReservedIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return true;
  }

  const [a = 0, b = 0] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

export function extractPhotoCandidates(
  html: string,
  baseUrl: string,
  limit = 50,
): WebPhotoCandidate[] {
  const candidates: WebPhotoCandidate[] = [];
  const seen = new Set<string>();

  const append = (
    rawUrl: string,
    altText = '',
    width: number | null = null,
    height: number | null = null,
  ): void => {
    if (candidates.length >= limit) return;
    let resolved: string;
    try {
      resolved = new URL(decodeHtml(rawUrl), baseUrl).toString();
    } catch {
      return;
    }
    const normalized = normalizePublicHttpsUrl(resolved);
    if (!normalized.ok || seen.has(normalized.value)) return;
    seen.add(normalized.value);
    candidates.push({
      imageUrl: normalized.value,
      altText: decodeHtml(altText).trim().slice(0, 240),
      width,
      height,
    });
  };

  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const property = (attribute(tag, 'property') || attribute(tag, 'name')).toLowerCase();
    if (property === 'og:image' || property === 'twitter:image' || property === 'twitter:image:src') {
      append(attribute(tag, 'content'));
    }
  }

  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const srcset = attribute(tag, 'srcset');
    const srcsetUrl = srcset.split(',').at(-1)?.trim().split(/\s+/)[0] ?? '';
    const source = attribute(tag, 'src') || attribute(tag, 'data-src') || srcsetUrl;
    if (!source) continue;
    append(
      source,
      attribute(tag, 'alt'),
      positiveInteger(attribute(tag, 'width')),
      positiveInteger(attribute(tag, 'height')),
    );
  }

  return candidates;
}

function attribute(tag: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`\\s${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function positiveInteger(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}
