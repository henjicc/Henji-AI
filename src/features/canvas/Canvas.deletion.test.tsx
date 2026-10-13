/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import { createCanvasTestProject, canvasTestRegistry } from '@/tests/canvasProjectFixture';
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage';
import { readPersistedCanvasProjectSnapshot } from './application/canvasQueryService';
import { confirmCanvasPersistence } from './application/canvasPersistenceService';
import { canvasEventBus } from './application/canvasServices';
import { CANVAS_NODE_TYPES } from './domain/canvasNodes';
import { NodeActionToolbar } from './ui/NodeActionToolbar';

// 仅替换布局容器与翻译；按钮、删除服务和保存屏障均使用正式实现。
vi.mock('@xyflow/react', async original => ({
  ...await original<typeof import('@xyflow/react')>(),
  NodeToolbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-i18next', async original => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => installHarnessNativeStorage());
afterEach(() => { cleanup(); vi.restoreAllMocks(); uninstallHarnessNativeStorage(); });

it('真实工具栏删除使用默认持久化选项，保存后移除节点且不报协调器缺失', async () => {
  const projectId = await createCanvasTestProject('UI 删除入口');
  const id = useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.textAnnotation, { x: 0, y: 0 }, { content: '待删除' });
  await confirmCanvasPersistence(projectId);
  const publish = vi.spyOn(canvasEventBus, 'publish');
  const view = render(<NodeActionToolbar node={useCanvasStore.getState().nodes.find(node => node.id === id)!} />);
  let release!: () => void;
  canvasTestRegistry().commands.saveGate = new Promise<void>(resolve => { release = resolve; });
  try {
    fireEvent.click(view.getByRole('button', { name: 'common.delete' }));
    await waitFor(() => expect(useCanvasStore.getState().nodes.some(node => node.id === id)).toBe(false));
    expect((await readPersistedCanvasProjectSnapshot(projectId)).nodes.some(node => node.id === id)).toBe(true);
    await act(async () => release());
    await waitFor(async () => expect((await readPersistedCanvasProjectSnapshot(projectId)).nodes.some(node => node.id === id)).toBe(false));
    expect(publish).not.toHaveBeenCalledWith('canvas/toast', expect.objectContaining({ type: 'error' }));
  } finally { release(); }
});
