# Implementation Plan: 可编辑图片库

## Overview

在保留 Astro 与 GitHub Pages 的前提下，将图片栏目改造成 Supabase 驱动的动态图片库。公开页面只读；唯一管理员通过 `/admin/photos/` 登录后，可以本地上传、从公开网页提取候选图片、编辑元数据、设置保留状态并发布。服务端严格执行 100 张上限，超过时只替换最早的非保留图片。

规格来源：`SPEC-photo-library.md`。

## Detected Environment

- Astro 7.3.3、TypeScript、pnpm 12.4.2、Node.js 24。
- 当前发布目标为 GitHub Pages，图片数据来自 `src/content/photos/*.yaml`。
- Ubuntu 22.04 当前未安装 Docker 或 Supabase CLI。
- 旧计划的全部任务已经完成，因此本计划可以安全替换旧文件。

## Architecture Decisions

- GitHub Pages 继续托管页面；浏览器使用 Supabase publishable key 读取已发布数据。
- Supabase Auth、数据库 RLS 与 Storage RLS 是权限边界，界面隐藏不作为安全控制。
- 本地文件先进入管理员专属 staging 路径，确认后由 Edge Function 完成容量事务和正式入库。
- 网页采集只返回候选图片，必须由管理员选择后才保存。
- 容量由数据库 RPC 串行化执行，避免并发写入突破 100 张。
- 新图片默认不保留；只有显式设置 `is_reserved = true` 才免于自动替换。
- 公开图库继续使用轻量 Astro 与 TypeScript，不引入额外 UI 框架。

## Dependency Graph

```text
共享契约与校验
      ↓
数据库、RLS、Storage 与容量事务
      ↓
管理员认证
  ┌───┴────────┐
  ↓            ↓
本地上传     公开图库
  ↓
网页采集
  └─────┬──────┘
        ↓
示例迁移与首页预览
        ↓
部署及端到端验收
```

## Delivery Phases

### Phase 1: Foundation

1. 添加固定版本的 Supabase 客户端、环境配置、图片契约和纯校验测试。
2. 添加数据库结构、RLS、Storage 策略、100 张容量 RPC 与数据库测试。
3. 创建或连接 Supabase 项目，建立唯一管理员并验证远端权限。

Checkpoint: 99/100/101、全部保留、匿名写入拒绝和管理员写入均有可执行证据。

### Phase 2: Administrator workflows

4. 添加 `/admin/photos/` 登录、图片列表、编辑、保留、发布与删除。
5. 添加本地上传、替换预览和幂等入库流程。
6. 添加受限网页抓取、候选预览和选中图片导入。

Checkpoint: 管理员可以完成登录、上传、网页导入、保留与发布；匿名调用失败。

### Phase 3: Public experience

7. 美化公开图片页，加入动态数据、筛选、灯箱和完整状态处理。
8. 迁移四条现有记录，并将首页图片预览切换到动态数据。

Checkpoint: 公开访问者只看到已发布内容；320、768、1024、1440 px 均通过浏览器验收。

### Phase 4: Release

9. 配置环境、部署函数与前端，完成安全、测试、构建及线上验收。

## Increment and Commit Strategy

- Commit 1: 规格与实施计划。
- Commit 2: 共享契约、校验与 Supabase 客户端配置。
- Commit 3: 数据库、RLS、Storage 策略与容量测试。
- Commit 4: 管理员界面。
- Commit 5: 本地上传。
- Commit 6: 网页采集。
- Commit 7: 公开图库。
- Commit 8: 数据迁移与首页集成。
- Commit 9: 部署配置及必要的发布修复。

每个提交都必须保持 `pnpm test` 与 `pnpm build` 通过。

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| 任意 URL 抓取带来 SSRF | High | 仅管理员、HTTPS、拒绝内网/保留地址、重定向复验、超时和大小限制 |
| Storage 删除不能与数据库共享事务 | Medium | 元数据原子提交，Storage API 补偿清理并记录失败路径 |
| 并发上传突破 100 张 | High | RPC 内事务锁，增加并发测试 |
| GitHub Pages 无服务端运行时 | Medium | 所有特权逻辑位于 Supabase Edge Functions |
| 远端项目创建需要用户账户交互 | Medium | 先完成仓库脚手架，只在登录授权步骤暂停 |
| 本机缺少 Docker | Medium | 固定 CLI 版本，优先使用已连接的开发项目运行集成验证 |
| 网页图片存在版权问题 | Medium | 手动勾选、保留来源并提示确认使用权限 |

## Verification

- Vitest 覆盖校验、候选解析、列表和状态逻辑。
- 数据库测试覆盖 grants/RLS、容量、保留和并发。
- 函数测试覆盖 URL、重定向、超时、响应大小、文件签名和幂等。
- 浏览器检查登录、上传、导入、筛选、灯箱、键盘、响应式和干净控制台。
- 发布前执行 `pnpm test && pnpm check && pnpm build`、秘密扫描和线上网络检查。

## External Setup

- 创建或选择 Supabase 项目。
- 创建管理员账号并加入 `photo_admins`。
- GitHub Pages 只配置公开 Supabase URL 与 publishable key。
- secret/service key 只配置在 Supabase Functions 中，不进入聊天或 Git。

## Open Questions

仓库脚手架没有阻塞问题。到 Phase 1 Task 3 时，需要用户在 Supabase 页面完成一次登录授权。
