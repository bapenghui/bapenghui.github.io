import type { SupabaseClient } from '@supabase/supabase-js';
import type { PhotoCandidate, PhotoRecord } from '../lib/photos/contracts';
import { predictPhotoEvictions } from '../lib/photos/upload';
import { normalizePublicPageUrl, validatePhotoMetadata } from '../lib/photos/validation';

type ImportStatusTone = 'neutral' | 'success' | 'error' | 'warning';

interface PhotoImportCallbacks {
  getPhotos: () => PhotoRecord[];
  onSaved: () => Promise<void>;
  setStatus: (message: string, tone: ImportStatusTone) => void;
}

export function createPhotoImportController(
  container: HTMLElement,
  client: SupabaseClient,
  callbacks: PhotoImportCallbacks,
) {
  const dialog = requiredElement<HTMLDialogElement>(container, '[data-import-dialog]');
  const form = requiredElement<HTMLFormElement>(dialog, '[data-import-form]');
  const urlInput = requiredElement<HTMLInputElement>(dialog, '[data-import-url]');
  const candidatesPanel = requiredElement<HTMLElement>(dialog, '[data-import-candidates]');
  const selectionPanel = requiredElement<HTMLElement>(dialog, '[data-import-selection]');
  const submitButton = requiredElement<HTMLButtonElement>(dialog, '[data-import-submit]');
  const progress = requiredElement<HTMLElement>(dialog, '[data-import-progress]');
  let pageUrl = '';
  let candidates: PhotoCandidate[] = [];
  let selected: PhotoCandidate | null = null;
  let requestId: string | null = null;
  let saving = false;

  function bind(): void {
    requiredElement(container, '[data-import-button]').addEventListener('click', open);
    requiredElement(dialog, '[data-import-close]').addEventListener('click', close);
    requiredElement(dialog, '[data-import-cancel]').addEventListener('click', close);
    requiredElement(dialog, '[data-import-extract]').addEventListener('click', () => void extract());
    form.addEventListener('submit', (event) => void save(event));
    dialog.addEventListener('cancel', (event) => {
      if (saving) event.preventDefault();
    });
    dialog.addEventListener('close', reset);
  }

  function open(): void {
    reset();
    dialog.showModal();
    urlInput.focus();
  }

  function close(): void {
    if (!saving) dialog.close();
  }

  function reset(): void {
    form.reset();
    pageUrl = '';
    candidates = [];
    selected = null;
    requestId = null;
    saving = false;
    candidatesPanel.replaceChildren();
    candidatesPanel.hidden = true;
    selectionPanel.hidden = true;
    submitButton.disabled = true;
    progress.textContent = '';
  }

  async function extract(): Promise<void> {
    const normalized = normalizePublicPageUrl(urlInput.value);
    if (!normalized.ok) return report(normalized.error.message, 'error');
    progress.textContent = '正在安全读取网页并提取图片候选…';
    const extractButton = requiredElement<HTMLButtonElement>(dialog, '[data-import-extract]');
    extractButton.disabled = true;

    try {
      const { data, error } = await client.functions.invoke('extract-photo-candidates', {
        body: { pageUrl: normalized.value },
      });
      if (error || !Array.isArray(data?.data?.candidates)) {
        throw new Error('无法从该网页提取图片，请检查地址或稍后重试。');
      }
      pageUrl = data.data.pageUrl;
      candidates = data.data.candidates;
      selected = null;
      requestId = null;
      renderCandidates();
      progress.textContent = candidates.length > 0
        ? `找到 ${candidates.length} 张候选图片，请选择一张。`
        : '该页面没有找到可用的公开图片。';
    } catch (error) {
      report(error instanceof Error ? error.message : '网页采集失败。', 'error');
    } finally {
      extractButton.disabled = false;
    }
  }

  function renderCandidates(): void {
    candidatesPanel.replaceChildren();
    candidatesPanel.hidden = candidates.length === 0;
    selectionPanel.hidden = true;
    submitButton.disabled = true;

    candidates.forEach((candidate, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'admin-import-candidate';
      button.dataset.selected = 'false';
      button.setAttribute('aria-label', `选择候选图片 ${index + 1}`);
      const image = document.createElement('img');
      image.src = candidate.imageUrl;
      image.alt = candidate.altText;
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      button.append(image);
      button.addEventListener('click', () => selectCandidate(index));
      candidatesPanel.append(button);
    });
  }

  function selectCandidate(index: number): void {
    selected = candidates[index] ?? null;
    if (!selected) return;
    const prediction = predictPhotoEvictions(callbacks.getPhotos(), 1);
    if (!prediction.accepted) return report(prediction.error, 'error');
    requestId = crypto.randomUUID();
    for (const [candidateIndex, button] of [...candidatesPanel.children].entries()) {
      if (button instanceof HTMLElement) button.dataset.selected = String(candidateIndex === index);
    }
    const preview = requiredElement<HTMLImageElement>(dialog, '[data-import-preview]');
    preview.src = selected.imageUrl;
    preview.alt = selected.altText;
    text(dialog, '[data-import-source]', selected.imageUrl);
    setValue(form, 'importTitle', titleFromUrl(selected.imageUrl));
    setValue(form, 'importAltText', selected.altText);
    setValue(form, 'importOrientation', orientationFromCandidate(selected));
    text(
      dialog,
      '[data-import-capacity]',
      prediction.evictions.length > 0
        ? `保存后将自动替换「${prediction.evictions[0]?.title}」。保留图片不会被覆盖。`
        : `保存后图片库将有 ${callbacks.getPhotos().length + 1} / 100 张图片。`,
    );
    selectionPanel.hidden = false;
    submitButton.disabled = false;
    input(form, 'importAltText').focus();
  }

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!selected || !requestId || saving) return;
    const metadata = validatePhotoMetadata({
      title: input(form, 'importTitle').value,
      summary: textarea(form, 'importSummary').value,
      altText: input(form, 'importAltText').value,
      category: input(form, 'importCategory').value,
      tags: input(form, 'importTags').value.split(','),
    });
    const prediction = predictPhotoEvictions(callbacks.getPhotos(), 1);
    if (!metadata.ok) return report(metadata.error.message, 'error');
    if (!prediction.accepted) return report(prediction.error, 'error');

    saving = true;
    submitButton.disabled = true;
    progress.textContent = '正在下载、验证并保存选中的图片…';
    try {
      const { data, error } = await client.functions.invoke('finalize-photo', {
        body: {
          sourceType: 'web',
          pageUrl,
          imageUrl: selected.imageUrl,
          metadata: metadata.value,
          orientation: select(form, 'importOrientation').value,
          isPublished: checkbox(form, 'importIsPublished').checked,
          isFeatured: checkbox(form, 'importIsFeatured').checked,
          isReserved: checkbox(form, 'importIsReserved').checked,
          sortOrder: Number(input(form, 'importSortOrder').value),
        },
        headers: { 'Idempotency-Key': requestId },
      });
      if (error || !data?.data?.photo) throw new Error('服务端未能保存该网页图片，请重试。');
      callbacks.setStatus('网页图片已经保存，并保留了来源地址。', 'success');
      dialog.close();
      await callbacks.onSaved();
    } catch (error) {
      report(error instanceof Error ? error.message : '网页图片保存失败。', 'error');
    } finally {
      saving = false;
      submitButton.disabled = selected === null;
    }
  }

  function report(message: string, tone: ImportStatusTone): void {
    progress.textContent = message;
    callbacks.setStatus(message, tone);
  }

  return { bind };
}

