# Spec: 可编辑图片库

## Objective

把现有静态图片页升级为个人可维护的图片库，同时保留公开页面的快速访问体验。

唯一管理员可以：

- 使用邮箱和密码登录图片管理界面。
- 从本地上传图片。
- 输入公开网页地址，提取候选图片，勾选后保存。
- 编辑标题、说明、替代文本、分类、标签、展示顺序和发布状态。
- 将重要图片标记为“保留”，防止容量整理时被自动覆盖。

公开访问者只能浏览已发布图片，不能看到上传、采集和编辑入口。

## Approved Capability Map

| Module id | Responsibility | Depends on |
|---|---|---|
| `photo-storage` | 数据表、对象存储、权限、100 张容量与保留规则 | — |
| `photo-ingestion` | 网页图片候选提取、本地上传、格式与地址校验 | `photo-storage` |
| `photo-admin` | 管理员登录、上传、采集、编辑、保留与发布界面 | `photo-storage`, `photo-ingestion` |
| `photo-gallery` | 公开图片页、美化布局、筛选、查看大图和动态读取 | `photo-storage` |

Build order: `photo-storage` → `photo-ingestion` → `photo-admin` → `photo-gallery`.

## Tech Stack

- Astro 7.3.3、TypeScript、pnpm 12.4.2。
- Supabase Auth：管理员邮箱密码登录。
- Supabase Postgres：图片元数据与容量规则。
- Supabase Storage：公开展示图片和仅管理员可写的临时上传区。
- Supabase Edge Functions：网页候选提取和图片入库编排。
- GitHub Pages：继续托管 Astro 前端；图片数据在浏览器中从 Supabase 动态读取。

新增依赖必须在安装时固定版本并提交锁文件。浏览器只使用 Supabase publishable key；service/secret key 只允许存在于 Supabase Functions 的服务端环境中。

## User Flows

### Public gallery

1. 访问 `/photos/`。
2. 页面读取 `is_published = true` 的图片。
3. 使用响应式编辑型网格展示，并支持分类筛选和点击查看大图。
4. 加载失败时显示明确的重试状态；无数据时显示空状态。

### Local upload

1. 管理员访问 `/admin/photos/` 并登录。
2. 点击“本地上传”或拖入图片。
3. 客户端先验证数量、格式和大小并展示预览。
4. 文件上传到管理员专属临时路径。
5. 管理员补充元数据后确认保存。
6. Edge Function 执行容量事务、正式入库并清理临时对象。

### Web import

1. 管理员点击“从网页采集”，输入一个公开 HTTPS 页面地址。
2. Edge Function 验证地址、获取受限大小的 HTML，并返回去重后的图片候选。
3. 管理员勾选候选图片、补充元数据并确认保存。
4. Edge Function 重新验证每个图片地址、下载允许的图片类型并保存到 Storage。
5. 每张图片通过同一容量事务入库。

## Data Model

### `photo_admins`

- `user_id uuid primary key references auth.users(id)`
- `created_at timestamptz not null default now()`

只有表内用户可以执行图片写操作和调用受保护的 Edge Functions。

### `photos`

