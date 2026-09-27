export interface PasswordValidationResult {
  valid: boolean;
  message: string;
}

export function buildPasswordRecoveryRedirect(origin: string): string {
  return new URL('/admin/reset-password/', origin).toString();
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
