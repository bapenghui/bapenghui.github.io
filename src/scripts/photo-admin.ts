import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildPhotoUpdate,
  canConfirmPhotoDeletion,
  getPhotoCapacitySummary,
  mapPhotoRow,
  type PhotoDatabaseRow,
} from '../lib/photos/admin-state';
import type { PhotoRecord } from '../lib/photos/contracts';
import { getPhotoSupabaseClient } from '../lib/photos/supabase';

type StatusTone = 'neutral' | 'success' | 'error' | 'warning';

const root = document.querySelector<HTMLElement>('[data-photo-admin]');
if (root) void initializePhotoAdmin(root);

async function initializePhotoAdmin(container: HTMLElement): Promise<void> {
  const status = requiredElement<HTMLElement>(container, '[data-admin-status]');
  const authPanel = requiredElement<HTMLElement>(container, '[data-auth-panel]');
  const manager = requiredElement<HTMLElement>(container, '[data-manager]');
  let client: SupabaseClient;

  try {
    client = getPhotoSupabaseClient();
  } catch {
    setStatus(status, '管理端尚未连接 Supabase。完成项目配置后即可登录。', 'warning');
    authPanel.hidden = false;
    disableForm(requiredElement<HTMLFormElement>(container, '[data-login-form]'));
    return;
  }

  const controller = createAdminController(container, client, status, authPanel, manager);
  controller.bind();
  const { data, error } = await client.auth.getSession();

  if (error || !data.session) {
    controller.showLogin();
    return;
  }

  await controller.openWorkspace();
}

