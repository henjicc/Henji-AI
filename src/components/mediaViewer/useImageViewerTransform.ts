import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject, type SyntheticEvent } from 'react';

export type ImageComparisonMode = 'single' | 'side-by-side' | 'overlay';

export interface ImageViewerTransformHandlers {
  comparisonImageRef: RefObject<HTMLImageElement>;
  containerRef: RefObject<HTMLDivElement>;
  imageRef: RefObject<HTMLImageElement>;
  scaleDisplayRef: RefObject<HTMLDivElement>;
  viewerOpacity: number;
  isDragging: boolean;
  resetView: () => void;
  handleImageMouseDown: (e: MouseEvent<HTMLImageElement>) => void;
  handleContainerMouseMove: (e: MouseEvent) => void;
  handleContainerMouseUp: () => void;
  handleImageMouseMove: (e: MouseEvent<HTMLImageElement>) => void;
  handleImageLoad: (e: SyntheticEvent<HTMLImageElement>) => void;
  isPointOnImageContent: (clientX: number, clientY: number) => boolean;
}

export function useImageViewerTransform(isOpen: boolean, mode: ImageComparisonMode = 'single'): ImageViewerTransformHandlers {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const comparisonImageRef = useRef<HTMLImageElement>(null);
  const scaleDisplayRef = useRef<HTMLDivElement>(null);

  const [viewerOpacity, setViewerOpacity] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const cssScaleRef = useRef(1);
  const imageScaleRef = useRef(1);
  const imagePositionRef = useRef({ x: 0, y: 0 });
  const targetScaleRef = useRef(1);
  const targetPositionRef = useRef({ x: 0, y: 0 });
  const animationFrameRef = useRef<number | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const updateImageTransform = useCallback((): void => {
    const img = imageRef.current;
    if (!img) return;
    const scale = imageScaleRef.current;
    const pos = imagePositionRef.current;
    const transform = `scale(${scale}) translate(${pos.x / scale}px, ${pos.y / scale}px)`;
    img.style.transform = transform;
    if (comparisonImageRef.current) comparisonImageRef.current.style.transform = transform;
    if (scaleDisplayRef.current) {
      const totalScale = cssScaleRef.current * scale;
      scaleDisplayRef.current.innerText = `${Math.round(totalScale * 100)}%`;
    }
  }, []);

  const resetView = useCallback((): void => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    imageScaleRef.current = 1;
    imagePositionRef.current = { x: 0, y: 0 };
    targetScaleRef.current = 1;
    targetPositionRef.current = { x: 0, y: 0 };
    updateImageTransform();
  }, [updateImageTransform]);

  const imageAtPoint = useCallback((clientX: number, clientY: number): HTMLImageElement | null => {
    if (mode === 'single') return imageRef.current;
    return [imageRef.current, comparisonImageRef.current].find((img) => {
      const rect = img?.parentElement?.getBoundingClientRect();
      return rect && clientX >= rect.left && clientX <= rect.right
        && clientY >= rect.top && clientY <= rect.bottom;
    }) ?? null;
  }, [mode]);

  const isPointOnImageContent = useCallback((clientX: number, clientY: number): boolean => {
    const img = imageAtPoint(clientX, clientY);
    if (!img || !img.naturalWidth || !img.naturalHeight) return false;
    const rect = img.getBoundingClientRect();
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const containerRatio = rect.width / rect.height;

    let contentWidth: number;
    let contentHeight: number;
    let offsetX: number;
    let offsetY: number;
    if (imgRatio > containerRatio) {
      contentWidth = rect.width;
      contentHeight = rect.width / imgRatio;
      offsetX = 0;
      offsetY = (rect.height - contentHeight) / 2;
    } else {
      contentHeight = rect.height;
      contentWidth = rect.height * imgRatio;
      offsetY = 0;
      offsetX = (rect.width - contentWidth) / 2;
    }

    const clickX = clientX - rect.left;
    const clickY = clientY - rect.top;
    return (
      clickX >= offsetX &&
      clickX <= offsetX + contentWidth &&
      clickY >= offsetY &&
      clickY <= offsetY + contentHeight
    );
  }, [imageAtPoint]);

  useEffect(() => {
    if (!isOpen) return;
    setViewerOpacity(0);
    requestAnimationFrame(() => {
      setViewerOpacity(1);
    });
    const timer = window.setTimeout(() => {
      updateImageTransform();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [isOpen, updateImageTransform]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isOpen) return;

    const isMacOs =
      typeof navigator !== 'undefined' &&
      typeof navigator.platform === 'string' &&
      /mac/i.test(navigator.platform);

    const wheelDelta = (event: WheelEvent): number => {
      const factor = event.ctrlKey && isMacOs ? 10 : 1;
      const deltaModeFactor = event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002;
      return -event.deltaY * deltaModeFactor * factor;
    };

    const handleWheel = (e: WheelEvent) => {
      if ((e.target as Element | null)?.closest('button, [role="slider"]')) return;
      if (!isPointOnImageContent(e.clientX, e.clientY)) return;
      e.preventDefault();

      if (!animationFrameRef.current) {
        targetScaleRef.current = imageScaleRef.current;
        targetPositionRef.current = imagePositionRef.current;
      }

      const currentScale = targetScaleRef.current;
      const currentPos = targetPositionRef.current;
      const pinchDelta = wheelDelta(e);
      let newScale = currentScale * Math.pow(2, pinchDelta);
      newScale = Math.max(0.1, Math.min(10, newScale));

      const rect = imageAtPoint(e.clientX, e.clientY)?.parentElement?.getBoundingClientRect()
        ?? container.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const mouseFromCenter = { x: mouseX - centerX, y: mouseY - centerY };
      const k = newScale / currentScale;
      const newPos = {
        x: mouseFromCenter.x * (1 - k) + currentPos.x * k,
        y: mouseFromCenter.y * (1 - k) + currentPos.y * k,
      };

      targetScaleRef.current = newScale;
      targetPositionRef.current = newPos;

      if (!animationFrameRef.current) {
        const loop = () => {
          const targetScale = targetScaleRef.current;
          const targetPos = targetPositionRef.current;
          const currentScale = imageScaleRef.current;
          const currentPos = imagePositionRef.current;
          const factor = 0.3;
          const nextScale = currentScale + (targetScale - currentScale) * factor;
          const nextPos = {
            x: currentPos.x + (targetPos.x - currentPos.x) * factor,
            y: currentPos.y + (targetPos.y - currentPos.y) * factor,
          };

          imageScaleRef.current = nextScale;
          imagePositionRef.current = nextPos;
          updateImageTransform();

          if (
            Math.abs(nextScale - targetScale) < 0.001 &&
            Math.abs(nextPos.x - targetPos.x) < 0.1 &&
            Math.abs(nextPos.y - targetPos.y) < 0.1
          ) {
            imageScaleRef.current = targetScale;
            imagePositionRef.current = targetPos;
            updateImageTransform();
            animationFrameRef.current = null;
          } else {
            animationFrameRef.current = requestAnimationFrame(loop);
          }
        };
        animationFrameRef.current = requestAnimationFrame(loop);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isOpen, imageAtPoint, isPointOnImageContent, updateImageTransform]);

  const handleImageMouseDown = useCallback((e: MouseEvent<HTMLImageElement>): void => {
    if (e.button !== 0) return;
    if (!isPointOnImageContent(e.clientX, e.clientY)) return;
    e.preventDefault();
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - imagePositionRef.current.x,
      y: e.clientY - imagePositionRef.current.y,
    };
  }, [isPointOnImageContent]);

  const handleContainerMouseMove = useCallback((e: MouseEvent): void => {
    if (!isDragging) return;
    const newPos = {
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    };
    imagePositionRef.current = newPos;
    targetPositionRef.current = newPos;
    updateImageTransform();
  }, [isDragging, updateImageTransform]);

  const handleContainerMouseUp = useCallback((): void => {
    setIsDragging(false);
  }, []);

  const handleImageMouseMove = useCallback((e: MouseEvent<HTMLImageElement>): void => {
    const isOnContent = isPointOnImageContent(e.clientX, e.clientY);
    e.currentTarget.style.cursor = isOnContent ? (isDragging ? 'grabbing' : 'default') : 'default';
  }, [isDragging, isPointOnImageContent]);

  const measureImage = useCallback((): void => {
    const img = imageRef.current;
    if (!img?.naturalWidth || !img.naturalHeight || !img.offsetWidth || !img.offsetHeight) return;
    cssScaleRef.current = Math.min(img.offsetWidth / img.naturalWidth, img.offsetHeight / img.naturalHeight);
    updateImageTransform();
  }, [updateImageTransform]);

  const handleImageLoad = useCallback((_event: SyntheticEvent<HTMLImageElement>): void => {
    measureImage();
  }, [measureImage]);

  // 仅左右布局改变适配比例；仅结果与叠加共用几何，不重置用户的缩放和平移。
  const splitView = mode === 'side-by-side';
  useLayoutEffect(() => {
    if (!isOpen) return;
    resetView();
    measureImage();
    const img = imageRef.current;
    if (!img) return;
    const observer = new ResizeObserver(measureImage);
    observer.observe(img);
    return () => observer.disconnect();
  }, [isOpen, splitView, resetView, measureImage]);

  return {
    containerRef,
    imageRef,
    comparisonImageRef,
    scaleDisplayRef,
    viewerOpacity,
    isDragging,
    resetView,
    handleImageMouseDown,
    handleContainerMouseMove,
    handleContainerMouseUp,
    handleImageMouseMove,
    handleImageLoad,
    isPointOnImageContent,
  };
}
