/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ClipboardPaste, FilePlus2, FolderOpen, PackageOpen } from 'lucide-react';
import { ProjectLibraryPage, type ProjectLibraryLabels } from './ProjectLibraryPage';
import type { ProjectCardGridItem } from './ProjectCardGrid';

const labels: ProjectLibraryLabels = {
  createAction: '新建项目',
  count: (count) => `${count} 个项目`,
  searchPlaceholder: '搜索项目',
  noResults: '没有符合条件的项目',
  sortLabel: '排序',
  sortOptions: { updated: '最近编辑', created: '最近创建', name: '名称' },
  nav: { all: '全部', recent: '最近打开', drafts: '未保存草稿' },
  recentEmpty: '还没有打开过',
  view: { grid: '网格视图', list: '列表视图' },
  columns: { name: '名称', location: '所属项目', modified: '修改时间', created: '创建时间', size: '大小' },
  dropHint: '可以把文件拖到这里。',
  createDialogTitle: '新建项目',
  renameDialogTitle: '重命名项目',
  emptyTitle: '暂无项目',
  emptyDescription: '创建第一个项目',
  deleteTitle: '删除项目',
  deleteConfirmSingle: (name) => `删除 ${name}`,
  deleteConfirmMultiple: (count) => `删除 ${count} 个`,
  confirmDelete: '删除',
  cancel: '取消',
  card: {
    open: '打开项目', rename: '重命名', delete: '删除项目', selectMultiple: '多选', selectItem: '选中', deselectItem: '取消选中', more: '项目操作',
    draft: { marker: '草稿', open: '继续编辑', discard: '移到回收站' },
  },
  selection: { selectedCount: (count) => `已选择 ${count} 项`, selectAll: '全选', deselectAll: '取消全选', deleteSelected: '删除所选', cancel: '取消' },
};

const items: ProjectCardGridItem[] = [
  { id: 'p1', name: '江南雨夜', metaLine: '18 个节点', updatedAt: 2, createdAt: 1 },
  { id: 'p2', name: '产品主图', metaLine: '6 个节点', updatedAt: 1, createdAt: 2 },
];

const renderPage = (pageItems: ProjectCardGridItem[] = items, onOpen = vi.fn()) => render(
  <ProjectLibraryPage
    persistKey="test"
    title="项目管理"
    items={pageItems}
    labels={labels}
    secondaryAction={{ label: '导入', icon: PackageOpen, onClick: vi.fn() }}
    onOpen={onOpen}
    create={{ kind: 'named', onCreate: vi.fn() }}
    onRename={vi.fn()}
    onDelete={vi.fn()}
  />,
);

const visibleProjectIds = (): string[] => Array.from(document.querySelectorAll('[data-project-id]')).map((element) => element.getAttribute('data-project-id') ?? '');