function createAdminController(
  container: HTMLElement,
  client: SupabaseClient,
  status: HTMLElement,
  authPanel: HTMLElement,
  manager: HTMLElement,
) {
  const loginForm = requiredElement<HTMLFormElement>(container, '[data-login-form]');
  const editorForm = requiredElement<HTMLFormElement>(container, '[data-editor-form]');
  const editorEmpty = requiredElement<HTMLElement>(container, '[data-editor-empty]');
  const photoList = requiredElement<HTMLElement>(container, '[data-photo-list]');
  const deleteDialog = requiredElement<HTMLDialogElement>(container, '[data-delete-dialog]');
  const deleteForm = requiredElement<HTMLFormElement>(container, '[data-delete-form]');
  const deleteConfirm = requiredElement<HTMLInputElement>(container, '[data-delete-confirm]');
  const deleteConfirmButton = requiredElement<HTMLButtonElement>(
    container,
    '[data-delete-confirm-button]',
  );
  let photos: PhotoRecord[] = [];
  let selectedPhoto: PhotoRecord | null = null;

  function bind(): void {
    loginForm.addEventListener('submit', (event) => void login(event));
    editorForm.addEventListener('submit', (event) => void savePhoto(event));
    requiredElement(container, '[data-sign-out]').addEventListener('click', () => void signOut());
    requiredElement(container, '[data-refresh]').addEventListener('click', () => void loadPhotos());
    requiredElement(container, '[data-delete-button]').addEventListener('click', openDeleteDialog);
    deleteConfirm.addEventListener('input', updateDeleteButton);
    deleteForm.addEventListener('submit', (event) => void deletePhoto(event));
    requiredElement(container, '[data-upload-button]').addEventListener('click', () => {
      setStatus(status, '本地上传面板正在接入安全入库流程。', 'neutral');
    });
    requiredElement(container, '[data-import-button]').addEventListener('click', () => {
      setStatus(status, '网页采集面板正在接入候选预览流程。', 'neutral');
    });
  }

  function showLogin(): void {
    authPanel.hidden = false;
    manager.hidden = true;
    setStatus(status, '请输入管理员账号。会话仅保存在当前页面内存中。', 'neutral');
  }

  async function openWorkspace(): Promise<void> {
    setStatus(status, '正在验证管理员权限…', 'neutral');
    const { data, error } = await client.rpc('current_user_is_photo_admin');

    if (error || data !== true) {
      await client.auth.signOut();
      showLogin();
      setStatus(status, '当前账号没有图片管理权限。', 'error');
      return;
    }

    authPanel.hidden = true;
    manager.hidden = false;
    await loadPhotos();
  }

  async function login(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const submitButton = requiredElement<HTMLButtonElement>(loginForm, 'button[type="submit"]');
    const formData = new FormData(loginForm);
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');

    submitButton.disabled = true;
    setStatus(status, '正在登录…', 'neutral');
    const { error } = await client.auth.signInWithPassword({ email, password });
    passwordInput(loginForm).value = '';
    submitButton.disabled = false;

    if (error) {
      setStatus(status, '登录失败，请检查账号与密码。', 'error');
      return;
    }

    await openWorkspace();
  }

  async function signOut(): Promise<void> {
    await client.auth.signOut();
    photos = [];
    selectedPhoto = null;
    loginForm.reset();
    showLogin();
  }

  async function loadPhotos(): Promise<void> {
    setStatus(status, '正在读取图片库…', 'neutral');
    const { data, error } = await client
      .from('photos')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      setStatus(status, '图片列表读取失败，请稍后重试。', 'error');
      return;
    }

    photos = (data as PhotoDatabaseRow[]).map(mapPhotoRow);
    renderCapacity();
    renderPhotoList();
    setStatus(status, `已读取 ${photos.length} 张图片。`, 'success');
  }

  function renderCapacity(): void {
    const summary = getPhotoCapacitySummary(photos);
    text(container, '[data-capacity-total]', summary.total);
    text(container, '[data-capacity-reserved]', summary.reserved);
    text(container, '[data-capacity-drafts]', summary.drafts);
    text(container, '[data-capacity-available]', summary.available);

    const note = requiredElement<HTMLElement>(container, '[data-capacity-note]');
    if (summary.total < 100) {
      note.textContent = `还可保存 ${summary.available} 张；草稿与已发布图片都会计入上限。`;
    } else if (summary.nextEvictionCandidate) {
      note.textContent = `下一张保存时将替换「${summary.nextEvictionCandidate.title}」，保留图片不会被覆盖。`;
    } else {
      note.textContent = '100 张图片均已设为保留，继续保存会被拒绝。';
    }
  }

  function renderPhotoList(): void {
    photoList.replaceChildren();

    if (photos.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'admin-empty-state';
      empty.textContent = '图片库还是空的。可以从本地上传，或从公开网页提取候选图片。';
      photoList.append(empty);
      return;
    }

    for (const photo of photos) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'admin-photo-row';
      button.dataset.selected = String(selectedPhoto?.id === photo.id);
      button.addEventListener('click', () => selectPhoto(photo.id));

      const image = document.createElement('img');
      image.src = publicPhotoUrl(client, photo.storagePath);
      image.alt = '';
      image.loading = 'lazy';

      const copy = document.createElement('span');
      copy.className = 'admin-photo-row-copy';
      const title = document.createElement('strong');
      title.textContent = photo.title;
      const meta = document.createElement('small');
      meta.textContent = `${photo.category} · ${formatDate(photo.updatedAt)}`;
      copy.append(title, meta);

      const badges = document.createElement('span');
      badges.className = 'admin-photo-badges';
      badges.append(badge(photo.isPublished ? '已发布' : '草稿', photo.isPublished ? 'published' : 'draft'));
      if (photo.isReserved) badges.append(badge('保留', 'reserved'));

      button.append(image, copy, badges);
      photoList.append(button);
    }
  }

  function selectPhoto(id: string): void {
    selectedPhoto = photos.find((photo) => photo.id === id) ?? null;
    renderPhotoList();

    if (!selectedPhoto) {
      editorForm.hidden = true;
      editorEmpty.hidden = false;
      return;
    }

    editorEmpty.hidden = true;
    editorForm.hidden = false;
    const photo = selectedPhoto;
    setInput(editorForm, 'title', photo.title);
    setInput(editorForm, 'altText', photo.altText);
    setInput(editorForm, 'summary', photo.summary);
    setInput(editorForm, 'category', photo.category);
    setInput(editorForm, 'tags', photo.tags.join(', '));
    setInput(editorForm, 'orientation', photo.orientation);
    setInput(editorForm, 'sortOrder', photo.sortOrder);
    setChecked(editorForm, 'isPublished', photo.isPublished);
    setChecked(editorForm, 'isFeatured', photo.isFeatured);
    setChecked(editorForm, 'isReserved', photo.isReserved);

    const preview = requiredElement<HTMLImageElement>(editorForm, '[data-editor-image]');
    preview.src = publicPhotoUrl(client, photo.storagePath);
    preview.alt = photo.altText;
    text(editorForm, '[data-editor-file]', photo.storagePath.split('/').at(-1) ?? photo.storagePath);
    text(
      editorForm,
      '[data-editor-source]',
      photo.sourceType === 'web' ? '网页采集' : photo.sourceType === 'migrated' ? '历史迁移' : '本地上传',
    );
  }

  async function savePhoto(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!selectedPhoto) return;
    const submitButton = requiredElement<HTMLButtonElement>(editorForm, 'button[type="submit"]');
    submitButton.disabled = true;

    try {
      const update = buildPhotoUpdate({
        title: input(editorForm, 'title').value,
        altText: input(editorForm, 'altText').value,
        summary: input(editorForm, 'summary').value,
        category: input(editorForm, 'category').value,
        tags: input(editorForm, 'tags').value.split(','),
        orientation: select(editorForm, 'orientation').value as PhotoRecord['orientation'],
        sortOrder: Number(input(editorForm, 'sortOrder').value),
        isPublished: checkbox(editorForm, 'isPublished').checked,
        isFeatured: checkbox(editorForm, 'isFeatured').checked,
        isReserved: checkbox(editorForm, 'isReserved').checked,
        publishedAt: selectedPhoto.publishedAt,
      });
      const { data, error } = await client
        .from('photos')
        .update(update)
        .eq('id', selectedPhoto.id)
        .select()
        .single();

      if (error) throw error;
      const updated = mapPhotoRow(data as PhotoDatabaseRow);
      photos = photos.map((photo) => photo.id === updated.id ? updated : photo);
      selectedPhoto = updated;
      renderCapacity();
      selectPhoto(updated.id);
      setStatus(status, '修改已保存，公开状态会立即生效。', 'success');
    } catch (error) {
      setStatus(status, error instanceof Error ? error.message : '保存失败，请稍后重试。', 'error');
    } finally {
      submitButton.disabled = false;
    }
  }

  function openDeleteDialog(): void {
    if (!selectedPhoto) return;
    deleteConfirm.value = '';
    updateDeleteButton();
    const description = requiredElement<HTMLElement>(container, '[data-delete-description]');
    description.textContent = selectedPhoto.isReserved
      ? `「${selectedPhoto.title}」已设为永久保留。删除会同时移除记录和文件，且无法恢复。`
      : `删除「${selectedPhoto.title}」会同时移除记录和文件，且无法恢复。`;
    deleteDialog.showModal();
    deleteConfirm.focus();
  }

  function updateDeleteButton(): void {
    deleteConfirmButton.disabled = !selectedPhoto
      || !canConfirmPhotoDeletion(deleteConfirm.value, selectedPhoto.title);
  }

  async function deletePhoto(event: SubmitEvent): Promise<void> {
    const submitter = event.submitter as HTMLButtonElement | null;
    if (submitter?.value !== 'confirm' || !selectedPhoto) return;
    event.preventDefault();
    if (!canConfirmPhotoDeletion(deleteConfirm.value, selectedPhoto.title)) return;

    const deleting = selectedPhoto;
    deleteConfirmButton.disabled = true;
    const { error } = await client.from('photos').delete().eq('id', deleting.id);

    if (error) {
      setStatus(status, '删除失败，图片仍然保留在图片库中。', 'error');
      return;
    }

    const { error: storageError } = await client.storage.from('photos').remove([deleting.storagePath]);
    photos = photos.filter((photo) => photo.id !== deleting.id);
    selectedPhoto = null;
    deleteDialog.close();
    renderCapacity();
    renderPhotoList();
    editorForm.hidden = true;
    editorEmpty.hidden = false;
    setStatus(
      status,
      storageError
        ? '图片记录已删除，但文件清理失败；请在 Supabase Storage 中检查孤立文件。'
        : '图片及文件已删除。',
      storageError ? 'warning' : 'success',
    );
  }

  return { bind, showLogin, openWorkspace };
}

