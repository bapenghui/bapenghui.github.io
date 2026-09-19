# Implementation Plan: Bapenghui Personal Site

## Overview

构建一个可长期维护的内容型个人站，首版包含总览、项目、写作、图片和现在五个栏目。

## Architecture Decisions

- 使用 Astro 静态生成与严格 TypeScript，适配 GitHub Pages。
- 项目、文章、图片使用独立内容集合，共享少量基础元数据。
- 首版不引入登录、数据库或在线后台。
- 先用真实感示例内容完成布局，后续替换为用户的正式内容。

## Delivery Order

1. 建立可构建的 Astro 基础项目。
2. 建立视觉系统与共享页面框架。
3. 打通项目列表和详情页。
4. 增加写作、图片和现在页面。
5. 完成首页聚合、部署与浏览器验收。

## Risks

- 正式文案和真实图片尚未提供，首版内容必须清楚标记为可替换示例。
- GitHub Pages 首次启用可能需要在仓库设置中确认发布来源为 GitHub Actions。
