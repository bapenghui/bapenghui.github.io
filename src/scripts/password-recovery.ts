import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parsePasswordRecoveryLink,
  validateNewPassword,
} from '../lib/auth/password-recovery';
import { getPasswordRecoverySupabaseClient } from '../lib/photos/supabase';

const root = document.querySelector<HTMLElement>('[data-password-recovery]');
if (root) void initializePasswordRecovery(root);

async function initializePasswordRecovery(container: HTMLElement): Promise<void> {
  const status = requiredElement<HTMLElement>(container, '[data-recovery-status]');
  const form = requiredElement<HTMLFormElement>(container, '[data-recovery-form]');
  const fields = Array.from(form.querySelectorAll<HTMLInputElement>('input'));
  const submit = requiredElement<HTMLButtonElement>(form, 'button[type="submit"]');
  const recoveryLink = parsePasswordRecoveryLink(window.location.href);

  if (recoveryLink.kind === 'error') {
    scrubRecoveryUrl();
    setStatus(status, '重置链接无效或已经过期，请返回登录页重新发送。', 'error');
    return;
  }

  let client: SupabaseClient;
  try {
    client = getPasswordRecoverySupabaseClient();
  } catch {
    setStatus(status, '密码恢复服务尚未配置，请返回登录页。', 'error');
    return;
  }

  let unlocked = false;
  const unlockForm = (): void => {
    if (unlocked) return;
    unlocked = true;
    fields.forEach((field) => { field.disabled = false; });
    submit.disabled = false;
    scrubRecoveryUrl();
    setStatus(status, '链接验证成功，请设置新密码。', 'success');
    fields[0]?.focus();
  };

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session) unlockForm();
  });

  const { data, error } = await client.auth.getSession();
  if (data.session) {
    unlockForm();
    return;
  }

  if (!error && recoveryLink.kind === 'implicit') {
    const result = await client.auth.setSession({
      access_token: recoveryLink.accessToken,
      refresh_token: recoveryLink.refreshToken,
    });
    if (result.data.session) {
      unlockForm();
      return;
    }
  }

  if (!error && recoveryLink.kind === 'pkce') {
    const result = await client.auth.exchangeCodeForSession(recoveryLink.code);
    if (result.data.session) {
      unlockForm();
      return;
    }
  }

  if (!unlocked) {
    scrubRecoveryUrl();
    setStatus(status, '重置链接无效或已经过期，请返回登录页重新发送。', 'error');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const password = String(formData.get('password') ?? '');
    const confirmation = String(formData.get('confirmation') ?? '');
    const validation = validateNewPassword(password, confirmation);

    if (!validation.valid) {
      setStatus(status, validation.message, 'warning');
      return;
    }

    submit.disabled = true;
    setStatus(status, '正在保存新密码…', 'neutral');
    const { error: updateError } = await client.auth.updateUser({ password });
    fields.forEach((field) => { field.value = ''; });

    if (updateError) {
      submit.disabled = false;
      setStatus(status, '新密码保存失败，链接可能已经过期，请重新发送重置邮件。', 'error');
      return;
    }

    await client.auth.signOut();
    setStatus(status, '密码已更新。现在可以返回图片工作台登录。', 'success');
  });
}

function scrubRecoveryUrl(): void {
  window.history.replaceState({}, document.title, window.location.pathname);
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function setStatus(
  element: HTMLElement,
  message: string,
  tone: 'neutral' | 'success' | 'error' | 'warning',
): void {
  element.textContent = message;
  element.dataset.tone = tone;
}
