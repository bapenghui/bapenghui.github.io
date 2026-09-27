import { describe, expect, it } from 'vitest';
import {
  buildPasswordRecoveryRedirect,
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
});
