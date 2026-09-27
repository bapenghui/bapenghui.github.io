export interface PasswordValidationResult {
  valid: boolean;
  message: string;
}

export type PasswordRecoveryLink =
  | { kind: 'error' }
  | { kind: 'implicit'; accessToken: string; refreshToken: string }
  | { kind: 'pkce'; code: string }
  | { kind: 'none' };

export function buildPasswordRecoveryRedirect(origin: string): string {
  return new URL('/admin/reset-password/', origin).toString();
}

export function parsePasswordRecoveryLink(value: string): PasswordRecoveryLink {
  const url = new URL(value);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));

  if (url.searchParams.has('error') || hash.has('error')) {
    return { kind: 'error' };
  }

  const code = url.searchParams.get('code');
  if (code) return { kind: 'pkce', code };

  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  if (accessToken && refreshToken) {
    return { kind: 'implicit', accessToken, refreshToken };
  }

  return { kind: 'none' };
}

export function validateNewPassword(
  password: string,
  confirmation: string,
): PasswordValidationResult {
  if (password.length < 12) {
    return { valid: false, message: '新密码至少需要 12 个字符。' };
  }

  if (password !== confirmation) {
    return { valid: false, message: '两次输入的密码不一致。' };
  }

  return { valid: true, message: '' };
}
