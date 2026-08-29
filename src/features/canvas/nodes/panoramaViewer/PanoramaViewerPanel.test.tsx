/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';

import type { PanoramaCameraView } from '@/features/canvas/domain/panoramaViewer';

import { PanoramaViewerPanel } from './PanoramaViewerPanel';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

vi.mock('@/features/canvas/ui/specialInterfaces/panorama/PanoramaSphereCanvas', () => ({
  PanoramaSphereCanvas: ({ onFramePresented }: { onFramePresented?: () => void }) => (
    <button type="button" data-testid="sphere-canvas" onClick={onFramePresented} />
  ),
}));

vi.mock('./PanoramaViewerControls', () => ({
  PanoramaViewerControls: () => <div data-testid="viewer-controls" />,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PanoramaViewerPanel', () => {
  it('释放球面渲染资源后保留最后视角的冻结画面', () => {
    render(
      <PanoramaViewerPanel
        resource={{
          status: 'ready',
          displayUrl: 'panorama-source.png',
          image: {} as HTMLImageElement,
          width: 2048,
          height: 1024,
          isEquirectangular: true,
        }}
        viewMode="sphere"
        viewportAspectRatio="16:9"
        cameraView={{ yaw: 0.8, pitch: -0.2, fov: 65 }}
        currentViewRef={createRef<PanoramaCameraView>()}
        frozenPreviewUrl="data:image/png;base64,last-view"
        renderSphere={false}
        isGenerating={false}
        generationError={null}
        isCapturing={false}
        hasWebglFailure={false}
        captureRef={{ current: null }}
        onRetry={vi.fn()}
        onRequestSphere={vi.fn()}
        onInteractionStart={vi.fn()}
        onInteractionEnd={vi.fn()}
        onOpenImmersiveViewer={vi.fn()}
        onViewModeChange={vi.fn()}
        onViewportAspectRatioChange={vi.fn()}
        onCameraViewChangeEnd={vi.fn()}
        onSphereFramePresented={vi.fn()}
        onCapture={vi.fn()}
        onFrozenPreviewReady={vi.fn()}
        onContextLost={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('sphere-canvas')).toBeNull();
    const frozenPreview = screen.getByAltText('viewer.panorama.flatAlt');
    expect(frozenPreview.getAttribute('src')).toBe('data:image/png;base64,last-view');
    fireEvent.load(frozenPreview);
    expect(frozenPreview.getAttribute('data-panorama-frozen-preview')).toBe('true');
    expect(screen.queryByText('viewer.panorama.directInteractionHint')).toBeNull();
  });

  it('球面首帧完成前复用同一冻结画面覆盖 WebGL 空窗', () => {
    const commonProps = {
      resource: {
        status: 'ready' as const,
        displayUrl: 'panorama-source.png',
        image: {} as HTMLImageElement,
        width: 2048,
        height: 1024,
        isEquirectangular: true,
      },
      viewMode: 'sphere' as const,
      viewportAspectRatio: '16:9' as const,
      cameraView: { yaw: 0.8, pitch: -0.2, fov: 65 },
      currentViewRef: createRef<PanoramaCameraView>(),
      frozenPreviewUrl: 'data:image/png;base64,last-view',
      isGenerating: false,
      generationError: null,
      isCapturing: false,
      hasWebglFailure: false,
      captureRef: { current: null },
      onRetry: vi.fn(),
      onRequestSphere: vi.fn(),
      onInteractionStart: vi.fn(),
      onInteractionEnd: vi.fn(),
      onOpenImmersiveViewer: vi.fn(),
      onViewModeChange: vi.fn(),
      onViewportAspectRatioChange: vi.fn(),
      onCameraViewChangeEnd: vi.fn(),
      onSphereFramePresented: vi.fn(),
      onCapture: vi.fn(),
      onFrozenPreviewReady: vi.fn(),
      onContextLost: vi.fn(),
    };
    const { rerender } = render(
      <PanoramaViewerPanel
        {...commonProps}
        renderSphere={false}
      />,
    );

    const frozenPreview = screen.getByAltText('viewer.panorama.flatAlt');
    expect(frozenPreview).toBeTruthy();
    fireEvent.load(frozenPreview);
    expect(frozenPreview.getAttribute('data-panorama-frozen-preview')).toBe('true');
    rerender(<PanoramaViewerPanel {...commonProps} renderSphere />);
    expect(screen.getByTestId('sphere-canvas')).toBeTruthy();
    expect(document.querySelector('[data-panorama-frozen-preview="true"]')).toBe(frozenPreview);
    expect(document.querySelector('[data-panorama-transition-preview="true"]')).toBeTruthy();
    expect(frozenPreview.classList.contains('opacity-100')).toBe(true);
    fireEvent.click(screen.getByTestId('sphere-canvas'));
    expect(document.querySelector('[data-panorama-transition-preview="true"]')).toBeNull();
    expect(frozenPreview.classList.contains('opacity-0')).toBe(true);
    fireEvent.pointerEnter(screen.getByRole('region'), { clientX: 0, clientY: 0 });
    expect(commonProps.onRequestSphere).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-panorama-transition-preview="true"]')).toBeNull();
    expect(frozenPreview.classList.contains('opacity-0')).toBe(true);
  });
});
