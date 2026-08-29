import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  RGBAFormat,
  UnsignedByteType,
  Vector4,
  WebGLRenderTarget,
} from 'three';
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';

import { webglRgbaToPngDataUrl } from '@/core/media/webglCaptureImage';
import {
  PANORAMA_DEFAULT_CAMERA_VIEW,
  normalizePanoramaCameraView,
  type PanoramaCameraView,
} from '@/features/canvas/domain/panoramaViewer';

import {
  PANORAMA_INITIAL_FOV,
  applyPanoramaDragDelta,
  clampPanoramaFov,
  createPanoramaRenderResources,
  disposePanoramaRenderResources,
} from './panoramaRenderResources';

interface PanoramaCameraControlsProps {
  resetRevision: number;
  interactionLabel: string;
  initialView?: PanoramaCameraView;
  currentViewRef?: MutableRefObject<PanoramaCameraView | null>;
  onInteractionStart?: () => void;
  onViewChangeEnd?: (view: PanoramaCameraView) => void;
}

function PanoramaCameraControls({
  resetRevision,
  interactionLabel,
  initialView,
  currentViewRef,
  onInteractionStart,
  onViewChangeEnd,
}: PanoramaCameraControlsProps): null {
  const { camera, gl, invalidate } = useThree();
  const normalizedInitialView = normalizePanoramaCameraView(initialView);
  const yawRef = useRef(normalizedInitialView.yaw);
  const pitchRef = useRef(normalizedInitialView.pitch);
  const wheelCommitTimerRef = useRef<number | null>(null);
  const draggingRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  const readView = useCallback((): PanoramaCameraView => ({
    yaw: yawRef.current,
    pitch: pitchRef.current,
    fov: clampPanoramaFov((camera as PerspectiveCamera).fov),
  }), [camera]);

  useEffect(() => {
    const perspectiveCamera = camera as PerspectiveCamera;
    const applyView = (): void => {
      perspectiveCamera.rotation.order = 'YXZ';
      perspectiveCamera.rotation.set(pitchRef.current, yawRef.current, 0);
      perspectiveCamera.fov = clampPanoramaFov(perspectiveCamera.fov);
      perspectiveCamera.updateProjectionMatrix();
      if (currentViewRef) currentViewRef.current = readView();
      invalidate();
    };

    const element = gl.domElement;
    const handlePointerDown = (event: PointerEvent): void => {
      event.stopPropagation();
      onInteractionStart?.();
      element.focus({ preventScroll: true });
      draggingRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      element.setPointerCapture?.(event.pointerId);
      element.style.cursor = 'grabbing';
    };
    const handlePointerMove = (event: PointerEvent): void => {
      const dragging = draggingRef.current;
      if (!dragging || dragging.pointerId !== event.pointerId) return;
      event.stopPropagation();
      const nextView = applyPanoramaDragDelta(
        readView(),
        event.clientX - dragging.x,
        event.clientY - dragging.y,
      );
      yawRef.current = nextView.yaw;
      pitchRef.current = nextView.pitch;
      dragging.x = event.clientX;
      dragging.y = event.clientY;
      applyView();
    };
    const stopDragging = (event: PointerEvent): void => {
      if (draggingRef.current?.pointerId !== event.pointerId) return;
      draggingRef.current = null;
      if (element.hasPointerCapture?.(event.pointerId)) {
        element.releasePointerCapture?.(event.pointerId);
      }
      element.style.cursor = 'grab';
      onViewChangeEnd?.(readView());
    };
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      onInteractionStart?.();
      perspectiveCamera.fov = clampPanoramaFov(perspectiveCamera.fov + event.deltaY * 0.025);
      perspectiveCamera.updateProjectionMatrix();
      invalidate();
      if (wheelCommitTimerRef.current !== null) window.clearTimeout(wheelCommitTimerRef.current);
      wheelCommitTimerRef.current = window.setTimeout(() => {
        wheelCommitTimerRef.current = null;
        onViewChangeEnd?.(readView());
      }, 150);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      const step = event.shiftKey ? 48 : 24;
      let nextView: PanoramaCameraView | null = null;
      if (event.key === 'ArrowLeft') nextView = applyPanoramaDragDelta(readView(), -step, 0);
      if (event.key === 'ArrowRight') nextView = applyPanoramaDragDelta(readView(), step, 0);
      if (event.key === 'ArrowUp') nextView = applyPanoramaDragDelta(readView(), 0, -step);
      if (event.key === 'ArrowDown') nextView = applyPanoramaDragDelta(readView(), 0, step);
      if (event.key === '+' || event.key === '=') {
        nextView = { ...readView(), fov: clampPanoramaFov(perspectiveCamera.fov - 4) };
      }
      if (event.key === '-' || event.key === '_') {
        nextView = { ...readView(), fov: clampPanoramaFov(perspectiveCamera.fov + 4) };
      }
      if (!nextView) return;
      event.preventDefault();
      event.stopPropagation();
      onInteractionStart?.();
      yawRef.current = nextView.yaw;
      pitchRef.current = nextView.pitch;
      perspectiveCamera.fov = nextView.fov;
      applyView();
      onViewChangeEnd?.(nextView);
    };

    element.style.cursor = 'grab';
    element.tabIndex = 0;
    element.setAttribute('aria-label', interactionLabel);
    element.addEventListener('pointerdown', handlePointerDown);
    element.addEventListener('pointermove', handlePointerMove);
    element.addEventListener('pointerup', stopDragging);
    element.addEventListener('pointercancel', stopDragging);
    element.addEventListener('lostpointercapture', stopDragging);
    element.addEventListener('wheel', handleWheel, { passive: false });
    element.addEventListener('keydown', handleKeyDown);
    applyView();

    return () => {
      element.style.cursor = '';
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('pointerup', stopDragging);
      element.removeEventListener('pointercancel', stopDragging);
      element.removeEventListener('lostpointercapture', stopDragging);
      element.removeEventListener('wheel', handleWheel);
      element.removeEventListener('keydown', handleKeyDown);
      draggingRef.current = null;
      if (wheelCommitTimerRef.current !== null) window.clearTimeout(wheelCommitTimerRef.current);
      wheelCommitTimerRef.current = null;
    };
  }, [camera, currentViewRef, gl, interactionLabel, invalidate, onInteractionStart, onViewChangeEnd, readView]);

  useEffect(() => {
    const perspectiveCamera = camera as PerspectiveCamera;
    const nextView = normalizePanoramaCameraView(initialView ?? PANORAMA_DEFAULT_CAMERA_VIEW);
    yawRef.current = nextView.yaw;
    pitchRef.current = nextView.pitch;
    perspectiveCamera.fov = nextView.fov;
    perspectiveCamera.rotation.order = 'YXZ';
    perspectiveCamera.rotation.set(nextView.pitch, nextView.yaw, 0);
    perspectiveCamera.updateProjectionMatrix();
    if (currentViewRef) currentViewRef.current = nextView;
    invalidate();
  }, [camera, currentViewRef, initialView, invalidate, resetRevision]);

  return null;
}

