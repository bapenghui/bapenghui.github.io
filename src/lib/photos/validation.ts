import type {
  LocalPhotoDescriptor,
  PhotoMetadataInput,
  ValidationResult,
} from './contracts';

export const PHOTO_MAX_FILE_BYTES = 10 * 1_024 * 1_024;

export const PHOTO_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;

type FileValidationResult = { ok: true } | {
  ok: false;
  error: { code: string; message: string };
};

const allowedMimeTypes = new Set<string>(PHOTO_ALLOWED_MIME_TYPES);
const ipV4LiteralPattern = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function validateLocalPhoto(file: LocalPhotoDescriptor): FileValidationResult {
  if (!allowedMimeTypes.has(file.type)) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_FILE_TYPE',
        message: '仅支持 JPEG、PNG、WebP 和 AVIF 图片。',
      },
    };
  }

  if (file.size <= 0) {
    return {
      ok: false,
      error: { code: 'EMPTY_FILE', message: '图片文件不能为空。' },
    };
  }

  if (file.size > PHOTO_MAX_FILE_BYTES) {
    return {
      ok: false,
      error: { code: 'FILE_TOO_LARGE', message: '单张图片不能超过 10 MiB。' },
    };
  }

  return { ok: true };
}

export function normalizePublicPageUrl(rawUrl: string): ValidationResult<string> {
  let pageUrl: URL;

  try {
    pageUrl = new URL(rawUrl.trim());
  } catch {
    return invalidUrl('请输入完整的 HTTPS 网页地址。');
  }

  if (pageUrl.protocol !== 'https:') {
    return invalidUrl('网页采集仅支持 HTTPS 地址。');
  }

  if (pageUrl.username || pageUrl.password) {
    return invalidUrl('网页地址不能包含用户名或密码。');
  }

  const hostname = pageUrl.hostname.toLowerCase().replace(/\.$/, '');
  const isLocalName = hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local');
  const isIpLiteral = ipV4LiteralPattern.test(hostname)
    || hostname.startsWith('[')
    || hostname.endsWith(']');

  if (!hostname || isLocalName || isIpLiteral) {
    return invalidUrl('网页地址必须使用公开域名。');
  }

  pageUrl.hash = '';
  return { ok: true, value: pageUrl.toString() };
}

export function validatePhotoMetadata(
  input: PhotoMetadataInput,
): ValidationResult<PhotoMetadataInput> {
  const value: PhotoMetadataInput = {
    title: input.title.trim(),
    summary: input.summary.trim(),
    altText: input.altText.trim(),
    category: input.category.trim(),
    tags: [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))],
  };

  const hasRequiredFields = value.title.length > 0
    && value.altText.length > 0
    && value.category.length > 0;
  const hasValidLengths = value.title.length <= 120
    && value.summary.length <= 600
    && value.altText.length <= 240
    && value.category.length <= 40
    && value.tags.length <= 12
    && value.tags.every((tag) => tag.length <= 30);

  if (!hasRequiredFields || !hasValidLengths) {
    return {
      ok: false,
      error: {
        code: 'INVALID_METADATA',
        message: '请填写标题、图片说明和分类，并检查文字长度。',
      },
    };
  }

  return { ok: true, value };
}

function invalidUrl(message: string): ValidationResult<string> {
  return { ok: false, error: { code: 'UNSAFE_PAGE_URL', message } };
}
