// @ts-nocheck -- Supabase Edge Functions are type-checked by Deno during deployment.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import {
  extractPhotoCandidates,
  isPrivateOrReservedIpv4,
  normalizePublicHttpsUrl,
} from '../_shared/web-extraction.ts';

const MAX_HTML_BYTES = 2 * 1_024 * 1_024;
const allowedOrigins = new Set([
  'https://bapenghui.github.io',
  'http://127.0.0.1:4321',
  'http://localhost:4321',
]);
const recentRequests = new Map<string, number[]>();

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin');
  const cors = corsHeaders(origin);
  if (origin && !allowedOrigins.has(origin)) return error('ORIGIN_NOT_ALLOWED', '不允许从当前页面执行采集。', 403, cors);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return error('METHOD_NOT_ALLOWED', '只支持 POST 请求。', 405, cors);

  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return error('UNAUTHORIZED', '请先登录图片工作台。', 401, cors);

  try {
    const supabaseUrl = requiredEnvironment('SUPABASE_URL');
    const anonKey = requiredEnvironment('SUPABASE_ANON_KEY');
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = authorization.slice('Bearer '.length);
    const { data: userData, error: userError } = await client.auth.getUser(token);
    if (userError || !userData.user) return error('UNAUTHORIZED', '登录状态已失效。', 401, cors);
    const { data: isAdmin, error: adminError } = await client.rpc('current_user_is_photo_admin');
    if (adminError || isAdmin !== true) return error('FORBIDDEN', '当前账号没有图片管理权限。', 403, cors);
    if (!takeRateLimit(userData.user.id)) return error('RATE_LIMITED', '采集过于频繁，请稍后再试。', 429, cors);

    const body = await request.json();
    const normalized = normalizePublicHttpsUrl(typeof body?.pageUrl === 'string' ? body.pageUrl : '');
    if (!normalized.ok) return error('UNSAFE_PAGE_URL', '请输入公开的 HTTPS 网页地址。', 400, cors);

    const { response, finalUrl } = await fetchPublicPage(normalized.value);
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      return error('NOT_HTML', '该地址没有返回可解析的网页。', 400, cors);
    }
    const html = await readBoundedText(response, MAX_HTML_BYTES);
    const candidates = extractPhotoCandidates(html, finalUrl, 50);
    return json({ data: { pageUrl: finalUrl, candidates } }, 200, cors);
  } catch (caught) {
    console.error('extract-photo-candidates failed', caught instanceof Error ? caught.message : caught);
    return error('EXTRACTION_FAILED', '网页图片提取失败，请检查地址或稍后重试。', 502, cors);
  }
});

async function fetchPublicPage(initialUrl: string): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    await assertPublicDestination(currentUrl);
    const response = await fetch(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(8_000),
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': 'BapenghuiPhotoLibrary/1.0',
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirectCount === 3) throw new Error('INVALID_REDIRECT');
      const next = normalizePublicHttpsUrl(new URL(location, currentUrl).toString());
      if (!next.ok) throw new Error('UNSAFE_REDIRECT');
      currentUrl = next.value;
      continue;
    }
    if (!response.ok) throw new Error(`UPSTREAM_${response.status}`);
    return { response, finalUrl: currentUrl };
  }
  throw new Error('TOO_MANY_REDIRECTS');
}

async function assertPublicDestination(rawUrl: string): Promise<void> {
  const hostname = new URL(rawUrl).hostname;
  const [ipv4, ipv6] = await Promise.all([
    Deno.resolveDns(hostname, 'A').catch(() => []),
    Deno.resolveDns(hostname, 'AAAA').catch(() => []),
  ]);
  if (ipv4.length + ipv6.length === 0) throw new Error('DNS_LOOKUP_FAILED');
  if (ipv4.some(isPrivateOrReservedIpv4) || ipv6.some(isPrivateOrReservedIpv6)) {
    throw new Error('PRIVATE_DESTINATION');
  }
}

function isPrivateOrReservedIpv6(address: string): boolean {
  const value = address.toLowerCase();
  if (value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd')
    || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea')
    || value.startsWith('feb') || value.startsWith('ff') || value.startsWith('2001:db8:')) return true;
  const mappedIpv4 = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mappedIpv4 ? isPrivateOrReservedIpv4(mappedIpv4) : false;
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maximumBytes) throw new Error('HTML_TOO_LARGE');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error('HTML_TOO_LARGE');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function takeRateLimit(userId: string): boolean {
  const now = Date.now();
  const recent = (recentRequests.get(userId) ?? []).filter((time) => now - time < 5 * 60_000);
  if (recent.length >= 10) return false;
  recent.push(now);
  recentRequests.set(userId, recent);
  return true;
}

function corsHeaders(origin: string | null): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : 'https://bapenghui.github.io',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(payload: unknown, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
}

function error(code: string, message: string, status: number, headers: HeadersInit): Response {
  return json({ error: { code, message } }, status, headers);
}

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