export interface PanoramaCaptureOptions {
  width: number;
  height: number;
}

export type PanoramaCaptureCurrentView = (options: PanoramaCaptureOptions) => string | null;

interface PanoramaCaptureResources {
  sceneTarget: WebGLRenderTarget;
  outputTarget: WebGLRenderTarget;
  outputPass: OutputPass;
  pixels: Uint8Array;
  width: number;
  height: number;
}

function disposePanoramaCaptureResources(resources: PanoramaCaptureResources | null): void {
  resources?.sceneTarget.dispose();
  resources?.outputTarget.dispose();
  resources?.outputPass.dispose();
}

function getPanoramaCaptureResources(
  current: PanoramaCaptureResources | null,
  options: PanoramaCaptureOptions,
): PanoramaCaptureResources {
  if (current && current.width === options.width && current.height === options.height) return current;
  disposePanoramaCaptureResources(current);
  const targetOptions = {
    format: RGBAFormat,
    type: UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
  } as const;
  return {
    sceneTarget: new WebGLRenderTarget(options.width, options.height, targetOptions),
    outputTarget: new WebGLRenderTarget(options.width, options.height, targetOptions),
    outputPass: new OutputPass(),
    pixels: new Uint8Array(options.width * options.height * 4),
    width: options.width,
    height: options.height,
  };
}