function publicPhotoUrl(client: SupabaseClient, storagePath: string): string {
  return client.storage.from('photos').getPublicUrl(storagePath).data.publicUrl;
}

function badge(label: string, tone: string): HTMLElement {
  const element = document.createElement('span');
  element.className = `admin-badge admin-badge-${tone}`;
  element.textContent = label;
  return element;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function setStatus(element: HTMLElement, message: string, tone: StatusTone): void {
  element.textContent = message;
  element.dataset.tone = tone;
}

function requiredElement<T extends Element>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`Missing admin interface element: ${selector}`);
  return element;
}

function input(parent: ParentNode, name: string): HTMLInputElement {
  return requiredElement(parent, `input[name="${name}"]`);
}

function passwordInput(parent: ParentNode): HTMLInputElement {
  return requiredElement(parent, 'input[name="password"]');
}

function checkbox(parent: ParentNode, name: string): HTMLInputElement {
  return input(parent, name);
}

function select(parent: ParentNode, name: string): HTMLSelectElement {
  return requiredElement(parent, `select[name="${name}"]`);
}

function setInput(parent: ParentNode, name: string, value: string | number): void {
  const field = parent.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    `[name="${name}"]`,
  );
  if (field) field.value = String(value);
}

function setChecked(parent: ParentNode, name: string, value: boolean): void {
  checkbox(parent, name).checked = value;
}

function text(parent: ParentNode, selector: string, value: string | number): void {
  requiredElement<HTMLElement>(parent, selector).textContent = String(value);
}

function disableForm(form: HTMLFormElement): void {
  for (const field of form.elements) {
    if (field instanceof HTMLInputElement || field instanceof HTMLButtonElement) field.disabled = true;
  }
}
