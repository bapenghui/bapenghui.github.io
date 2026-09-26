import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface PublicSupabaseConfig {
  url: string;
  publishableKey: string;
}

interface PublicEnvironment {
  PUBLIC_SUPABASE_URL?: string;
  PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
}

let browserClient: SupabaseClient | undefined;

export function readPublicSupabaseConfig(
  environment: PublicEnvironment,
): PublicSupabaseConfig {
  const url = environment.PUBLIC_SUPABASE_URL?.trim() ?? '';
  const publishableKey = environment.PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

  if (!url || !publishableKey) {
    throw new Error('缺少 Supabase 公开配置，请检查 PUBLIC_SUPABASE_URL 和 publishable key。');
  }

  if (publishableKey.startsWith('sb_secret_') || publishableKey.includes('service_role')) {
    throw new Error('浏览器配置不能包含 Supabase secret/service key。');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('PUBLIC_SUPABASE_URL 不是有效的网址。');
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error('PUBLIC_SUPABASE_URL 必须使用 HTTPS。');
  }

  return { url: parsedUrl.origin, publishableKey };
}

export function createPhotoSupabaseClient(
  config: PublicSupabaseConfig,
): SupabaseClient {
  return createClient(config.url, config.publishableKey, {
    // GitHub Pages cannot issue HttpOnly session cookies. Keep admin tokens
    // in memory instead of persistent browser storage.
    // Source: https://supabase.com/docs/reference/javascript/auth-api
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function getPhotoSupabaseClient(): SupabaseClient {
  browserClient ??= createPhotoSupabaseClient(readPublicSupabaseConfig({
    PUBLIC_SUPABASE_URL: import.meta.env.PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_PUBLISHABLE_KEY: import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  }));
  return browserClient;
}