describe('ProjectLibraryPage', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('左栏新建是唯一主按钮，页头标题旁数量，网格里没有新建卡片', () => {
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

  it('没有项目时主区只有邀请，左栏保留新建与次要动作，没有数量、搜索、排序、分类', () => {
    renderPage([]);
    expect(screen.getByText('暂无项目')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '全部' })).toBeNull();
    expect(screen.getAllByRole('button', { name: '新建项目' })).toHaveLength(1);
    expect(document.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '导入' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: '搜索项目' })).toBeNull();
    expect(screen.queryByText('0 个项目')).toBeNull();
    expect(screen.queryByRole('button', { name: '排序' })).toBeNull();
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
      <ProjectLibraryPage persistKey="test" title="项目管理" items={items} labels={labels} onOpen={vi.fn()} create={{ kind: 'named', onCreate: vi.fn() }} onRename={vi.fn()} onDelete={onDelete} />,
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

  it('多选时页头动作换成多选工具条，删除为危险档，主按钮仍只有左栏新建', async () => {
    renderPage();
    fireEvent.contextMenu(document.querySelector('[data-project-id="p2"]')!);
    fireEvent.click(within(document.querySelector('[data-context-menu]') as HTMLElement).getByText('多选'));
    expect(await screen.findByText('已选择 1 项')).toBeTruthy();
    expect(document.querySelector('[data-project-id="p2"]')?.getAttribute('data-selected')).toBe('true');
    expect(screen.getByRole('button', { name: '删除所选' }).getAttribute('data-variant')).toBe('danger');
    const primaries = document.querySelectorAll('[data-variant="primary"]');
    expect(primaries).toHaveLength(1);
    expect(primaries[0].textContent).toBe('新建项目');
  });

  it('多来源新建：第一个来源是左栏主按钮，其余来源平铺在左栏，一次点击直达', async () => {
    const open = vi.fn();
    const blank = vi.fn();
    const options = [
      { id: 'open', label: '打开图片', icon: FolderOpen, onSelect: open },
      { id: 'blank', label: '新建空白图片', icon: FilePlus2, onSelect: blank },
      { id: 'paste', label: '粘贴剪贴板图片', icon: ClipboardPaste, onSelect: vi.fn() },
    ];
    render(<ProjectLibraryPage persistKey="test" title="图片编辑" items={[]} labels={labels} onOpen={vi.fn()} create={{ kind: 'menu', options }} />);
    expect(document.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '打开图片' }));
    expect(open).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '新建空白图片' }));
    expect(blank).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-context-menu]')).toBeNull();
  });

  it('不起名直接新建：点击即交给调用方，不弹起名对话框', () => {
    const onCreate = vi.fn();
    render(<ProjectLibraryPage persistKey="test" title="剪辑" items={[]} labels={labels} onOpen={vi.fn()} create={{ kind: 'direct', onCreate }} />);
    fireEvent.click(screen.getByRole('button', { name: '新建项目' }));
    expect(onCreate).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('空态接受拖入文件', () => {
    const onDropFiles = vi.fn();
    render(<ProjectLibraryPage persistKey="test" title="图片编辑" items={[]} labels={labels} onOpen={vi.fn()} create={{ kind: 'direct', onCreate: vi.fn() }} onDropFiles={onDropFiles} />);
    const page = document.querySelector('[data-project-library-state="empty"]') as HTMLElement;
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.dragEnter(page, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(document.querySelector('[data-project-library-drop]')?.getAttribute('data-project-library-drop')).toBe('active');
    fireEvent.drop(page, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(onDropFiles).toHaveBeenCalledWith([file]);
    expect(document.querySelector('[data-project-library-drop]')?.getAttribute('data-project-library-drop')).toBe('idle');
  });

  it('不支持重命名与删除的项目没有“更多”与右键菜单；缺失文件显示状态行而不是元信息', () => {
    const onOpen = vi.fn();
    render(
      <ProjectLibraryPage
        persistKey="test"
        title="剪辑"
        items={[{ id: 'v1', name: '旅行', metaLine: 'D:/a/旅行.henji-video', status: '文件不存在' }]}
        labels={labels}
        onOpen={onOpen}
        create={{ kind: 'direct', onCreate: vi.fn() }}
      />,
    );
    expect(screen.queryByRole('button', { name: '项目操作' })).toBeNull();
    fireEvent.contextMenu(document.querySelector('[data-project-id="v1"]')!);
    expect(document.querySelector('[data-context-menu]')).toBeNull();
    expect(screen.getByText('文件不存在')).toBeTruthy();
    expect(screen.queryByText('D:/a/旅行.henji-video')).toBeNull();
    fireEvent.click(document.querySelector('[data-project-id="v1"]')!);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('读取失败只显示错误与重试，不显示新建提示', () => {
    const onRetry = vi.fn();
    render(
      <ProjectLibraryPage persistKey="test" title="口播" items={[]} labels={labels} onOpen={vi.fn()} create={{ kind: 'direct', onCreate: vi.fn() }} loadError={{ title: '暂时无法读取', message: '请重试', onRetry }} />,
    );
    expect(screen.getByText('暂时无法读取')).toBeTruthy();
    expect(screen.queryByText('暂无项目')).toBeNull();
    expect(screen.queryByRole('textbox', { name: '搜索项目' })).toBeNull();
  });

  it('草稿排在最前并带标记；左栏多出未保存草稿；单击继续编辑，菜单移到回收站经确认', async () => {
    const onOpen = vi.fn();
    const onDiscardDraft = vi.fn();
    const onDelete = vi.fn();
    render(
      <ProjectLibraryPage
        persistKey="test"
        title="画布"
        items={items}
        drafts={[{ id: 'd1', name: '未命名画布 1', metaLine: '10/6' }]}
        labels={labels}
        onOpen={onOpen}
        create={{ kind: 'direct', onCreate: vi.fn() }}
        onRename={vi.fn()}
        onDelete={onDelete}
        onDiscardDraft={onDiscardDraft}
      />,
    );
    expect(visibleProjectIds()).toEqual(['d1', 'p1', 'p2']);
    expect(document.querySelector('[data-project-id="d1"]')?.getAttribute('data-project-draft')).toBe('true');
    expect(screen.getByRole('button', { name: /未保存草稿/ }).textContent).toContain('1');
    fireEvent.click(document.querySelector('[data-project-id="d1"]')!);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1', draft: true }));
    fireEvent.contextMenu(document.querySelector('[data-project-id="d1"]')!);
    const menu = document.querySelector('[data-context-menu]') as HTMLElement;
    expect(within(menu).queryByText('重命名')).toBeNull();
    fireEvent.click(within(menu).getByText('移到回收站'));
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    await waitFor(() => expect(onDiscardDraft).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' })));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /未保存草稿/ }));
    expect(visibleProjectIds()).toEqual(['d1']);
  });

  it('列表视图记在本机，表头点击排序', () => {
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: '列表视图' }));
    expect(document.querySelector('[data-project-list-view]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '名称' }));
    expect(visibleProjectIds()).toEqual(['p2', 'p1']);
    view.unmount();
    renderPage();
    expect(document.querySelector('[data-project-list-view]')).toBeTruthy();
  });

  it('最近打开按作品索引的打开时间倒序，只列打开过的；本页点击不另记', () => {
    const onOpen = vi.fn();
    renderPage([
      { id: 'p1', name: '江南雨夜', updatedAt: 2, openedAt: 10 },
      { id: 'p2', name: '产品主图', updatedAt: 1 },
      { id: 'p3', name: '片头', updatedAt: 3, openedAt: 30 },
    ], onOpen);
    fireEvent.click(document.querySelector('[data-project-id="p2"]')!);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2' }));
    fireEvent.click(screen.getByRole('button', { name: '最近打开' }));
    expect(visibleProjectIds()).toEqual(['p3', 'p1']);
  });

  it('键盘：F2 重命名焦点项', async () => {
    renderPage();
    const card = document.querySelector('[data-project-id="p1"]') as HTMLElement;
    card.focus();
    fireEvent.keyDown(card, { key: 'F2' });
    expect(await screen.findByText('重命名项目')).toBeTruthy();
  });

  it('键盘：Delete 经确认删除焦点项，Ctrl+N 新建', async () => {
    const onDelete = vi.fn();
    const onCreate = vi.fn();
    render(
      <ProjectLibraryPage persistKey="test" title="剪辑" items={items} labels={labels} onOpen={vi.fn()} create={{ kind: 'direct', onCreate }} onRename={vi.fn()} onDelete={onDelete} />,
    );
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
    expect(onCreate).toHaveBeenCalledOnce();
    const card = document.querySelector('[data-project-id="p1"]') as HTMLElement;
    card.focus();
    fireEvent.keyDown(card, { key: 'Delete' });
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith([items[0]]));
  });
});

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLElement.prototype.scrollTo = () => undefined
})
