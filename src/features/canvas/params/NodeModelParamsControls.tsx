import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { ModelTag } from '@/core/types';
import { UiChipButton } from '@/components/ui';
import { resolveUiOverlayTarget, UiOverlayLayerProvider, useUiOverlayLayer } from '@/components/ui/overlayOwnership';
import type { CanvasModelMediaType } from '@/features/canvas/domain/defaultModels';
import type { CanvasImageCapabilityModelPolicy } from '@/features/canvas/capabilities/types';
import { UI_TRIGGER_PANEL_GLASS_CLASS } from '@/components/ui/styleTokens';
import {
  resolveFloatingPanelPosition,
  type FloatingPanelAnchorRect,
  type FloatingPanelPosition,
} from '@/components/ui/floatingPanelPosition';
import { getProviderDisplayName } from '@/utils/modelHelpers';
import { ModelPickerList } from './ModelPickerList';
import { useModelPickerList } from './useModelPickerList';

interface NodeModelParamsControlsProps {
  mediaType: CanvasModelMediaType;
  modelId: string;
  onModelChange: (modelId: string) => void;
  /** 限定可选模型必须同时具备的标签（如仅展示支持图片编辑的模型） */
  requiredTags?: ModelTag[];
  /** 能力级模型家族、供应商组合与语义参数约束 */
  modelPolicy?: CanvasImageCapabilityModelPolicy;
  chipClassName?: string;
  modelChipClassName?: string;
  /** 模型 chip 内容（名称+供应商）的实际像素宽度变化回调，用于驱动节点最小宽度随内容自适应 */
  onModelChipContentWidthChange?: (width: number) => void;
}

const MODEL_PANEL_FALLBACK_CONTENT_WIDTH = 302;
const MODEL_PANEL_HORIZONTAL_CHROME = 18;
const MODEL_PANEL_VIEWPORT_GUTTER = 12;
const MODEL_PANEL_VIEWPORT_TOP_INSET = 48;
const MODEL_PANEL_GAP = 8;

function getPanelAnchor(triggerElement: HTMLDivElement | null): FloatingPanelAnchorRect | null {
  if (!triggerElement) {
    return null;
  }
  const rect = triggerElement.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
  };
}

function resolvePanelPosition(
  anchor: FloatingPanelAnchorRect | null,
  panelWidth: number,
  panelHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): FloatingPanelPosition | null {
  if (!anchor) {
    return null;
  }
  return resolveFloatingPanelPosition({
    anchor,
    panelWidth,
    panelHeight,
    viewportWidth,
    viewportHeight,
    preferredPlacement: 'above',
    horizontalAlign: 'center',
    gap: MODEL_PANEL_GAP,
    viewportGutter: MODEL_PANEL_VIEWPORT_GUTTER,
    viewportTopInset: MODEL_PANEL_VIEWPORT_TOP_INSET,
  });
}

