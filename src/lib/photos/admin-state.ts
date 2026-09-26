import type {
  PhotoMetadataInput,
  PhotoOrientation,
  PhotoRecord,
  PhotoSourceType,
} from './contracts';
import { validatePhotoMetadata } from './validation';

export interface PhotoDatabaseRow {
  id: string;
  owner_id: string;
  title: string;
  summary: string;
  alt_text: string;
  category: string;
  tags: string[];
  storage_path: string;
  source_type: PhotoSourceType;
  source_page_url: string | null;
  source_image_url: string | null;
  orientation: PhotoOrientation;
  is_featured: boolean;
  is_reserved: boolean;
  is_published: boolean;
  sort_order: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PhotoEditableValues extends PhotoMetadataInput {
  orientation: PhotoOrientation;
  isFeatured: boolean;
  isReserved: boolean;
  isPublished: boolean;
  sortOrder: number;
  publishedAt: string | null;
}

export interface PhotoDatabaseUpdate {
  title: string;
  summary: string;
  alt_text: string;
  category: string;
  tags: string[];
  orientation: PhotoOrientation;
  is_featured: boolean;
  is_reserved: boolean;
  is_published: boolean;
  sort_order: number;
  published_at: string | null;
}

export interface PhotoCapacitySummary {
  total: number;
  reserved: number;
  drafts: number;
  available: number;
  nextEvictionCandidate: PhotoRecord | null;
}

export function mapPhotoRow(row: PhotoDatabaseRow): PhotoRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    summary: row.summary,
    altText: row.alt_text,
    category: row.category,
    tags: row.tags,
    storagePath: row.storage_path,
    sourceType: row.source_type,
    sourcePageUrl: row.source_page_url,
    sourceImageUrl: row.source_image_url,
    orientation: row.orientation,
    isFeatured: row.is_featured,
    isReserved: row.is_reserved,
    isPublished: row.is_published,
    sortOrder: row.sort_order,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function buildPhotoUpdate(
  values: PhotoEditableValues,
  now = new Date().toISOString(),
): PhotoDatabaseUpdate {
  const metadata = validatePhotoMetadata(values);

  if (!metadata.ok) {
    throw new Error(metadata.error.message);
  }

  return {
    title: metadata.value.title,
    summary: metadata.value.summary,
    alt_text: metadata.value.altText,
    category: metadata.value.category,
    tags: metadata.value.tags,
    orientation: values.orientation,
    is_featured: values.isFeatured,
    is_reserved: values.isReserved,
    is_published: values.isPublished,
    sort_order: Number.isFinite(values.sortOrder) ? Math.trunc(values.sortOrder) : 0,
    published_at: values.isPublished ? (values.publishedAt ?? now) : values.publishedAt,
  };
}

export function canConfirmPhotoDeletion(input: string, title: string): boolean {
  return input.trim() === title;
}

export function getPhotoCapacitySummary(
  photos: PhotoRecord[],
): PhotoCapacitySummary {
  const candidates = photos
    .filter((photo) => !photo.isReserved)
    .sort((left, right) => (
      left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id)
    ));

  return {
    total: photos.length,
    reserved: photos.filter((photo) => photo.isReserved).length,
    drafts: photos.filter((photo) => !photo.isPublished).length,
    available: Math.max(0, 100 - photos.length),
    nextEvictionCandidate: candidates[0] ?? null,
  };
}
