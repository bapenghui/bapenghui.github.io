export type Visibility = 'public' | 'private';

export interface PublishState {
  draft?: boolean;
  visibility?: Visibility;
}

export function isPublicEntry(state: PublishState): boolean {
  return state.draft !== true && state.visibility !== 'private';
}

export function sortByUpdatedDesc<T extends { data: { updatedAt: Date } }>(entries: readonly T[]): T[] {
  return [...entries].sort((left, right) => right.data.updatedAt.getTime() - left.data.updatedAt.getTime());
}

const chineseDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Shanghai',
});

export function formatDate(date: Date): string {
  return chineseDateFormatter.format(date);
}
