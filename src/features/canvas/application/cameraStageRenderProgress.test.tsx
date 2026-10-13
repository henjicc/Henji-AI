/** @vitest-environment jsdom */
import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes';
import { canvasToDocumentContent } from './canvasDocumentContent';
import { clearCameraStageRenderProgress, clearCameraStageNodeRenderProgress, setCameraStageNodeRenderProgress, useCameraStageNodeRenderProgress, useCameraStageRenderProgressStore } from './cameraStageRenderProgress';

afterEach(() => { cleanup(); clearCameraStageRenderProgress(); });

it('相等快照不通知，旧请求清理不会移除新请求', () => {
  const snapshot = { outputKind: 'video' as const, progress: 0.3, phase: 'rendering' as const, requestId: 'new' };
  setCameraStageNodeRenderProgress('project', 'node', snapshot);
  const notify = vi.fn();
  const unsubscribe = useCameraStageRenderProgressStore.subscribe(notify);
  setCameraStageNodeRenderProgress('project', 'node', { ...snapshot });
  setCameraStageNodeRenderProgress('project', 'missing', null);
  clearCameraStageNodeRenderProgress('project', 'node', 'old');
  expect(notify).not.toHaveBeenCalled();
  clearCameraStageNodeRenderProgress('project', 'node', 'new');
  expect(notify).toHaveBeenCalledTimes(1);
  clearCameraStageRenderProgress();
  expect(notify).toHaveBeenCalledTimes(1);
  unsubscribe();
});

it('导出完成或取消后撤销仅恢复作品，进度不产生历史、不落盘、不恢复忙碌', () => {
  for (const completed of [true, false]) {
    useCanvasStore.getState().setCanvasData([{ id: 'camera', type: CANVAS_NODE_TYPES.cameraStage,
      position: { x: 0, y: 0 }, data: { projectId: 'stage', aspectRatio: '16:9', selectedTimeSec: 0,
        imageUrl: null, videoUrl: 'old.mp4', durationSec: 1 } }], [], { past: [], future: [] });
    const hook = renderHook(() => useCameraStageNodeRenderProgress('canvas', 'camera'));
    act(() => {
      setCameraStageNodeRenderProgress('canvas', 'camera', { outputKind: 'video', progress: 0, phase: 'rendering' });
      useCanvasStore.getState().updateNodeData('camera', { displayName: '编辑标题' });
      for (const progress of [0.2, 0.8]) setCameraStageNodeRenderProgress('canvas', 'camera', { outputKind: 'video', progress, phase: 'rendering' });
    });
    expect(hook.result.current?.progress).toBe(0.8);
    expect(useCanvasStore.getState().history.past).toHaveLength(1);
    const saved = canvasToDocumentContent({ nodes: useCanvasStore.getState().nodes, edges: [] });
    expect(saved.nodes[0].data).toMatchObject({ videoExporting: false, videoProgress: null });
    act(() => {
      if (completed) useCanvasStore.getState().updateNodeData('camera', { videoUrl: 'new.mp4', durationSec: 2 });
      setCameraStageNodeRenderProgress('canvas', 'camera', null);
      useCanvasStore.getState().undo();
    });
    expect(hook.result.current).toBeNull();
    expect(useCanvasStore.getState().nodes[0].data).toMatchObject({ videoUrl: 'old.mp4', videoExporting: false, videoProgress: null });
    act(() => { useCanvasStore.getState().redo(); });
    expect(hook.result.current).toBeNull();
    expect(useCanvasStore.getState().nodes[0].data.videoUrl).toBe(completed ? 'new.mp4' : 'old.mp4');
    hook.unmount();
  }
});
