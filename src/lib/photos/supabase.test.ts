import { describe, expect, it } from 'vitest';
import {
  createPhotoSupabaseClient,
  readPublicSupabaseConfig,
} from './supabase';

describe('photo Supabase client', () => {
  it('rejects missing public configuration with a useful message', () => {
    expect(() => readPublicSupabaseConfig({})).toThrow('Supabase 公开配置');
  });

  it('rejects secret keys at the browser boundary', () => {
    expect(() => readPublicSupabaseConfig({
      PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_do_not_bundle',
    })).toThrow('secret/service key');
  });

  it('creates a non-persistent browser client from public configuration', () => {
    const config = readPublicSupabaseConfig({
      PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
    });

    expect(() => createPhotoSupabaseClient(config)).not.toThrow();
    expect(config).toEqual({
      url: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_example',
    });
  });
});
