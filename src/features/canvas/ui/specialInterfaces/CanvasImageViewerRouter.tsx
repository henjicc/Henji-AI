import { Suspense } from 'react';

import type { CanvasImageViewerMode } from '@/features/canvas/domain/canvasNodes';
import {
  getCanvasViewerSurfaceDefinition,
  type CanvasImageViewerSurfaceProps,
} from './viewerSurfaceRegistry';

interface CanvasImageViewerRouterProps extends CanvasImageViewerSurfaceProps {
  mode: CanvasImageViewerMode;
}

export function CanvasImageViewerRouter({
  mode,
  ...viewerProps
}: CanvasImageViewerRouterProps): JSX.Element {
  const definition = getCanvasViewerSurfaceDefinition(mode);
  const ViewerSurface = definition.component;
  return (
    <Suspense fallback={null}>
      <ViewerSurface {...viewerProps} />
    </Suspense>
  );
}