function withPanoramaRendererState<T>(renderer: WebGLRenderer, run: () => T): T {
  const previousTarget = renderer.getRenderTarget();
  const previousViewport = renderer.getViewport(new Vector4());
  const previousScissor = renderer.getScissor(new Vector4());
  const previousScissorTest = renderer.getScissorTest();
  try {
    renderer.setScissorTest(false);
    return run();
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setViewport(previousViewport);
    renderer.setScissor(previousScissor);
    renderer.setScissorTest(previousScissorTest);
  }
}

function capturePanoramaView(
  resources: PanoramaCaptureResources,
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  options: PanoramaCaptureOptions,
): string {
  const captureCamera = camera.clone();
  captureCamera.clearViewOffset();
  captureCamera.aspect = options.width / options.height;
  captureCamera.updateProjectionMatrix();
  const { sceneTarget, outputTarget, outputPass, pixels } = resources;
  return withPanoramaRendererState(renderer, () => {
    renderer.setRenderTarget(sceneTarget);
    renderer.clear();
    renderer.render(scene, captureCamera);
    outputPass.render(renderer, outputTarget, sceneTarget, 0, false);
    renderer.readRenderTargetPixels(outputTarget, 0, 0, options.width, options.height, pixels);
    return webglRgbaToPngDataUrl(pixels, options.width, options.height);
  });
}

function PanoramaCaptureBridge({
  captureRef,
}: {
  captureRef?: MutableRefObject<PanoramaCaptureCurrentView | null>;
}): null {
  const { camera, gl, scene } = useThree();

  useEffect(() => {
    if (!captureRef) return;
    let resources: PanoramaCaptureResources | null = null;
    const capture: PanoramaCaptureCurrentView = (options) => {
      try {
        resources = getPanoramaCaptureResources(resources, options);
        return capturePanoramaView(
          resources,
          gl,
          scene,
          camera as PerspectiveCamera,
          options,
        );
      } catch {
        return null;
      }
    };
    captureRef.current = capture;
    return () => {
      if (captureRef.current === capture) captureRef.current = null;
      disposePanoramaCaptureResources(resources);
      resources = null;
    };
  }, [camera, captureRef, gl, scene]);

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

function PanoramaContextLossBridge({ onContextLost }: { onContextLost?: () => void }): null {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const handleContextLost = (event: Event): void => {
      event.preventDefault();
      onContextLost?.();
    };
    gl.domElement.addEventListener('webglcontextlost', handleContextLost);
    return () => gl.domElement.removeEventListener('webglcontextlost', handleContextLost);
  }, [gl, onContextLost]);
  return null;
}

interface PanoramaSphereCanvasProps {
  image: HTMLImageElement;
  resetRevision: number;
  interactionLabel: string;
  initialView?: PanoramaCameraView;
  currentViewRef?: MutableRefObject<PanoramaCameraView | null>;
  captureRef?: MutableRefObject<PanoramaCaptureCurrentView | null>;
  onInteractionStart?: () => void;
  onViewChangeEnd?: (view: PanoramaCameraView) => void;
  onContextLost?: () => void;
}

export function PanoramaSphereCanvas({
  image,
  resetRevision,
  interactionLabel,
  initialView,
  currentViewRef,
  captureRef,
  onInteractionStart,
  onViewChangeEnd,
  onContextLost,
}: PanoramaSphereCanvasProps): JSX.Element {
  return (
    <div className="h-full w-full touch-none" data-panorama-surface="sphere">
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ fov: PANORAMA_INITIAL_FOV, near: 0.1, far: 30, position: [0, 0, 0] }}
        gl={{
          alpha: false,
          antialias: true,
          powerPreference: 'high-performance',
        }}
      >
        <PanoramaSphere image={image} />
        <PanoramaCameraControls
          resetRevision={resetRevision}
          interactionLabel={interactionLabel}
          initialView={initialView}
          currentViewRef={currentViewRef}
          onInteractionStart={onInteractionStart}
          onViewChangeEnd={onViewChangeEnd}
        />
        <PanoramaCaptureBridge captureRef={captureRef} />
        <PanoramaContextLossBridge onContextLost={onContextLost} />
      </Canvas>
    </div>
  );
}
