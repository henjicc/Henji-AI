import { describe, expect, it } from 'vitest';
import type { ProjectCardGridItem } from '@/components/ProjectCardGrid';
import { arrangeProjectItems } from './projectLibraryArrange';

const item = (id: string, name: string, updatedAt?: number, createdAt?: number): ProjectCardGridItem => ({
  id, name, metaLine: '', updatedAt, createdAt,
});

const items = [
  item('a', '分镜 10', 300, 100),
  item('b', 'Banner', 100, 300),
  item('c', '分镜 2', 200, 200),
  item('d', '无时间'),
];

describe('arrangeProjectItems', () => {
  it('默认按最近编辑倒序，没有时间戳的排最后', () => {
    expect(arrangeProjectItems(items, '', 'updated').map((entry) => entry.id)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('按最近创建倒序', () => {
    expect(arrangeProjectItems(items, '', 'created').map((entry) => entry.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('按名称排序时数字按数值比较', () => {
    const names = arrangeProjectItems(items, '', 'name').map((entry) => entry.name);
    expect(names.indexOf('分镜 2')).toBeLessThan(names.indexOf('分镜 10'));
  });

  it('搜索忽略大小写与首尾空白，且不改原数组', () => {
    const source = [...items];
    expect(arrangeProjectItems(source, '  banner ', 'updated').map((entry) => entry.id)).toEqual(['b']);
    expect(arrangeProjectItems(source, '分镜', 'updated').map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(source).toEqual(items);
  });
});
