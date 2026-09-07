// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const commands = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(async () => undefined) }));
vi.mock('@/commands/projectState', () => ({
  getProjectRecord: commands.get, upsertProjectRecord: commands.save,
  deleteProjectRecord: vi.fn(), listProjectSummaries: vi.fn(async () => []),
  renameProjectRecord: vi.fn(), updateProjectViewportRecord: vi.fn(),
}));
vi.mock('react-i18next', async (importOriginal) => ({ ...await importOriginal<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@xyflow/react', async (importOriginal) => ({ ...await importOriginal<typeof import('@xyflow/react')>(), ReactFlowProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/features/canvas/Canvas', () => ({ Canvas: () => <div data-testid="canvas">canvas</div> }));
vi.mock('@/features/canvas/application/canvasProjectCover', () => ({ updateCanvasProjectCover: vi.fn() }));
vi.mock('@/features/canvas/application/useCanvasProjectCoverAutosave', () => ({ useCanvasProjectCoverAutosave: vi.fn() }));
vi.mock('@/features/canvas/application/canvasPersistenceService', () => ({ confirmCanvasPersistence: vi.fn() }));
vi.mock('@/platform/runtime', async (importOriginal) => ({ ...await importOriginal<typeof import('@/platform/runtime')>(), isUiInspectionReadOnly: () => false }));
vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn() }) }));
vi.mock('@/components/ui', () => ({
  UiButton: ({ variant: _variant, size: _size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => <button {...props} />,
  UiLoading: ({ message }: { message: string }) => <div role="status">{message}</div>,
  UiError: ({ message }: { message: string }) => <div role="alert">{message}</div>,
}));
vi.mock('@/features/project/ProjectManager', () => ({ ProjectManager: () => {
  const state = useProjectStore();
  return <div data-testid="projects">
    <button onClick={() => state.openProject('project')}>open</button>
    {state.openError && <div role="alert">{state.openError}</div>}
  </div>;
} }));
import { useProjectStore } from '@/stores/projectStore';
import CanvasWorkspace from './CanvasWorkspace';

const record = { id: 'project', name: 'Project', createdAt: 1, updatedAt: 1, nodeCount: 0,
  nodesJson: '[]', edgesJson: '[]', viewportJson: '{"x":0,"y":0,"zoom":1}',
  historyJson: '{"past":[],"future":[],"imagePool":[]}' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(16), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  useProjectStore.setState({ projects: [], currentProjectId: null, currentProject: null,
    isHydrated: true, isOpeningProject: false, openError: null, persistenceError: null, persistenceErrors: {} });
});
afterEach(async () => {
  cleanup();
  await useProjectStore.getState().closeProject();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('画布项目打开反馈', () => {
  it('点击立即离开列表，先给加载画面绘制机会，读取结束才挂载画布', async () => {
    let finish!: (value: typeof record) => void;
    commands.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<CanvasWorkspace />);
    fireEvent.click(screen.getByText('open'));
    expect(screen.queryByTestId('projects')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('common.loading');
    expect(screen.queryByTestId('canvas')).toBeNull();
    expect(commands.get).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(17); });
    expect(commands.get).toHaveBeenCalledWith('project');
    expect(screen.getByRole('status')).toBeTruthy();
    await act(async () => { finish(record); });
    expect(screen.getByTestId('canvas')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('加载期间返回项目会取消进入，迟到的读取结果不会重新打开画布', async () => {
    let finish!: (value: typeof record) => void;
    commands.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<CanvasWorkspace />);
    fireEvent.click(screen.getByText('open'));
    await act(async () => { await vi.advanceTimersByTimeAsync(17); });
    await act(async () => { fireEvent.click(screen.getByText('返回项目')); });
    expect(screen.getByTestId('projects')).toBeTruthy();
    await act(async () => { finish(record); });
    expect(screen.queryByTestId('canvas')).toBeNull();
    expect(commands.save).not.toHaveBeenCalled();
  });

  it('读取失败回到项目列表显示错误，可以再次打开', async () => {
    commands.get.mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce(record);
    render(<CanvasWorkspace />);
    fireEvent.click(screen.getByText('open'));
    await act(async () => { await vi.advanceTimersByTimeAsync(17); });
    expect(screen.getByTestId('projects')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('project.openFailed');
    fireEvent.click(screen.getByText('open'));
    await act(async () => { await vi.advanceTimersByTimeAsync(17); });
    expect(screen.getByTestId('canvas')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('窗口的绘制帧暂停时仍会结束等待；读取前返回则不再发起读取', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 42);
    commands.get.mockResolvedValue(record);
    render(<CanvasWorkspace />);
    fireEvent.click(screen.getByText('open'));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByTestId('canvas')).toBeTruthy();
    await act(async () => { await useProjectStore.getState().closeProject(); });
    commands.get.mockClear();
    fireEvent.click(screen.getByText('open'));
    await act(async () => { fireEvent.click(screen.getByText('返回项目')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(commands.get).not.toHaveBeenCalled();
    expect(screen.getByTestId('projects')).toBeTruthy();
  });
});
