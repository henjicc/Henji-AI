import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import type { PerspectiveCamera } from 'three';

import {
  PANORAMA_INITIAL_FOV,
  clampPanoramaFov,
  clampPanoramaPitch,
  createPanoramaRenderResources,
  disposePanoramaRenderResources,
} from './panoramaRenderResources';

interface PanoramaCameraControlsProps {
  resetRevision: number;
}

function PanoramaCameraControls({ resetRevision }: PanoramaCameraControlsProps): null {
  const { camera, gl, invalidate } = useThree();
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const draggingRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const perspectiveCamera = camera as PerspectiveCamera;
    const applyView = (): void => {
      perspectiveCamera.rotation.order = 'YXZ';
      perspectiveCamera.rotation.set(pitchRef.current, yawRef.current, 0);
      perspectiveCamera.fov = clampPanoramaFov(perspectiveCamera.fov);
      perspectiveCamera.updateProjectionMatrix();
      invalidate();
    };

    const element = gl.domElement;
    const handlePointerDown = (event: PointerEvent): void => {
      draggingRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      element.setPointerCapture?.(event.pointerId);
      element.style.cursor = 'grabbing';
    };
    const handlePointerMove = (event: PointerEvent): void => {
      const dragging = draggingRef.current;
      if (!dragging || dragging.pointerId !== event.pointerId) return;
      yawRef.current -= (event.clientX - dragging.x) * 0.004;
      pitchRef.current = clampPanoramaPitch(
        pitchRef.current - (event.clientY - dragging.y) * 0.004,
      );
      dragging.x = event.clientX;
      dragging.y = event.clientY;
      applyView();
    };
    const stopDragging = (event: PointerEvent): void => {
      if (draggingRef.current?.pointerId !== event.pointerId) return;
      draggingRef.current = null;
      element.releasePointerCapture?.(event.pointerId);
      element.style.cursor = 'grab';
    };
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      perspectiveCamera.fov = clampPanoramaFov(perspectiveCamera.fov + event.deltaY * 0.025);
      perspectiveCamera.updateProjectionMatrix();
      invalidate();
    };

    element.style.cursor = 'grab';
    element.addEventListener('pointerdown', handlePointerDown);
    element.addEventListener('pointermove', handlePointerMove);
    element.addEventListener('pointerup', stopDragging);
    element.addEventListener('pointercancel', stopDragging);
    element.addEventListener('wheel', handleWheel, { passive: false });
    applyView();

    return () => {
      element.style.cursor = '';
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('pointerup', stopDragging);
      element.removeEventListener('pointercancel', stopDragging);
      element.removeEventListener('wheel', handleWheel);
      draggingRef.current = null;
    };
  }, [camera, gl, invalidate]);

  useEffect(() => {
    const perspectiveCamera = camera as PerspectiveCamera;
    yawRef.current = 0;
    pitchRef.current = 0;
    perspectiveCamera.fov = PANORAMA_INITIAL_FOV;
    perspectiveCamera.rotation.order = 'YXZ';
    perspectiveCamera.rotation.set(0, 0, 0);
    perspectiveCamera.updateProjectionMatrix();
    invalidate();
  }, [camera, invalidate, resetRevision]);

  return null;
}

function PanoramaSphere({ image }: { image: HTMLImageElement }): JSX.Element {
  const resources = useMemo(() => createPanoramaRenderResources(image), [image]);

  useEffect(() => () => disposePanoramaRenderResources(resources), [resources]);

  return (
    <mesh
      geometry={resources.geometry}
      material={resources.material}
      dispose={null}
    />
  );
}

interface PanoramaSphereCanvasProps {
  image: HTMLImageElement;
  resetRevision: number;
}

export function PanoramaSphereCanvas({
  image,
  resetRevision,
}: PanoramaSphereCanvasProps): JSX.Element {
  return (
    <div className="h-full w-full touch-none" data-panorama-surface="sphere">
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ fov: PANORAMA_INITIAL_FOV, near: 0.1, far: 30, position: [0, 0, 0] }}
        gl={{ alpha: false, antialias: true, powerPreference: 'high-performance' }}
      >
        <PanoramaSphere image={image} />
        <PanoramaCameraControls resetRevision={resetRevision} />
      </Canvas>
    </div>
  );
}
