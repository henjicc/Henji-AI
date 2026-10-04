/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ exportProject: vi.fn(), importProject: vi.fn() }));

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('@/services/projectPackage/exportProject', () => ({ exportProjectToPackage: mocks.exportProject }));
vi.mock('@/services/projectPackage/importProject', () => ({ importProjectFromPackage: mocks.importProject }));
vi.mock('@/stores/projectStore', () => ({
  useProjectStore: () => ({
    projects: [
      { id: 'p1', name: '江南雨夜', nodeCount: 3, updatedAt: 2, createdAt: 1, coverPath: null },
      { id: 'p2', name: '产品主图', nodeCount: 1, updatedAt: 1, createdAt: 2, coverPath: null },
    ],
    isOpeningProject: false, openError: null, persistenceError: null,
    createProject: vi.fn(), deleteProject: vi.fn(), renameProject: vi.fn(), openProject: vi.fn(), hydrate: vi.fn(),
  }),
}));

import { ProjectManager } from './ProjectManager';

const openMenu = (projectIndex: number): HTMLElement => {
  fireEvent.click(screen.getAllByRole('button', { name: 'project.more' })[projectIndex]);
  return document.querySelector('[data-context-menu]') as HTMLElement;
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe('ProjectManager 导出项目包（5.6 第二批 B-40）', () => {
  it('导出期间显示“正在导出…”并禁止重复触发，完成后恢复', async () => {
    let finish!: () => void;
    mocks.exportProject.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    render(<ProjectManager />);

    fireEvent.click(within(openMenu(0)).getByText('project.exportPackage'));
    await waitFor(() => expect(mocks.exportProject).toHaveBeenCalledTimes(1));
    expect(mocks.exportProject).toHaveBeenCalledWith('p1');
    expect((await screen.findByRole('status')).textContent).toContain('project.exporting');

    // 菜单再打开时：正在导出的那一项显示进行中，其他项目的导出也禁用
    const exportingItem = within(openMenu(0)).getByText('project.exporting').closest('button');
    expect(exportingItem?.disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    const otherItem = within(openMenu(1)).getByText('project.exportPackage').closest('button');
    expect(otherItem?.disabled).toBe(true);
    fireEvent.click(otherItem!);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(mocks.exportProject).toHaveBeenCalledTimes(1);

    await act(async () => { finish(); });
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('导出失败沿用失败提示（标题说明是导出失败）', async () => {
    mocks.exportProject.mockRejectedValue(new Error('磁盘已满'));
    render(<ProjectManager />);
    fireEvent.click(within(openMenu(0)).getByText('project.exportPackage'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('project.exportFailed');
    expect(alert.textContent).toContain('磁盘已满');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
