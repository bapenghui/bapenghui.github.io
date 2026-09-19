# Bapenghui

个人综合网站，使用 Astro、TypeScript 和 Markdown 构建，部署目标为 GitHub Pages。

## 本地开发

```bash
source ~/.nvm/nvm.sh
nvm use
pnpm install
pnpm dev
```

## 质量检查

```bash
pnpm test
pnpm build
```

## 内容目录

```text
src/content/projects/  项目记录
src/content/writing/   文章
src/content/photos/    图片元数据
public/images/         网页使用的压缩图片
```

当前仓库包含少量标记为“内容样例”或“示例视觉”的占位内容。发布前可直接替换对应 Markdown、YAML 和图片文件。

## 部署

推送到 `main` 后，GitHub Actions 会构建并发布到 `https://bapenghui.github.io`。首次部署前，需要在仓库的 Pages 设置中选择 **GitHub Actions** 作为来源。
