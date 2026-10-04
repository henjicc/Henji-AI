/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectLibraryPage, type ProjectLibraryLabels } from './ProjectLibraryPage';
import type { ProjectCardGridItem } from './ProjectCardGrid';

const labels: ProjectLibraryLabels = {
  createAction: '新建项目',
  count: (count) => `${count} 个项目`,
  searchPlaceholder: '搜索项目',
  noResults: '没有符合条件的项目',
  sortLabel: '排序',
  sortOptions: { updated: '最近编辑', created: '最近创建', name: '名称' },
  createDialogTitle: '新建项目',
  renameDialogTitle: '重命名项目',
  emptyTitle: '暂无项目',
  emptyDescription: '创建第一个项目',
  deleteTitle: '删除项目',
  deleteConfirmSingle: (name) => `删除 ${name}`,
  deleteConfirmMultiple: (count) => `删除 ${count} 个`,
  confirmDelete: '删除',
  cancel: '取消',
  card: { open: '打开项目', rename: '重命名', delete: '删除项目', selectMultiple: '多选', selectItem: '选中', deselectItem: '取消选中', more: '项目操作' },
  selection: { selectedCount: (count) => `已选择 ${count} 项`, selectAll: '全选', deselectAll: '取消全选', deleteSelected: '删除所选', cancel: '取消' },
};

const items: ProjectCardGridItem[] = [
  { id: 'p1', name: '江南雨夜', metaLine: '18 个节点', updatedAt: 2, createdAt: 1 },
  { id: 'p2', name: '产品主图', metaLine: '6 个节点', updatedAt: 1, createdAt: 2 },
];

const renderPage = (pageItems: ProjectCardGridItem[] = items, onOpen = vi.fn()) => render(
  <ProjectLibraryPage
    title="项目管理"
    items={pageItems}
    labels={labels}
    headerActions={<span>导入</span>}
    onOpen={onOpen}
    onCreate={vi.fn()}
    onRename={vi.fn()}
    onDelete={vi.fn()}
  />,
);

const visibleProjectIds = (): string[] => Array.from(document.querySelectorAll('[data-project-id]')).map((element) => element.getAttribute('data-project-id') ?? '');

describe('ProjectLibraryPage', () => {
  afterEach(cleanup);

  it('页头一条：标题旁数量，新建是唯一主按钮，网格里不再有新建卡片', () => {
    renderPage();
    expect(screen.getByText('2 个项目')).toBeTruthy();
    const primaries = document.querySelectorAll('[data-variant="primary"]');
    expect(primaries).toHaveLength(1);
    expect(primaries[0].textContent).toBe('新建项目');
    expect(screen.getAllByRole('button', { name: '新建项目' })).toHaveLength(1);
    expect(visibleProjectIds()).toEqual(['p1', 'p2']);
  });

  it('长名称截断后悬停名称可看全名', () => {
    const longName = '分镜 10 用来检查截断效果的一个非常非常长的项目名称';
    renderPage([{ id: 'long', name: longName, metaLine: '0 个节点' }]);
    expect(screen.getByText(longName).getAttribute('title')).toBe(longName);
  });

  it('空状态不再放第二个新建按钮，也不显示搜索与排序', () => {
    renderPage([]);
    expect(screen.getByText('暂无项目')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '新建项目' })).toHaveLength(1);
    expect(screen.queryByRole('textbox', { name: '搜索项目' })).toBeNull();
  });

  it('搜索只筛选本页显示，没有命中时显示无结果', () => {
    renderPage();
    const search = screen.getByRole('textbox', { name: '搜索项目' });
    fireEvent.change(search, { target: { value: '产品' } });
    expect(visibleProjectIds()).toEqual(['p2']);
    fireEvent.change(search, { target: { value: '不存在' } });
    expect(screen.getByText('没有符合条件的项目')).toBeTruthy();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(visibleProjectIds()).toEqual(['p1', 'p2']);
  });

  it('卡片点击打开项目，悬停“更多”打开与右键相同的菜单', () => {
    const onOpen = vi.fn();
    renderPage(items, onOpen);
    fireEvent.click(document.querySelector('[data-project-id="p1"]')!);
    expect(onOpen).toHaveBeenCalledWith(items[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '项目操作' })[0]);
    const menu = document.querySelector('[data-context-menu]') as HTMLElement;
    expect(within(menu).getByText('重命名')).toBeTruthy();
    expect(within(menu).getByText('删除项目')).toBeTruthy();
  });

  it('多选删除确认后退出多选，页头回到常规动作', async () => {
    const onDelete = vi.fn();
    render(
      <ProjectLibraryPage title="项目管理" items={items} labels={labels} onOpen={vi.fn()} onCreate={vi.fn()} onRename={vi.fn()} onDelete={onDelete} />,
    );
    fireEvent.contextMenu(document.querySelector('[data-project-id="p1"]')!);
    fireEvent.click(within(document.querySelector('[data-context-menu]') as HTMLElement).getByText('多选'));
    fireEvent.click(await screen.findByRole('button', { name: '全选' }));
    fireEvent.click(screen.getByRole('button', { name: '删除所选' }));
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByText(/已选择/)).toBeNull());
    expect(screen.getByRole('button', { name: '新建项目' })).toBeTruthy();
  });

  it('多选时命令带换成多选工具条，删除为危险档且没有主按钮', async () => {
    renderPage();
    fireEvent.contextMenu(document.querySelector('[data-project-id="p2"]')!);
    fireEvent.click(within(document.querySelector('[data-context-menu]') as HTMLElement).getByText('多选'));
    expect(await screen.findByText('已选择 1 项')).toBeTruthy();
    expect(document.querySelector('[data-project-id="p2"]')?.getAttribute('data-selected')).toBe('true');
    expect(screen.getByRole('button', { name: '删除所选' }).getAttribute('data-variant')).toBe('danger');
    expect(document.querySelectorAll('[data-variant="primary"]')).toHaveLength(0);
  });
});
