// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AudioNode } from './AudioNode';
import type { AudioMediaNodeData } from '../domain/canvasNodes';

const mocks = vi.hoisted(() => ({ header: vi.fn(), waveform: vi.fn() }));
vi.mock('react-i18next', async (original) => ({ ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@xyflow/react', () => ({ Handle: () => null, Position: { Left: 'left', Right: 'right' } }));
vi.mock('@/features/canvas/ui/NodeHeader', () => ({ NodeHeader: () => { mocks.header(); return null; }, NODE_HEADER_FLOATING_POSITION_CLASS: '' }));
vi.mock('@/features/canvas/ui/NodeResizeHandle', () => ({ NodeResizeHandle: () => null }));
vi.mock('@/features/canvas/application/canvasServices', () => ({ canvasEventBus: { subscribe: () => () => undefined } }));
vi.mock('@/features/canvas/application/mediaImport', () => ({ importCanvasMediaFile: vi.fn() }));
vi.mock('@/features/canvas/application/imageData', async (original) => ({ ...await original<typeof import('../application/imageData')>(), resolveImageDisplayUrl: (url: string) => url }));
vi.mock('@/stores/canvasStore', () => ({ useCanvasStore: (select: (state: object) => unknown) => select({ edges: [], setSelectedNode: vi.fn(), updateNodeData: vi.fn() }) }));
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: (select: (state: object) => unknown) => select({ useUploadFilenameAsNodeTitle: false }) }));
vi.mock('@/features/canvas/nodes/shared/useGenerationProgressDisplay', () => ({ useGenerationProgressDisplay: () => ({ isGenerating: false, progress: 0 }) }));
vi.mock('@/hooks/useWaveformData', () => ({ useWaveformData: () => ({ status: 'idle' }) }));
vi.mock('@/components/waveform/WaveformView', () => ({ WaveformView: (props: { playedSeconds: number; onSeekStart: (ratio: number) => void }) => { mocks.waveform(props.playedSeconds); return <div onClick={() => props.onSeekStart(0.5)}>seek</div>; } }));
vi.mock('@/components/mediaViewer/AudioViewerModal', () => ({ AudioViewerModal: () => null }));
vi.mock('@/components/ui', () => ({ UiEmpty: () => null, UiInput: () => null, UiIconButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.createElement('button', props) }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('播放帧只更新波形和读数，暂停 seek、换源与卸载清理正确', () => {
  const audio = document.createElement('audio');
  Object.defineProperty(audio, 'duration', { value: 100 });
  vi.spyOn(audio, 'play').mockResolvedValue(undefined);
  vi.spyOn(audio, 'pause').mockImplementation(() => undefined);
  vi.stubGlobal('Audio', vi.fn(() => audio));
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++next, cb); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const props = { id: 'audio', type: 'audio', data: { audioUrl: 'a', durationSec: 100 } as AudioMediaNodeData } as React.ComponentProps<typeof AudioNode>;
  const view = render(<AudioNode {...props} />);
  fireEvent.click(view.getByRole('button', { name: 'node.audioNode.play' }));
  const count = mocks.header.mock.calls.length;
  for (let time = 1; time <= 10; time++) {
    audio.currentTime = time;
    act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(cb => cb(time)); });
  }
  expect(mocks.waveform).toHaveBeenLastCalledWith(10);
  expect(mocks.header.mock.calls.length).toBe(count);
  fireEvent.click(view.getByRole('button', { name: 'node.audioNode.pause' }));
  expect(frames.size).toBe(0);
  fireEvent.click(view.getByText('seek'));
  fireEvent.timeUpdate(audio);
  expect(mocks.waveform).toHaveBeenLastCalledWith(50);
  view.rerender(<AudioNode {...props} data={{ ...props.data, audioUrl: 'b' }} />);
  expect(mocks.waveform).toHaveBeenLastCalledWith(0);
  fireEvent.click(view.getByRole('button', { name: 'node.audioNode.play' }));
  view.unmount();
  expect(frames.size).toBe(0);
  expect(audio.pause).toHaveBeenCalled();
});
