export const SITE = {
  name: 'Bapenghui',
  title: 'Bapenghui · 个人数字空间',
  description: '记录技术、项目、写作，以及正在发生的事情。',
  url: 'https://bapenghui.github.io',
} as const;

export const NAV_ITEMS = [
  { href: '/', label: '总览' },
  { href: '/projects/', label: '项目' },
  { href: '/writing/', label: '写作' },
  { href: '/photos/', label: '图片' },
  { href: '/now/', label: '现在' },
] as const;
