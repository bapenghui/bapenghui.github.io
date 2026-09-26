import type { SupabaseClient } from '@supabase/supabase-js';
import type { PhotoRecord } from '../lib/photos/contracts';
import { buildStagingPath, predictPhotoEvictions } from '../lib/photos/upload';
import { validateLocalPhoto, validatePhotoMetadata } from '../lib/photos/validation';

type UploadStatusTone = 'neutral' | 'success' | 'error' | 'warning';

interface PhotoUploadCallbacks {
  getPhotos: () => PhotoRecord[];
  onSaved: () => Promise<void>;
  setStatus: (message: string, tone: UploadStatusTone) => void;
}

export function createPhotoUploadController(
  container: HTMLElement,
  client: SupabaseClient,
  callbacks: PhotoUploadCallbacks,
) {
  const dialog = requiredElement<HTMLDialogElement>(container, '[data-upload-dialog]');
  const form = requiredElement<HTMLFormElement>(dialog, '[data-upload-form]');
  const fileInput = requiredElement<HTMLInputElement>(dialog, '[data-upload-input]');
  const dropZone = requiredElement<HTMLElement>(dialog, '[data-drop-zone]');
  const selection = requiredElement<HTMLElement>(dialog, '[data-upload-selection]');
  const preview = requiredElement<HTMLImageElement>(dialog, '[data-upload-preview]');
  const submitButton = requiredElement<HTMLButtonElement>(dialog, '[data-upload-submit]');
  const progress = requiredElement<HTMLElement>(dialog, '[data-upload-progress]');
  const capacity = requiredElement<HTMLElement>(dialog, '[data-upload-capacity]');
  let selectedFile: File | null = null;
  let previewUrl: string | null = null;
  let requestId: string | null = null;
  let stagingPath: string | null = null;
  let saving = false;

  function bind(): void {
    requiredElement(container, '[data-upload-button]').addEventListener('click', open);
    requiredElement(dialog, '[data-upload-choose]').addEventListener('click', () => fileInput.click());
    requiredElement(dialog, '[data-upload-close]').addEventListener('click', () => close());
    requiredElement(dialog, '[data-upload-cancel]').addEventListener('click', () => close());
    fileInput.addEventListener('change', () => void selectFile(fileInput.files?.[0] ?? null));
    form.addEventListener('submit', (event) => void save(event));
    dialog.addEventListener('cancel', (event) => {
      if (saving) event.preventDefault();
    });
    dialog.addEventListener('close', reset);

    for (const eventName of ['dragenter', 'dragover']) {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.dataset.active = 'true';
      });
    }
    for (const eventName of ['dragleave', 'drop']) {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.dataset.active = 'false';
      });
    }
    dropZone.addEventListener('drop', (event) => {
      const file = event.dataTransfer?.files[0] ?? null;
      void selectFile(file);
    });
  }

  function open(): void {
    reset();
    dialog.showModal();
    requiredElement<HTMLButtonElement>(dialog, '[data-upload-choose]').focus();
  }

  function close(): void {
    if (saving) return;
    void removeUnusedStaging();
    dialog.close();
  }

  function reset(): void {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    form.reset();
    fileInput.value = '';
    selectedFile = null;
    previewUrl = null;
    requestId = null;
    stagingPath = null;
    saving = false;
    selection.hidden = true;
    submitButton.disabled = true;
    progress.textContent = '';
    dropZone.dataset.active = 'false';
  }

  async function selectFile(file: File | null): Promise<void> {
    if (!file) return;
    const validation = validateLocalPhoto(file);
    if (!validation.ok) {
      progress.textContent = validation.error.message;
      callbacks.setStatus(validation.error.message, 'error');
      return;
    }

    const prediction = predictPhotoEvictions(callbacks.getPhotos(), 1);
    if (!prediction.accepted) {
      progress.textContent = prediction.error;
      callbacks.setStatus(prediction.error, 'error');
      return;
    }

    await removeUnusedStaging();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    selectedFile = file;
    requestId = crypto.randomUUID();
    previewUrl = URL.createObjectURL(file);
    preview.src = previewUrl;
    text(dialog, '[data-upload-filename]', file.name);
    text(dialog, '[data-upload-filemeta]', `${formatBytes(file.size)} · ${file.type}`);
    setInput(form, 'uploadTitle', titleFromFilename(file.name));
    setInput(form, 'uploadAltText', '');
    setInput(form, 'uploadOrientation', await readOrientation(previewUrl));
    capacity.textContent = prediction.evictions.length > 0
      ? `保存后将自动替换「${prediction.evictions[0]?.title}」。保留图片不会被覆盖。`
      : `保存后图片库将有 ${callbacks.getPhotos().length + 1} / 100 张图片。`;
    selection.hidden = false;
    submitButton.disabled = false;
    progress.textContent = '文件已通过浏览器端格式与大小检查。';
    input(form, 'uploadAltText').focus();
  }

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!selectedFile || !requestId || saving) return;

    const fileValidation = validateLocalPhoto(selectedFile);
    const metadataValidation = validatePhotoMetadata({
      title: input(form, 'uploadTitle').value,
      summary: textarea(form, 'uploadSummary').value,
      altText: input(form, 'uploadAltText').value,
      category: input(form, 'uploadCategory').value,
      tags: input(form, 'uploadTags').value.split(','),
    });
    const prediction = predictPhotoEvictions(callbacks.getPhotos(), 1);

    if (!fileValidation.ok) return reportValidationError(fileValidation.error.message);
    if (!metadataValidation.ok) return reportValidationError(metadataValidation.error.message);
    if (!prediction.accepted) return reportValidationError(prediction.error);

    saving = true;
    submitButton.disabled = true;
    progress.textContent = stagingPath ? '正在重试安全入库…' : '正在上传到专属临时区…';

    try {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user) throw new Error('登录状态已失效，请重新登录。');

      if (!stagingPath) {
        stagingPath = buildStagingPath(userData.user.id, selectedFile.type, crypto.randomUUID());
        const { error: uploadError } = await client.storage
          .from('photos')
          .upload(stagingPath, selectedFile, { contentType: selectedFile.type, upsert: false });
        if (uploadError) {
          stagingPath = null;
          throw new Error('临时上传失败，请检查网络后重试。');
        }
      }

      progress.textContent = '正在验证文件并执行容量规则…';
      const { data, error } = await client.functions.invoke('finalize-photo', {
        body: {
          stagingPath,
          metadata: metadataValidation.value,
          orientation: select(form, 'uploadOrientation').value,
          isPublished: checkbox(form, 'uploadIsPublished').checked,
          isFeatured: checkbox(form, 'uploadIsFeatured').checked,
          isReserved: checkbox(form, 'uploadIsReserved').checked,
          sortOrder: Number(input(form, 'uploadSortOrder').value),
        },
        headers: { 'Idempotency-Key': requestId },
      });
      if (error || !data?.data?.photo) throw new Error('服务端未能完成图片入库，请重试。');

      stagingPath = null;
      callbacks.setStatus('图片已经安全保存到图片库。', 'success');
      dialog.close();
      await callbacks.onSaved();
    } catch (error) {
      const message = error instanceof Error ? error.message : '图片保存失败，请稍后重试。';
      progress.textContent = message;
      callbacks.setStatus(message, 'error');
    } finally {
      saving = false;
      submitButton.disabled = selectedFile === null;
    }
  }

  async function removeUnusedStaging(): Promise<void> {
    if (!stagingPath) return;
    const path = stagingPath;
    stagingPath = null;
    await client.storage.from('photos').remove([path]);
  }

  function reportValidationError(message: string): void {
    progress.textContent = message;
    callbacks.setStatus(message, 'error');
  }

  return { bind };
}

