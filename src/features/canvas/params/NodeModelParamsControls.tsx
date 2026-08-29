import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ModelTag } from '@/core/types';
import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution';
import ParameterPanel from '@/components/MediaGenerator/components/ParameterPanel';
import { UiChipButton, UiPanel } from '@/components/ui';
import type { CanvasModelMediaType } from '@/features/canvas/domain/defaultModels';
import type { CanvasImageCapabilityModelPolicy } from '@/features/canvas/capabilities/types';
import { getI18nText } from '@/core/types/I18nText';
import { UI_TRIGGER_PANEL_CLASS } from '@/components/ui/styleTokens';
import {
  resolveFloatingPanelPosition,
  type FloatingPanelAnchorRect,
  type FloatingPanelPosition,
} from '@/components/ui/floatingPanelPosition';
import { getProviderDisplayName } from '@/utils/modelHelpers';
import { ModelPickerList } from './ModelPickerList';
import { useModelPickerList } from './useModelPickerList';
import { useNodeModelParams } from './useNodeModelParams';

interface NodeModelParamsControlsProps {
  mediaType: CanvasModelMediaType;
  modelId: string;
  storedParams: DynamicValueMap | undefined;
  onModelChange: (modelId: string) => void;
  onParamsChange: (nextParams: DynamicValueMap) => void;
  /** 上游连线输入的图片（用于智能宽高比预览与联动） */
  incomingImages?: string[];
  /** 限定可选模型必须同时具备的标签（如仅展示支持图片编辑的模型） */
  requiredTags?: ModelTag[];
  /** 能力级模型家族、供应商组合与语义参数约束 */
  modelPolicy?: CanvasImageCapabilityModelPolicy;
  chipClassName?: string;
  modelChipClassName?: string;
  paramsChipClassName?: string;
  /** 是否显示参数浮层 chip（逐行渲染模式下置 false，仅保留模型选择） */
  showParamsChip?: boolean;
  /** 模型 chip 内容（名称+供应商）的实际像素宽度变化回调，用于驱动节点最小宽度随内容自适应 */
  onModelChipContentWidthChange?: (width: number) => void;
}

