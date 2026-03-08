import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactCrop, {
  type Crop,
  type PixelCrop,
} from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import type { ToolSelectField } from '@/features/canvas/tools';
import type { VisualToolEditorProps } from './types';
import {
  buildDefaultCrop,
  getDefaultRatioOptions,
  resolveAspect,
  resolveCustomRatioError,
  resolveRenderedImageSize,
  toImageSpaceCrop,
  toNumber,
  toRenderedCrop,
  type RatioOption,
} from './crop/shared';

export function CropToolEditor({ plugin, sourceImageUrl, options, onOptionsChange }: VisualToolEditorProps): JSX.Element {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const previousAspectKeyRef = useRef<string | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [customRatioInput, setCustomRatioInput] = useState(
    typeof options.customAspectRatio === 'string' ? options.customAspectRatio : ''
  );
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  const displaySourceImageUrl = useMemo(
    () => resolveImageDisplayUrl(sourceImageUrl),
    [sourceImageUrl]
  );

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }

    const updateViewportSize = () => {
      const rect = element.getBoundingClientRect();
      setViewportSize({
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      });
    };

    updateViewportSize();
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const renderedImageSize = useMemo(
    () => resolveRenderedImageSize(naturalSize, viewportSize),
    [naturalSize, viewportSize]
  );

  const ratioOptions = useMemo<RatioOption[]>(() => {
    const field = plugin.fields.find((item) => item.type === 'select' && item.key === 'aspectRatio');
    if (!field) {
      return getDefaultRatioOptions();
    }

    return (field as ToolSelectField).options;
  }, [plugin.fields]);

  const aspectMode = typeof options.aspectRatio === 'string' ? options.aspectRatio : 'free';
  const resolvedAspect = useMemo(
    () => resolveAspect(aspectMode, customRatioInput, naturalSize),
    [aspectMode, customRatioInput, naturalSize]
  );

  const customRatioError = useMemo(
    () => resolveCustomRatioError(aspectMode, customRatioInput),
    [aspectMode, customRatioInput]
  );

  useEffect(() => {
    setCustomRatioInput(typeof options.customAspectRatio === 'string' ? options.customAspectRatio : '');
  }, [options.customAspectRatio]);

  const syncCropToOptions = useCallback((pixelCrop: PixelCrop): void => {
    if (!renderedImageSize || naturalSize.width <= 0 || naturalSize.height <= 0) {
      return;
    }

    const imageCrop = toImageSpaceCrop(
      pixelCrop,
      renderedImageSize.width,
      renderedImageSize.height,
      naturalSize.width,
      naturalSize.height
    );

    onOptionsChange({
      ...options,
      aspectRatio: aspectMode,
      customAspectRatio: customRatioInput,
      ...imageCrop,
    });
  }, [
    aspectMode,
    customRatioInput,
    naturalSize.height,
    naturalSize.width,
    onOptionsChange,
    options,
    renderedImageSize,
  ]);

  const applyCropFromOptions = useCallback((): boolean => {
    if (!renderedImageSize || naturalSize.width <= 0 || naturalSize.height <= 0) {
      return false;
    }

    const cropX = toNumber(options.cropX);
    const cropY = toNumber(options.cropY);
    const cropWidth = toNumber(options.cropWidth);
    const cropHeight = toNumber(options.cropHeight);
    if (
      cropX === null ||
      cropY === null ||
      cropWidth === null ||
      cropHeight === null ||
      cropWidth <= 0 ||
      cropHeight <= 0
    ) {
      return false;
    }

    setCrop(
      toRenderedCrop(
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        renderedImageSize.width,
        renderedImageSize.height,
        naturalSize.width,
        naturalSize.height
      )
    );
    return true;
  }, [
    naturalSize.height,
    naturalSize.width,
    options.cropHeight,
    options.cropWidth,
    options.cropX,
    options.cropY,
    renderedImageSize,
  ]);

  useEffect(() => {
    if (!renderedImageSize) {
      return;
    }

    const aspectKey = `${aspectMode}:${aspectMode === 'custom' ? customRatioInput : ''}`;
    const aspectModeChanged =
      previousAspectKeyRef.current !== null
      && previousAspectKeyRef.current !== aspectKey;
    previousAspectKeyRef.current = aspectKey;

    if (!aspectModeChanged && applyCropFromOptions()) {
      return;
    }

    const next = buildDefaultCrop(
      renderedImageSize.width,
      renderedImageSize.height,
      resolvedAspect
    );
    setCrop(next);
    syncCropToOptions({
      unit: 'px',
      x: Math.round(next.x ?? 0),
      y: Math.round(next.y ?? 0),
      width: Math.round(next.width ?? renderedImageSize.width),
      height: Math.round(next.height ?? renderedImageSize.height),
    });
  }, [
    applyCropFromOptions,
    aspectMode,
    customRatioInput,
    renderedImageSize,
    resolvedAspect,
    syncCropToOptions,
  ]);

  const handleImageLoad = useCallback((): void => {
    const image = imageRef.current;
    if (!image) {
      return;
    }

    setNaturalSize({
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {ratioOptions.map((item) => {
          const active = item.value === aspectMode;
          return (
            <button
              key={item.value}
              type="button"
              className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                active
                  ? 'border-accent/45 bg-accent/15 text-text-dark'
                  : 'border-[rgba(255,255,255,0.15)] text-text-muted hover:bg-bg-dark'
              }`}
              onClick={() =>
                onOptionsChange({
                  ...options,
                  aspectRatio: item.value,
                })
              }
            >
              {item.label}
            </button>
          );
        })}

        <button
          type="button"
          className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
            aspectMode === 'custom'
              ? 'border-accent/45 bg-accent/15 text-text-dark'
              : 'border-[rgba(255,255,255,0.15)] text-text-muted hover:bg-bg-dark'
          }`}
          onClick={() =>
            onOptionsChange({
              ...options,
              aspectRatio: 'custom',
            })
          }
        >
          自定义
        </button>
      </div>

      {aspectMode === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={customRatioInput}
            onChange={(event) => {
              const next = event.target.value;
              setCustomRatioInput(next);
              onOptionsChange({
                ...options,
                aspectRatio: 'custom',
                customAspectRatio: next,
              });
            }}
            placeholder="输入比例，如 3:2 或 1.5"
            className="h-9 w-[220px] rounded-lg border border-[rgba(255,255,255,0.15)] bg-bg-dark/80 px-3 text-sm text-text-dark outline-none"
          />
          {customRatioError && <span className="text-xs text-red-400">{customRatioError}</span>}
        </div>
      )}

      <div
        ref={viewportRef}
        className="relative h-[min(62vh,640px)] rounded-xl border border-[rgba(255,255,255,0.12)] bg-bg-dark/85"
      >
        <div className="flex h-full w-full items-center justify-center p-3">
          {renderedImageSize && (
            <ReactCrop
              crop={crop}
              onChange={(nextCrop) => setCrop(nextCrop)}
              onComplete={(pixelCrop) => syncCropToOptions(pixelCrop)}
              aspect={resolvedAspect}
              minWidth={24}
              minHeight={24}
              keepSelection
              ruleOfThirds
            >
              <img
                ref={imageRef}
                src={displaySourceImageUrl}
                alt="Crop Source"
                className="block select-none object-contain"
                style={{
                  width: `${renderedImageSize.width}px`,
                  height: `${renderedImageSize.height}px`,
                  maxWidth: 'none',
                  maxHeight: 'none',
                }}
                onLoad={handleImageLoad}
              />
            </ReactCrop>
          )}
          {!renderedImageSize && (
            <img
              ref={imageRef}
              src={displaySourceImageUrl}
              alt="Crop Source"
              className="hidden"
              onLoad={handleImageLoad}
            />
          )}
        </div>
      </div>
    </div>
  );
}
