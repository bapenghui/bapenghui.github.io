export type PhotoOrientation = 'landscape' | 'portrait' | 'square';
export type PhotoSourceType = 'local' | 'web' | 'migrated';

export interface PhotoMetadataInput {
  title: string;
  summary: string;
  altText: string;
  category: string;
  tags: string[];
}

export interface PhotoRecord extends PhotoMetadataInput {
  id: string;
  ownerId: string;
  storagePath: string;
  sourceType: PhotoSourceType;
  sourcePageUrl: string | null;
  sourceImageUrl: string | null;
  orientation: PhotoOrientation;
  isFeatured: boolean;
  isReserved: boolean;
  isPublished: boolean;
  sortOrder: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PhotoCandidate {
  imageUrl: string;
  altText: string;
  width: number | null;
  height: number | null;
}

export interface ExtractPhotoCandidatesInput {
  pageUrl: string;
}

export interface ExtractPhotoCandidatesOutput {
  pageUrl: string;
  candidates: PhotoCandidate[];
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiResult<T> = { data: T } | { error: ApiError };

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ApiError };

export interface LocalPhotoDescriptor {
  name: string;
  size: number;
  type: string;
}