function requiredElement<T extends Element>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`Missing photo upload element: ${selector}`);
  return element;
}

function input(parent: ParentNode, name: string): HTMLInputElement {
  return requiredElement(parent, `input[name="${name}"]`);
}

function textarea(parent: ParentNode, name: string): HTMLTextAreaElement {
  return requiredElement(parent, `textarea[name="${name}"]`);
}

function checkbox(parent: ParentNode, name: string): HTMLInputElement {
  return input(parent, name);
}

function select(parent: ParentNode, name: string): HTMLSelectElement {
  return requiredElement(parent, `select[name="${name}"]`);
}

function setInput(parent: ParentNode, name: string, value: string): void {
  const field = requiredElement<HTMLInputElement | HTMLSelectElement>(parent, `[name="${name}"]`);
  field.value = value;
}

function text(parent: ParentNode, selector: string, value: string): void {
  requiredElement<HTMLElement>(parent, selector).textContent = value;
}

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, 120) || '未命名图片';
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1_024 / 1_024).toFixed(bytes >= 1_024 * 1_024 ? 1 : 2)} MiB`;
}

async function readOrientation(url: string): Promise<PhotoRecord['orientation']> {
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    return 'landscape';
  }
  const ratio = image.naturalWidth / image.naturalHeight;
  if (ratio > 1.08) return 'landscape';
  if (ratio < 0.92) return 'portrait';
  return 'square';
}
