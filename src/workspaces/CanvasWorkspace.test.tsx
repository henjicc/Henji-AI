// @vitest-environment jsdom
import { canvasTestRegistry, seedCanvasTestProject } from '@/tests/canvasProjectFixture';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async (importOriginal) => ({ ...await importOriginal<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@xyflow/react', async (importOriginal) => ({ ...await importOriginal<typeof import('@xyflow/react')>(), ReactFlowProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/features/canvas/Canvas', () => ({ Canvas: () => <div data-testid="canvas">canvas</div> }));
vi.mock('@/features/canvas/application/canvasProjectCover', () => ({ updateCanvasProjectCover: vi.fn() }));
vi.mock('@/features/canvas/application/useCanvasProjectCoverAutosave', () => ({ useCanvasProjectCoverAutosave: vi.fn() }));
vi.mock('@/platform/runtime', async (importOriginal) => ({ ...await importOriginal<typeof import('@/platform/runtime')>(), isUiInspectionReadOnly: () => false }));
vi.mock('@/components/ui', () => ({
  UiButton: ({ variant: _variant, size: _size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => <button {...props} />,
  UiLoading: ({ message }: { message: string }) => <div role="status">{message}</div>,
  UiError: ({ message }: { message: string }) => <div role="alert">{message}</div>,
  UiPanel: ({ variant: _variant, ...props }: React.HTMLAttributes<HTMLDivElement> & { variant?: string }) => <div {...props} />,
}));
vi.mock('@/features/canvas/projects/CanvasLibrary', () => ({ CanvasLibrary: () => {
  const state = useProjectStore();
  return <div data-testid="projects">
    <button onClick={() => state.openProject('project')}>open</button>
    {state.openError && <div role="alert">{state.openError}</div>}
  </div>;
} }));
import { useProjectStore } from '@/stores/projectStore';
import CanvasWorkspace from './CanvasWorkspace';

function deferredRead() {
  const { commands } = canvasTestRegistry();
  const original = commands.readDocument.bind(commands);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const read = vi.spyOn(commands, 'readDocument').mockImplementationOnce(async (target) => { await gate; return await original(target); });
  return { read, release };
}

beforeEach(() => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(16), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  seedCanvasTestProject({ id: 'project', name: 'Project', nodes: [], edges: [] });
});
afterEach(async () => {
  cleanup();
  await useProjectStore.getState().closeProject();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('画布打开反馈', () => {
  it('点击立即离开列表，先给加载画面绘制机会，读取结束才挂载画布', async () => {
    const { read, release } = deferredRead();
    render(<CanvasWorkspace />);
    fireEvent.click(screen.getByText('open'));
    expect(screen.queryByTestId('projects')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('common.loading');
    expect(read).not.toHaveBeenCalled();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(read).toHaveBeenCalledWith({ id: 'project' });
    expect(screen.queryByTestId('canvas')).toBeNull();
    await act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(screen.getByTestId('canvas')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('加载期间返回会取消进入，迟到的读取结果不会打开画布', async () => {
    const { release } = deferredRead();
    render(<CanvasWorkspace />);
    fireEvent.click(screen.getByText('open'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    await act(async () => { fireEvent.click(screen.getByText('canvas.backToProjects')); });
    expect(screen.getByTestId('projects')).toBeTruthy();
    await act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(screen.queryByTestId('canvas')).toBeNull();
    expect(useProjectStore.getState().currentProjectId).toBeNull();
  });

  it('读取失败回到列表显示错误，可以再次打开', async () => {
    const { commands } = canvasTestRegistry();
    vi.spyOn(commands, 'readDocument').mockRejectedValueOnce(new Error('read failed'));
    render(<CanvasWorkspace />);
    fireEvent.click(screen.getByText('open'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(screen.getByTestId('projects')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('project.openFailed');
    fireEvent.click(screen.getByText('open'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(screen.getByTestId('canvas')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('窗口的绘制帧暂停时仍会结束等待；读取前返回则不再发起读取', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 42);
    render(<CanvasWorkspace />);
    fireEvent.click(screen.getByText('open'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });
    expect(screen.getByTestId('canvas')).toBeTruthy();
    await act(async () => { await useProjectStore.getState().closeProject(); });
    const { commands } = canvasTestRegistry();
    const read = vi.spyOn(commands, 'readDocument');
    fireEvent.click(screen.getByText('open'));
    await act(async () => { fireEvent.click(screen.getByText('canvas.backToProjects')); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });
    expect(read).not.toHaveBeenCalled();
    expect(screen.getByTestId('projects')).toBeTruthy();
  });
});
