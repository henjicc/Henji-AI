import type { ProjectCardGridItem } from '@/components/ProjectCardGrid';

/** 项目库页头的排序档：最近编辑（默认，与存储顺序一致）/ 最近创建 / 名称。 */
export type ProjectLibrarySort = 'updated' | 'created' | 'name';

export const PROJECT_LIBRARY_SORT_ORDER: readonly ProjectLibrarySort[] = ['updated', 'created', 'name'];

function compareItems(sort: ProjectLibrarySort): (a: ProjectCardGridItem, b: ProjectCardGridItem) => number {
  if (sort === 'name') return (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const key = sort === 'created' ? 'createdAt' : 'updatedAt';
  // 没有时间戳的项排在最后，彼此保持原顺序（Array.prototype.sort 稳定）
  return (a, b) => (b[key] ?? Number.NEGATIVE_INFINITY) - (a[key] ?? Number.NEGATIVE_INFINITY);
}

/** 按名称关键字筛选（忽略大小写与首尾空白）后排序；只改变本页显示顺序，不改数据。 */
export function arrangeProjectItems(items: ProjectCardGridItem[], query: string, sort: ProjectLibrarySort): ProjectCardGridItem[] {
  const keyword = query.trim().toLocaleLowerCase();
  const filtered = keyword ? items.filter((item) => item.name.toLocaleLowerCase().includes(keyword)) : items;
  return [...filtered].sort(compareItems(sort));
}
