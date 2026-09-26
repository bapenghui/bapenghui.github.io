# Editable Photo Library Checklist

## Task 1: Shared contracts and validation

- [x] 固定 Supabase 浏览器客户端版本并提供无秘密的 `.env.example`。
- [x] 定义图片、候选、保存和错误契约。
- [x] 先写失败测试，再实现文件、元数据和 HTTPS URL 校验。
- [x] Verify: `pnpm test -- src/lib/photos/validation.test.ts && pnpm test && pnpm build`
- Dependencies: none
- Files: `package.json`, `pnpm-lock.yaml`, `.env.example`, `src/lib/photos/contracts.ts`, `src/lib/photos/validation.test.ts`

## Task 2: Database, RLS and retention

- [ ] 建立 `photo_admins`、`photos`、Storage bucket 与最小权限策略。
- [ ] 实现原子的 `insert_photo_with_retention`，严格限制 100 张且不覆盖保留图片。
- [ ] 测试匿名/管理员权限、99/100/101、全部保留和并发写入。
- [ ] Verify: pinned Supabase database tests; `pnpm test && pnpm build`
- Dependencies: Task 1
- Files: `supabase/config.toml`, one migration, two SQL test files

## Checkpoint A: Storage foundation

- [ ] Tasks 1–2 分别提交且构建通过。
- [ ] 权限和容量规则有自动化证据。
- [ ] 仓库中没有秘密。

## Task 3: Link development Supabase project

- [ ] 创建/选择项目、连接 CLI、应用迁移并建立唯一管理员。
- [ ] 验证匿名可读已发布内容、匿名不可写、管理员可写。
- [ ] 公共配置与服务端秘密分离。
- [ ] Verify: remote smoke checks and clean secret scan
- Dependencies: Task 2 and user Supabase login

## Task 4: Authenticated admin shell

- [ ] 添加登录、会话状态、图片列表和元数据编辑。
- [ ] 支持保留、发布、排序和带名称确认的手动删除。
- [ ] 验证匿名用户看不到草稿且无法调用写操作。
- [ ] Verify: focused tests, keyboard/a11y browser check, `pnpm test && pnpm build`
- Dependencies: Task 3
- Files: admin page, admin list component, admin client, admin styles, tests

## Task 5: Local upload and finalization

- [ ] 支持拖拽和文件选择、预览、staging 与确认保存。
- [ ] 拒绝伪造、超限或不支持的文件，并在容量满时预告替换对象。
- [ ] 幂等重试不重复创建；失败执行补偿清理。
- [ ] Verify: validation/function tests and browser upload flow
- Dependencies: Task 4
- Files: upload component/client/tests, finalize function, shared function security

## Task 6: Secure web image extraction

- [ ] 公开 HTTPS 页面最多返回 50 个去重候选，不自动保存。
- [ ] 拒绝危险地址、重定向滥用、超时、超大响应和非图片内容。
- [ ] 选中图片通过 Task 5 的容量与入库流程保存。
- [ ] Verify: parser/security/function tests and browser import flow
- Dependencies: Task 5
- Files: import component, candidate parser/tests, extraction function/tests

## Checkpoint B: Administrator workflows

- [ ] 登录、本地上传、网页导入、保留与发布端到端通过。
- [ ] 匿名 API 写入全部失败。
- [ ] 容量警告与实际替换记录一致。

## Task 7: Public gallery redesign

- [ ] 只显示 Supabase 中已发布的图片，并处理加载、空、失败和重试状态。
- [ ] 加入编辑型网格、分类筛选和键盘可用灯箱。
- [ ] 320、768、1024、1440 px 无横向溢出。
- [ ] Verify: gallery tests, accessibility tree, screenshots and clean console
- Dependencies: Task 3
- Files: photo page, gallery component/client/tests, gallery styles

## Task 8: Migrate samples and update home preview

- [ ] 幂等迁移四条现有记录且不重复。
- [ ] 首页显示最新的精选已发布图片并处理网络失败。
- [ ] 项目和写作集合不受影响；旧图片集合仅在验证后退役。
- [ ] Verify: seed idempotency, home/gallery browser checks, `pnpm test && pnpm build`
- Dependencies: Tasks 3 and 7

## Checkpoint C: Public experience

- [ ] 公开页面只显示已发布内容。
- [ ] 加载/失败时首页与图库仍可理解和操作。
- [ ] 现有项目、写作和现在页面无回归。

## Task 9: Configure and release

- [ ] 部署数据库、Functions 和 GitHub Pages 资源。
- [ ] 线上上传、采集与公开图库正常且不暴露特权凭据。
- [ ] 本地、远端与 `main` 同步，无未提交文件。
- [ ] Verify: complete unit/database/function/build/browser/security gates
- Dependencies: Tasks 1–8

## Final Checkpoint

- [ ] `SPEC-photo-library.md` 的全部成功标准已满足。
- [ ] 无跳过测试、无秘密、无临时上传或构建产物进入 Git。
- [ ] 线上网站可由管理员编辑并由公众正常浏览。