function requiredElement<T extends Element>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`Missing photo import element: ${selector}`);
  return element;
}
function input(parent: ParentNode, name: string): HTMLInputElement { return requiredElement(parent, `input[name="${name}"]`); }
function textarea(parent: ParentNode, name: string): HTMLTextAreaElement { return requiredElement(parent, `textarea[name="${name}"]`); }
function checkbox(parent: ParentNode, name: string): HTMLInputElement { return input(parent, name); }
function select(parent: ParentNode, name: string): HTMLSelectElement { return requiredElement(parent, `select[name="${name}"]`); }
function setValue(parent: ParentNode, name: string, value: string): void { requiredElement<HTMLInputElement | HTMLSelectElement>(parent, `[name="${name}"]`).value = value; }
function text(parent: ParentNode, selector: string, value: string): void { requiredElement<HTMLElement>(parent, selector).textContent = value; }
function titleFromUrl(value: string): string {
  try {
    const filename = new URL(value).pathname.split('/').filter(Boolean).at(-1) ?? '网页图片';
    return decodeURIComponent(filename).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 120) || '网页图片';
  } catch { return '网页图片'; }
}
function orientationFromCandidate(candidate: PhotoCandidate): PhotoRecord['orientation'] {
  if (!candidate.width || !candidate.height) return 'landscape';
  const ratio = candidate.width / candidate.height;
  return ratio > 1.08 ? 'landscape' : ratio < 0.92 ? 'portrait' : 'square';
}