export const NodeModelParamsControls = memo(({
  mediaType,
  modelId,
  onModelChange,
  requiredTags = [],
  modelPolicy,
  chipClassName = '',
  modelChipClassName = 'max-w-[260px] justify-start',
  onModelChipContentWidthChange,
}: NodeModelParamsControlsProps) => {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLDivElement>(null);
  const modelChipMeasureRef = useRef<HTMLDivElement>(null);
  const modelPanelRef = useRef<HTMLDivElement>(null);
  const modelSearchInputRef = useRef<HTMLInputElement>(null);
  const [openPanel, setOpenPanel] = useState<'model' | null>(null);
  const [renderPanel, setRenderPanel] = useState<'model' | null>(null);
  const [isPanelVisible, setIsPanelVisible] = useState(false);
  const overlay = useUiOverlayLayer(openPanel !== null);
  const [modelPanelAnchor, setModelPanelAnchor] = useState<FloatingPanelAnchorRect | null>(null);
  const [modelPanelContentWidth, setModelPanelContentWidth] = useState(0);
  const [modelPanelHeight, setModelPanelHeight] = useState(0);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window === 'undefined' ? 1024 : window.innerWidth,
    height: typeof window === 'undefined' ? 768 : window.innerHeight,
  }));
  const {
    modelSearchQuery,
    setModelSearchQuery,
    providerFilter,
    setProviderFilter,
    providerOptions,
    providerModels,
    filteredModels,
    selectedModelOption,
    selectedModel,
    selectedModelName,
    hasCompatibleModels,
  } = useModelPickerList({ mediaType, modelId, requiredTags, modelPolicy });

  const desiredModelPanelWidth = (
    modelPanelContentWidth || MODEL_PANEL_FALLBACK_CONTENT_WIDTH
  ) + MODEL_PANEL_HORIZONTAL_CHROME;
  const modelPanelWidth = Math.min(
    desiredModelPanelWidth,
    Math.max(0, viewportSize.width - MODEL_PANEL_VIEWPORT_GUTTER * 2)
  );
  const modelPanelPosition = useMemo(
    () => resolvePanelPosition(
      modelPanelAnchor,
      modelPanelWidth,
      modelPanelHeight,
      viewportSize.width,
      viewportSize.height,
    ),
    [modelPanelAnchor, modelPanelHeight, modelPanelWidth, viewportSize.height, viewportSize.width],
  );
  useEffect(() => {
    const animationDurationMs = 200;
    let enterRaf1: number | null = null;
    let enterRaf2: number | null = null;
    let switchTimer: ReturnType<typeof setTimeout> | null = null;

    const startEnterAnimation = () => {
      enterRaf1 = requestAnimationFrame(() => {
        enterRaf2 = requestAnimationFrame(() => {
          setIsPanelVisible(true);
        });
      });
    };
    const cleanup = () => {
      if (switchTimer) clearTimeout(switchTimer);
      if (enterRaf1) cancelAnimationFrame(enterRaf1);
      if (enterRaf2) cancelAnimationFrame(enterRaf2);
    };

    if (!openPanel) {
      setIsPanelVisible(false);
      switchTimer = setTimeout(() => setRenderPanel(null), animationDurationMs);
      return cleanup;
    }

    if (renderPanel && renderPanel !== openPanel) {
      setIsPanelVisible(false);
      switchTimer = setTimeout(() => {
        setRenderPanel(openPanel);
        startEnterAnimation();
      }, animationDurationMs);
      return cleanup;
    }

    if (!renderPanel) {
      setRenderPanel(openPanel);
    }
    startEnterAnimation();
    return cleanup;
  }, [openPanel, renderPanel]);

  useEffect(() => {
    if (!renderPanel) return;

    const updateLayout = (): void => {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
      setModelPanelAnchor(getPanelAnchor(modelTriggerRef.current));
    };

    const handleScroll = (event: Event): void => {
      const target = event.target;
      if (
        target instanceof globalThis.Node
        && modelPanelRef.current?.contains(target)
      ) {
        return;
      }
      updateLayout();
    };

    updateLayout();
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', updateLayout);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', updateLayout);
    };
  }, [renderPanel]);

  useLayoutEffect(() => {
    const panel = modelPanelRef.current;
    if (!panel || !renderPanel) return;

    const measure = (): void => {
      const height = Math.max(panel.scrollHeight, panel.getBoundingClientRect().height);
      // 面板受视口 max-height 约束后，真正滚动的是内部模型列表。这里保留首次测得的
      // 自然高度，避免 ResizeObserver 把受限高度写回后误判为“上方已放得下”。
      setModelPanelHeight((current) => Math.max(current, height));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [renderPanel, modelPanelContentWidth]);

  useLayoutEffect(() => {
    const measureEl = modelChipMeasureRef.current;
    if (!measureEl || !onModelChipContentWidthChange) {
      return;
    }
    const measure = () => onModelChipContentWidthChange(measureEl.scrollWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(measureEl);
    return () => observer.disconnect();
  }, [onModelChipContentWidthChange, selectedModelName, selectedModel]);

  useEffect(() => {
    // 点外关闭走通用浮层归属（任务 4.3）：模型面板及其子浮层内的点击都算内部
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as globalThis.Node;
      if (containerRef.current?.contains(target)) return;
      if (resolveUiOverlayTarget(target, overlay.id) !== 'outside') return;
      setOpenPanel(null);
    };

    document.addEventListener('mousedown', handleOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
    };
  }, [overlay.id]);

  useEffect(() => {
    if (renderPanel !== 'model') {
      return;
    }
    const shouldAutoFocus = localStorage.getItem('enable_auto_focus_model_search') !== 'false';
    if (!shouldAutoFocus) {
      return;
    }
    const timer = setTimeout(() => modelSearchInputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [renderPanel]);

  return (
    <div ref={containerRef} className="flex w-full min-w-0 items-center gap-1">
      <div ref={modelTriggerRef} className="relative flex min-w-0 flex-1">
        <UiChipButton
          active={openPanel === 'model'}
          size="sm"
          className={`min-w-0 overflow-hidden ${chipClassName} ${modelChipClassName}`}
          onClick={(event) => {
            event.stopPropagation();
            if (openPanel === 'model') {
              setOpenPanel(null);
              return;
            }
            setModelSearchQuery('');
            setProviderFilter(selectedModel?.meta.provider ?? 'all');
            setModelPanelHeight(0);
            setModelPanelAnchor(getPanelAnchor(modelTriggerRef.current));
            setOpenPanel('model');
          }}
        >
          <span className="min-w-0 flex-1 truncate text-xs font-normal leading-none">{selectedModelName}</span>
          {selectedModel && (
            <span className={`shrink-0 text-xs leading-none text-text2`}>
              {getProviderDisplayName(selectedModel.meta.provider, i18n.language)}
            </span>
          )}
        </UiChipButton>
        {onModelChipContentWidthChange && (
          <div
            ref={modelChipMeasureRef}
            aria-hidden
            className="pointer-events-none invisible absolute left-0 top-0 inline-flex items-center gap-2 whitespace-nowrap text-xs"
          >
            <span className="text-xs font-normal leading-none">{selectedModelName}</span>
            {selectedModel && (
              <span className="text-xs leading-none text-text-soft">
                {getProviderDisplayName(selectedModel.meta.provider, i18n.language)}
              </span>
            )}
          </div>
        )}
      </div>


      {typeof document !== 'undefined' && renderPanel === 'model' && createPortal(
        <div
          ref={modelPanelRef}
          className={`${UI_TRIGGER_PANEL_GLASS_CLASS} nodrag nowheel fixed z-dropdown flex min-h-0 flex-col overflow-hidden p-2 transition-opacity duration-180 ease-out ${
            isPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          style={modelPanelPosition ? {
            left: modelPanelPosition.left,
            top: modelPanelPosition.placement === 'above' ? undefined : modelPanelPosition.top,
            bottom: modelPanelPosition.bottom,
            width: modelPanelPosition.width,
            // 首帧先按自然高度测量，再应用视口约束；否则靠近顶部时会把受限高度
            // 当成自然高度，面板无法可靠切换到下方。
            maxHeight: modelPanelHeight > 0 ? modelPanelPosition.maxHeight : undefined,
          } : undefined}
          data-model-panel-placement={modelPanelPosition?.placement}
          {...overlay.layerProps}
        >
          <UiOverlayLayerProvider id={overlay.id}>
          <ModelPickerList
            variant="floating"
            modelSearchQuery={modelSearchQuery}
            onSearchChange={setModelSearchQuery}
            searchInputRef={modelSearchInputRef}
            providerFilter={providerFilter}
            onProviderFilterChange={setProviderFilter}
            providerOptions={providerOptions}
            modelsForWidthMeasurement={providerModels}
            onPreferredWidthChange={setModelPanelContentWidth}
            filteredModels={filteredModels}
            selectedModel={selectedModelOption}
            emptyMessage={!hasCompatibleModels && modelPolicy
              ? t('modelParams.noCompatibleModels', {
                defaultValue: '当前能力没有兼容的模型，请检查供应商或模型配置',
              })
              : undefined}
            revealSelectedModel={openPanel === 'model'}
            onModelChange={(nextModelId) => {
              onModelChange(nextModelId);
              setOpenPanel(null);
            }}
          />
          </UiOverlayLayerProvider>
        </div>,
        document.body
      )}

    </div>
  );
});

NodeModelParamsControls.displayName = 'NodeModelParamsControls';
