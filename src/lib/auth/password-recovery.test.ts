import { describe, expect, it } from 'vitest';
import {
  buildPasswordRecoveryRedirect,
  parsePasswordRecoveryLink,
  validateNewPassword,
} from './password-recovery';

describe('password recovery', () => {
  it('builds the production-safe password update callback from the current origin', () => {
    expect(buildPasswordRecoveryRedirect('https://bapenghui.github.io')).toBe(
      'https://bapenghui.github.io/admin/reset-password/',
    );
  });

  it('requires a long password and matching confirmation', () => {
    expect(validateNewPassword('short', 'short')).toEqual({
      valid: false,
      message: '新密码至少需要 12 个字符。',
    });
    expect(validateNewPassword('A-long-password-2026', 'different')).toEqual({
      valid: false,
      message: '两次输入的密码不一致。',
    });
    expect(validateNewPassword('A-long-password-2026', 'A-long-password-2026')).toEqual({
      valid: true,
      message: '',
    });
  });

  it('classifies expired links as errors instead of leaving the page pending', () => {
    expect(parsePasswordRecoveryLink(
      'https://bapenghui.github.io/admin/reset-password/#error=access_denied&error_code=otp_expired',
    )).toEqual({ kind: 'error' });
  });

  it('extracts implicit recovery tokens for a manual session fallback', () => {
    expect(parsePasswordRecoveryLink(
      'https://bapenghui.github.io/admin/reset-password/#access_token=access-example&refresh_token=refresh-example&type=recovery',
    )).toEqual({
      kind: 'implicit',
      accessToken: 'access-example',
      refreshToken: 'refresh-example',
    });
  });

  it('extracts a PKCE code for a manual exchange fallback', () => {
    expect(parsePasswordRecoveryLink(
      'https://bapenghui.github.io/admin/reset-password/?code=code-example',
    )).toEqual({ kind: 'pkce', code: 'code-example' });
  });
});