- `id uuid primary key`
- `owner_id uuid not null references auth.users(id)`
- `title text not null`
- `summary text not null default ''`
- `alt_text text not null`
- `category text not null default '未分类'`
- `tags text[] not null default '{}'`
- `storage_path text not null unique`
- `source_type text not null check in ('local', 'web', 'migrated')`
- `source_page_url text null`
- `source_image_url text null`
- `orientation text not null check in ('landscape', 'portrait', 'square')`
- `is_featured boolean not null default false`
- `is_reserved boolean not null default false`
- `is_published boolean not null default true`
- `sort_order integer not null default 0`
- `published_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Public queries receive only the fields required for display and only rows where `is_published = true`. Write policies require both an authenticated user and membership in `photo_admins`.

## Capacity Contract

The hard limit is 100 rows in `photos`, including drafts and published photos. Temporary uploads and unsaved web candidates do not count.

When saving a photo:

1. Lock the capacity operation so concurrent saves cannot exceed 100 rows.
2. If the current count is below 100, insert normally.
3. If the count is 100, select the oldest row where `is_reserved = false`, ordered by `created_at asc, id asc`.
4. Delete that metadata row and insert the new photo in the same database transaction.
5. Return the evicted `storage_path` to the Edge Function, which removes the old object through the Storage API.
6. If every existing row is reserved, reject the save with `PHOTO_CAPACITY_RESERVED`; never remove a reserved photo.
7. If the transaction fails after a new object was uploaded, remove the new object as compensation.
8. If old-object cleanup fails after the transaction, the photo remains absent from the gallery and the orphan path is logged for retry; metadata capacity remains correct.

For a batch, the admin UI shows the number and titles of unreserved photos that will be replaced before confirmation. A batch cannot contain more new photos than the total non-reserved capacity available.

Manual deletion of a reserved photo remains possible but requires an explicit confirmation dialog naming the photo.

## API Contracts

All responses use either `{ data: ... }` or `{ error: { code, message, details? } }`.

### `POST /functions/v1/extract-photo-candidates`

Authenticated admin only.

Input:

```ts
interface ExtractPhotoCandidatesInput {
  pageUrl: string;
}
```

Output:

```ts
interface PhotoCandidate {
  imageUrl: string;
  altText: string;
  width: number | null;
  height: number | null;
}