const MODEL_PANEL_FALLBACK_CONTENT_WIDTH = 302;
const MODEL_PANEL_HORIZONTAL_CHROME = 18;
const MODEL_PANEL_VIEWPORT_GUTTER = 12;
const MODEL_PANEL_VIEWPORT_TOP_INSET = 48;
const MODEL_PANEL_GAP = 8;
const PARAMS_PANEL_WIDTH = 440;

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
  storedParams,
  onModelChange,
  onParamsChange,
  incomingImages = [],
  requiredTags = [],
  modelPolicy,
  chipClassName = '',
  modelChipClassName = 'max-w-[260px] justify-start',
  paramsChipClassName = 'max-w-[120px] justify-start',
  showParamsChip = true,
  onModelChipContentWidthChange,
}: NodeModelParamsControlsProps) => {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLDivElement>(null);
  const modelChipMeasureRef = useRef<HTMLDivElement>(null);
  const paramsTriggerRef = useRef<HTMLDivElement>(null);
  const modelPanelRef = useRef<HTMLDivElement>(null);
  const paramsPanelRef = useRef<HTMLDivElement>(null);
  const modelSearchInputRef = useRef<HTMLInputElement>(null);
  const [openPanel, setOpenPanel] = useState<'model' | 'params' | null>(null);
  const [renderPanel, setRenderPanel] = useState<'model' | 'params' | null>(null);
  const [isPanelVisible, setIsPanelVisible] = useState(false);
  const [modelPanelAnchor, setModelPanelAnchor] = useState<FloatingPanelAnchorRect | null>(null);
  const [paramsPanelAnchor, setParamsPanelAnchor] = useState<FloatingPanelAnchorRect | null>(null);
  const [modelPanelContentWidth, setModelPanelContentWidth] = useState(0);
  const [modelPanelHeight, setModelPanelHeight] = useState(0);
  const [paramsPanelHeight, setParamsPanelHeight] = useState(0);
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
  const paramsPanelPosition = useMemo(
    () => resolvePanelPosition(
      paramsPanelAnchor,
      PARAMS_PANEL_WIDTH,
      paramsPanelHeight,
      viewportSize.width,
      viewportSize.height,
    ),
    [paramsPanelAnchor, paramsPanelHeight, viewportSize.height, viewportSize.width],
  );

  const { schema, values, setParam, setParams } = useNodeModelParams({
    modelId: selectedModel?.meta.id ?? modelId,
    storedParams,
    onParamsChange,
  });

  // 参数 chip 摘要：优先显示宽高比/分辨率参数当前值
  const paramsSummary = useMemo(() => {
    const spec = analyzeRatioResolutionParams(schema, incomingImages);
    const parts: string[] = [];
    for (const descriptor of [spec?.aspectParam, spec?.resolutionParam]) {
      if (!descriptor) {
        continue;
      }
      const currentValue = values[descriptor.id];
      const matched = descriptor.options.find((option) => option.value === currentValue);
      if (matched) {
        const label = getI18nText(matched.label, i18n.language);
        if (label) {
          parts.push(label);
        }
      }
    }
    return parts;
  }, [i18n.language, incomingImages, schema, values]);

  const hasConfigurableParams = showParamsChip && schema.length > 0;

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
      if (renderPanel === 'model') {
        setModelPanelAnchor(getPanelAnchor(modelTriggerRef.current));
      } else {
        setParamsPanelAnchor(getPanelAnchor(paramsTriggerRef.current));
      }
    };

    const handleScroll = (event: Event): void => {
      const target = event.target;
      if (
        target instanceof globalThis.Node
        && (modelPanelRef.current?.contains(target) || paramsPanelRef.current?.contains(target))
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
    const panel = renderPanel === 'model' ? modelPanelRef.current : paramsPanelRef.current;
    if (!panel || !renderPanel) return;

    const measure = (): void => {
      const height = Math.max(panel.scrollHeight, panel.getBoundingClientRect().height);
      if (renderPanel === 'model') {
        // 面板受视口 max-height 约束后，真正滚动的是内部模型列表。这里保留首次测得的
        // 自然高度，避免 ResizeObserver 把受限高度写回后误判为“上方已放得下”。
        setModelPanelHeight((current) => Math.max(current, height));
      } else {
        setParamsPanelHeight((current) => current === height ? current : height);
      }
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
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as globalThis.Node;
      if (containerRef.current?.contains(target)) return;
      if (modelPanelRef.current?.contains(target)) return;
      if (paramsPanelRef.current?.contains(target)) return;
      setOpenPanel(null);
    };

    document.addEventListener('mousedown', handleOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
    };
  }, []);

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
            <span className={`shrink-0 text-xs leading-none ${openPanel === 'model' ? 'text-white/90' : 'text-text-soft'}`}>
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

      {hasConfigurableParams && (
        <div ref={paramsTriggerRef} className="relative flex">
          <UiChipButton
            active={openPanel === 'params'}
            className={`${chipClassName} ${paramsChipClassName}`}
            onClick={(event) => {
              event.stopPropagation();
              if (openPanel === 'params') {
                setOpenPanel(null);
                return;
              }
              setParamsPanelAnchor(getPanelAnchor(paramsTriggerRef.current));
              setParamsPanelHeight(0);
              setOpenPanel('params');
            }}
          >
            <SlidersHorizontal className="h-2.5 w-2.5 shrink-0" />
            {paramsSummary.length > 0 ? (
              <>
                <span className="truncate text-xs leading-none">{paramsSummary[0]}</span>
                {paramsSummary[1] && (
                  <span className="text-xs leading-none text-text-soft">· {paramsSummary[1]}</span>
                )}
              </>
            ) : (
              <span className="truncate text-xs leading-none">{t('modelParams.title')}</span>
            )}
          </UiChipButton>
        </div>
      )}

      {typeof document !== 'undefined' && renderPanel === 'model' && createPortal(
        <div
          ref={modelPanelRef}
          className={`${UI_TRIGGER_PANEL_CLASS} nodrag nowheel fixed z-dropdown flex min-h-0 flex-col overflow-hidden p-2 transition-opacity duration-200 ease-out ${
            isPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          style={modelPanelPosition ? {
            left: modelPanelPosition.left,
            top: modelPanelPosition.top,
            width: modelPanelPosition.width,
            // 首帧先按自然高度测量，再应用视口约束；否则靠近顶部时会把受限高度
            // 当成自然高度，面板无法可靠切换到下方。
            maxHeight: modelPanelHeight > 0 ? modelPanelPosition.maxHeight : undefined,
          } : undefined}
          data-model-panel-placement={modelPanelPosition?.placement}
        >
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
        </div>,
        document.body
      )}

      {typeof document !== 'undefined' && renderPanel === 'params' && selectedModel && createPortal(
        <div
          ref={paramsPanelRef}
          className={`ui-scrollbar nodrag nowheel fixed z-dropdown transition-opacity duration-200 ease-out ${
            isPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          style={paramsPanelPosition ? {
            left: paramsPanelPosition.left,
            top: paramsPanelPosition.top,
            width: paramsPanelPosition.width,
            maxHeight: paramsPanelPosition.maxHeight,
            overflowY: 'auto',
          } : undefined}
          data-params-panel-placement={paramsPanelPosition?.placement}
        >
          <UiPanel className="w-full p-3">
            <div className="ui-scrollbar max-h-[360px] overflow-y-auto pr-1">
              <ParameterPanel
                currentModel={selectedModel}
                selectedModel={selectedModel.meta.id}
                uploadedImages={incomingImages}
                uploadedVideos={[]}
                values={values}
                onChange={setParam}
                onChanges={setParams}
              />
            </div>
          </UiPanel>
        </div>,
        document.body
      )}
    </div>
  );
});

NodeModelParamsControls.displayName = 'NodeModelParamsControls';
