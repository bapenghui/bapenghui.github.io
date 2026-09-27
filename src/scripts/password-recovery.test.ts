import { afterEach, describe, expect, it, vi } from 'vitest';

describe('password recovery page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('binds password submission after restoring a recovery session', async () => {
    const passwordField = { disabled: true, focus: vi.fn(), value: '' };
    const confirmationField = { disabled: true, focus: vi.fn(), value: '' };
    const submit = { disabled: true };
    const status = { dataset: {}, textContent: '' };
    const form = {
      addEventListener: vi.fn(),
      querySelector: vi.fn((selector: string) => {
        if (selector === 'button[type="submit"]') return submit;
        return null;
      }),
      querySelectorAll: vi.fn(() => [passwordField, confirmationField]),
    };
    const container = {
      querySelector: vi.fn((selector: string) => {
        if (selector === '[data-recovery-status]') return status;
        if (selector === '[data-recovery-form]') return form;
        return null;
      }),
    };
    const replaceState = vi.fn();
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { user: { id: 'admin-user' } } },
          error: null,
        }),
        onAuthStateChange: vi.fn(),
      },
    };

    vi.doMock('../lib/photos/supabase', () => ({
      getPasswordRecoverySupabaseClient: () => client,
    }));
    vi.stubGlobal('document', {
      querySelector: vi.fn(() => container),
      title: '设置新密码',
    });
    vi.stubGlobal('window', {
      history: { replaceState },
      location: {
        href: 'https://bapenghui.github.io/admin/reset-password/#access_token=access-example&refresh_token=refresh-example&type=recovery',
        pathname: '/admin/reset-password/',
      },
    });

    await import('./password-recovery');

    await vi.waitFor(() => {
      expect(form.addEventListener).toHaveBeenCalledWith('submit', expect.any(Function));
    });
    expect(passwordField.disabled).toBe(false);
    expect(confirmationField.disabled).toBe(false);
    expect(submit.disabled).toBe(false);
    expect(status.textContent).toBe('链接验证成功，请设置新密码。');
    expect(replaceState).toHaveBeenCalledOnce();
  });
});