interface ExtractPhotoCandidatesOutput {
  pageUrl: string;
  candidates: PhotoCandidate[];
}
```

The result is capped at 50 deduplicated candidates and does not save anything.

### `POST /functions/v1/finalize-photo`

Authenticated admin only. Accepts one local staging path or one validated remote image URL plus metadata. Uses an `Idempotency-Key` so retries cannot create duplicate records. Returns the created photo and optional evicted photo metadata.

### Database RPC: `insert_photo_with_retention`

Server-only transaction boundary. It accepts validated metadata, enforces the 100-row rule, never evicts `is_reserved = true`, and returns the inserted row plus an optional evicted `storage_path`.

## Validation and Security

### Trust boundaries

- Login input, metadata fields, local files, page URLs, fetched HTML and remote images are untrusted.
- Publishable keys are public configuration, not secrets.
- Supabase secret/service credentials never enter browser bundles or GitHub commits.

### Local files

- Allowed MIME types: JPEG, PNG, WebP and AVIF.
- SVG and HTML are rejected.
- Maximum file size: 10 MiB per image.
- File signature is checked server-side; extension and browser-provided MIME type are not trusted.
- Object names use generated UUIDs, never original filenames as paths.

### Web fetching

- Accept HTTPS only.
- Reject credentials in URLs, IP-literal hosts, localhost names, `.local` names and private/reserved network destinations.
- Revalidate every redirect target; maximum three redirects.
- HTML timeout: 8 seconds; HTML response limit: 2 MiB.
- Remote image timeout: 10 seconds; image response limit: 10 MiB.
- Require an image content type and verify the downloaded file signature.
- Do not execute fetched scripts or render fetched HTML.
- Preserve the source page URL for attribution.
- The interface states that the administrator must have permission to reuse imported images.

The endpoint is admin-only, rate-limited and returns generic errors without internal stack traces. These controls reduce SSRF exposure; arbitrary public-site importing cannot be treated as a zero-risk server fetch.

## UI Requirements

### Public page

- Replace the oversized intro and sparse two-column layout with a compact editorial header and an intentional mixed-aspect gallery.
- Preserve the existing cream, ink, orange and yellow design language.
- Use real content hierarchy rather than uniform generic cards.
- Provide category filters, image count, lightbox, keyboard navigation and visible focus states.
- Responsive targets: 320 px, 768 px, 1024 px and 1440 px.

### Admin page

- Upload and web-import actions are visible only after authentication.
- Drag-and-drop is supplemented by a normal file input and keyboard-operable buttons.
- Every operation has idle, loading, success, validation-error and service-error states.
- “保留” status uses an icon and text, not color alone.
- Before capacity replacement, show the affected photo names and require confirmation.

## Migration

The four existing YAML photo records are imported once with `source_type = 'migrated'`. Existing SVG sample images may remain until real images replace them. After Supabase-backed rendering is verified, the photo page stops using the Astro content collection as its runtime source; project and writing collections are unchanged.

## Commands

Current repository commands:

```bash
pnpm test
pnpm check
pnpm build
pnpm dev
```

Supabase commands will be added after the project is initialized and the CLI version is pinned. Database policy tests must run with the repository's pinned Supabase CLI command rather than a global installation.

## Project Structure

```text
src/pages/photos/index.astro          public gallery shell
src/pages/admin/photos/index.astro    authenticated management shell
src/components/photos/                gallery, uploader, importer and editor UI
src/lib/photos/                       browser contracts and validation
supabase/migrations/                  tables, functions, grants and RLS policies
supabase/functions/                   extraction and finalization endpoints
supabase/tests/                       capacity and RLS database tests
```

## Testing Strategy

- Vitest unit tests: client validation, candidate normalization and retention-related pure logic.
- Database tests: anonymous/public read rules, admin write rules, 99/100/101 capacity cases, reserved eviction protection and concurrent inserts.
- Function tests: invalid URLs, redirect validation, private address rejection, response limits, MIME/signature mismatch, idempotent retry and cleanup failure.
- Browser verification: login states, local preview, web-candidate selection, replacement warning, category filter, lightbox, keyboard flow and responsive screenshots.
- Full repository gate: `pnpm test && pnpm build`, database tests, function tests and a clean browser console.

## Boundaries

### Always

- Validate every input at the browser and server boundary.
- Enforce authorization and capacity on the server; client checks are advisory only.
- Use RLS and least-privilege grants on every exposed table and storage path.
- Keep replacement deterministic and never auto-delete reserved photos.
- Use Storage APIs for object deletion rather than editing Storage metadata tables directly.

### Ask first

- Increasing the 100-photo limit or 10 MiB file limit.
- Allowing additional file types.
- Adding another administrator.
- Changing the automatic replacement order.
- Migrating hosting away from GitHub Pages.

### Never

- Commit Supabase secret/service keys.
- Expose upload or extraction endpoints to anonymous users.
- Fetch HTTP, localhost, private-network or metadata-service URLs.
- Render fetched HTML or trust remote MIME headers without signature validation.
- Auto-delete an `is_reserved = true` photo.

## Success Criteria

- The public photo page is visually improved and reads published records from Supabase.
- An anonymous visitor cannot upload, import, edit, reserve or delete photos.
- The configured administrator can upload a valid local image and publish it.
- The administrator can extract candidates from a valid public HTTPS page, select one and publish it.
- Invalid file types, files over 10 MiB and unsafe URLs are rejected with useful messages.
- Saving the 101st photo replaces exactly the oldest non-reserved photo.
- Reserved photos survive automatic replacement.
- When all 100 photos are reserved, a new save fails without deleting or partially inserting data.
- The four existing photo records are migrated without breaking the home-page photo preview.
- Unit, database, function, build and browser checks pass with no console errors.

## Open Questions / External Setup

- A Supabase project must be created or selected before deployment.
- The administrator account must be created and its user id inserted into `photo_admins`.
- GitHub Pages repository variables must receive the public Supabase URL and publishable key.
- Supabase server secrets are configured in Supabase only and are never requested in chat or committed.

## Official Sources

- Supabase Auth: https://supabase.com/docs/guides/auth
- Supabase password auth: https://supabase.com/docs/guides/auth/passwords
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Storage access control: https://supabase.com/docs/guides/storage/security/access-control
- Supabase Storage buckets and upload restrictions: https://supabase.com/docs/guides/storage/buckets/fundamentals
- Supabase Storage schema guidance: https://supabase.com/docs/guides/storage/schema/design
- Supabase Edge Functions: https://supabase.com/docs/guides/functions
- Supabase Edge Function browser invocation and CORS: https://supabase.com/docs/guides/functions/cors
- Astro client-side scripts: https://docs.astro.build/en/guides/client-side-scripts/
