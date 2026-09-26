// @ts-nocheck -- Supabase Edge Functions are type-checked by Deno during deployment.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import {
  detectPhotoMimeType,
  extensionForMimeType,
  normalizeFinalizePhotoInput,
  normalizeWebFinalizePhotoInput,
  PHOTO_MAX_FILE_BYTES,
  validateIdempotencyKey,
} from '../_shared/photo-security.ts';
import {
  isPrivateOrReservedIpv4,
  normalizePublicHttpsUrl,
} from '../_shared/web-extraction.ts';

const allowedOrigins = new Set([
  'https://bapenghui.github.io',
  'http://127.0.0.1:4321',
  'http://localhost:4321',
]);

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin');
  const cors = corsHeaders(origin);

  if (origin && !allowedOrigins.has(origin)) {
    return jsonError('ORIGIN_NOT_ALLOWED', '不允许从当前页面执行图片操作。', 403, cors);
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') {
    return jsonError('METHOD_NOT_ALLOWED', '只支持 POST 请求。', 405, cors);
  }

  const idempotencyKey = request.headers.get('idempotency-key');
  if (!validateIdempotencyKey(idempotencyKey)) {
    return jsonError('INVALID_IDEMPOTENCY_KEY', '缺少有效的幂等请求标识。', 400, cors);
  }

  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return jsonError('UNAUTHORIZED', '请先登录图片工作台。', 401, cors);
  }

  try {
    const supabaseUrl = requiredEnvironment('SUPABASE_URL');
    const anonKey = requiredEnvironment('SUPABASE_ANON_KEY');
    const serviceRoleKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const token = authorization.slice('Bearer '.length);
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) {
      return jsonError('UNAUTHORIZED', '登录状态已失效，请重新登录。', 401, cors);
    }

    const { data: isAdmin, error: adminError } = await userClient
      .rpc('current_user_is_photo_admin');
    if (adminError || isAdmin !== true) {
      return jsonError('FORBIDDEN', '当前账号没有图片管理权限。', 403, cors);
    }

    const rawInput = await request.json();
    const isWebImport = rawInput?.sourceType === 'web';
    const input = isWebImport
      ? normalizeWebFinalizePhotoInput(rawInput)
      : normalizeFinalizePhotoInput(rawInput, userData.user.id);
    if (!input.ok) return jsonError(input.error.code, input.error.message, 400, cors);

    const { data: existingPhoto } = await serviceClient
      .from('photos')
      .select('*')
      .like('storage_path', `published/${userData.user.id}/${idempotencyKey}.%`)
      .limit(1)
      .maybeSingle();
    if (existingPhoto) return json({ data: { photo: existingPhoto, evictedStoragePath: null } }, 200, cors);

    let bytes: Uint8Array;
    if (isWebImport) {
      bytes = await fetchRemoteImage(input.value.imageUrl);
    } else {
      const { data: stagingBlob, error: downloadError } = await serviceClient.storage
        .from('photos')
        .download(input.value.stagingPath);
      if (downloadError || !stagingBlob || stagingBlob.size > PHOTO_MAX_FILE_BYTES) {
        return jsonError('INVALID_STAGING_FILE', '临时图片不存在或超过 10 MiB。', 400, cors);
      }
      bytes = new Uint8Array(await stagingBlob.arrayBuffer());
    }

    const mimeType = detectPhotoMimeType(bytes);
    if (!mimeType) {
      return jsonError('UNSUPPORTED_FILE_SIGNATURE', '文件内容不是受支持的图片格式。', 400, cors);
    }
    const extension = extensionForMimeType(mimeType);
    if (!isWebImport && extension !== input.value.stagingPath.split('.').at(-1)) {
      return jsonError('FILE_TYPE_MISMATCH', '文件内容与所选图片格式不一致。', 400, cors);
    }
    const publishedPath = `published/${userData.user.id}/${idempotencyKey}.${extension}`;

    const { error: uploadError } = await serviceClient.storage
      .from('photos')
      .upload(publishedPath, bytes, { contentType: mimeType, upsert: true });
    if (uploadError) throw uploadError;

    const metadata = input.value.metadata;
    const { data: inserted, error: insertError } = await serviceClient.rpc(
      'insert_photo_with_retention',
      {
        p_owner_id: userData.user.id,
        p_title: metadata.title,
        p_summary: metadata.summary,
        p_alt_text: metadata.altText,
        p_category: metadata.category,
        p_tags: metadata.tags,
        p_storage_path: publishedPath,
        p_source_type: isWebImport ? 'web' : 'local',
        p_source_page_url: isWebImport ? input.value.pageUrl : null,
        p_source_image_url: isWebImport ? input.value.imageUrl : null,
        p_orientation: input.value.orientation,
        p_is_featured: input.value.isFeatured,
        p_is_reserved: input.value.isReserved,
        p_is_published: input.value.isPublished,
        p_sort_order: input.value.sortOrder,
        p_published_at: null,
      },
    );

    if (insertError) {
      const { data: concurrentPhoto } = await serviceClient
        .from('photos')
        .select('*')
        .eq('storage_path', publishedPath)
        .maybeSingle();
      if (concurrentPhoto) {
        return json({ data: { photo: concurrentPhoto, evictedStoragePath: null } }, 200, cors);
      }
      await serviceClient.storage.from('photos').remove([publishedPath]);
      throw insertError;
    }

    const cleanupWarnings: string[] = [];
    if (!isWebImport) {
      const { error: stagingCleanupError } = await serviceClient.storage
        .from('photos')
        .remove([input.value.stagingPath]);
      if (stagingCleanupError) cleanupWarnings.push('STAGING_CLEANUP_FAILED');
    }

    const evictedStoragePath = inserted?.evictedStoragePath ?? null;
    if (evictedStoragePath) {
      const { error: evictionCleanupError } = await serviceClient.storage
        .from('photos')
        .remove([evictedStoragePath]);
      if (evictionCleanupError) cleanupWarnings.push('EVICTED_FILE_CLEANUP_FAILED');
    }

    return json({
      data: {
        photo: inserted.photo,
        evictedStoragePath,
        cleanupWarnings,
      },
    }, 200, cors);
  } catch (error) {
    console.error('finalize-photo failed', error instanceof Error ? error.message : error);
    return jsonError('FINALIZE_FAILED', '图片保存失败，请稍后重试。', 500, cors);
  }
});

function corsHeaders(origin: string | null): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin)
      ? origin
      : 'https://bapenghui.github.io',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(payload: unknown, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function jsonError(
  code: string,
  message: string,
  status: number,
  headers: HeadersInit,
): Response {
  return json({ error: { code, message } }, status, headers);
}

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function fetchRemoteImage(initialUrl: string): Promise<Uint8Array> {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    await assertPublicDestination(currentUrl);
    const response = await fetch(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: { 'Accept': 'image/jpeg,image/png,image/webp,image/avif' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirectCount === 3) throw new Error('INVALID_IMAGE_REDIRECT');
      const next = normalizePublicHttpsUrl(new URL(location, currentUrl).toString());
      if (!next.ok) throw new Error('UNSAFE_IMAGE_REDIRECT');
      currentUrl = next.value;
      continue;
    }
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('image/')) {
      throw new Error('REMOTE_IMAGE_INVALID');
    }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > PHOTO_MAX_FILE_BYTES || !response.body) throw new Error('REMOTE_IMAGE_TOO_LARGE');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > PHOTO_MAX_FILE_BYTES) {
        await reader.cancel();
        throw new Error('REMOTE_IMAGE_TOO_LARGE');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
  throw new Error('TOO_MANY_IMAGE_REDIRECTS');
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
