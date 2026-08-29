/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';

import type { PanoramaCameraView } from '@/features/canvas/domain/panoramaViewer';

import { PanoramaViewerPanel } from './PanoramaViewerPanel';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

vi.mock('@/features/canvas/ui/specialInterfaces/panorama/PanoramaSphereCanvas', () => ({
  PanoramaSphereCanvas: () => <div data-testid="sphere-canvas" />,
}));

vi.mock('./PanoramaViewerControls', () => ({
  PanoramaViewerControls: () => <div data-testid="viewer-controls" />,
}));

afterEach(cleanup);

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
        onOpenImmersiveViewer={vi.fn()}
        onViewModeChange={vi.fn()}
        onViewportAspectRatioChange={vi.fn()}
        onCameraViewChangeEnd={vi.fn()}
        onCapture={vi.fn()}
        onContextLost={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('sphere-canvas')).toBeNull();
    const frozenPreview = screen.getByAltText('viewer.panorama.flatAlt');
    expect(frozenPreview.getAttribute('src')).toBe('data:image/png;base64,last-view');
    expect(frozenPreview.getAttribute('data-panorama-frozen-preview')).toBe('true');
    expect(screen.queryByText('viewer.panorama.directInteractionHint')).toBeNull();
  });
});
