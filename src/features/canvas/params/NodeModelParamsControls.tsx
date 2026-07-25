import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ModelTag } from '@/core/types';
import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution';
import ParameterPanel from '@/components/MediaGenerator/components/ParameterPanel';
import { UiChipButton, UiPanel } from '@/components/ui';
import {
  getProviderDisplayName,
  type CanvasModelMediaType,
} from '@/features/canvas/domain/defaultModels';
import { getI18nText } from '@/core/types/I18nText';
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
  chipClassName?: string;
  modelChipClassName?: string;
  paramsChipClassName?: string;
  /** 是否显示参数浮层 chip（逐行渲染模式下置 false，仅保留模型选择） */
  showParamsChip?: boolean;
  /** 模型 chip 内容（名称+供应商）的实际像素宽度变化回调，用于驱动节点最小宽度随内容自适应 */
  onModelChipContentWidthChange?: (width: number) => void;
}

interface PanelAnchor {
  left: number;
  top: number;
}

const MODEL_PANEL_FALLBACK_CONTENT_WIDTH = 302;
const MODEL_PANEL_HORIZONTAL_CHROME = 18;
const MODEL_PANEL_VIEWPORT_GUTTER = 12;

function getPanelAnchor(triggerElement: HTMLDivElement | null): PanelAnchor | null {
  if (!triggerElement) {
    return null;
  }
  const rect = triggerElement.getBoundingClientRect();
  return {
    left: rect.left + rect.width / 2,
    top: rect.top - 8,
  };
}

function buildPanelStyle(anchor: PanelAnchor | null): React.CSSProperties | undefined {
  if (!anchor) {
    return undefined;
  }
  return {
    left: anchor.left,
    top: anchor.top,
    transform: 'translateX(-50%) translateY(-100%)',
  };
}

function buildAdaptivePanelStyle(
  anchor: PanelAnchor | null,
  panelWidth: number,
  viewportWidth: number
): React.CSSProperties | undefined {
  if (!anchor) {
    return undefined;
  }
  const centeredLeft = anchor.left - panelWidth / 2;
  const maxLeft = Math.max(
    MODEL_PANEL_VIEWPORT_GUTTER,
    viewportWidth - panelWidth - MODEL_PANEL_VIEWPORT_GUTTER
  );
  return {
    left: Math.min(Math.max(MODEL_PANEL_VIEWPORT_GUTTER, centeredLeft), maxLeft),
    top: anchor.top,
    width: panelWidth,
    transform: 'translateY(-100%)',
  };
}

export const NodeModelParamsControls = memo(({
  mediaType,
  modelId,
  storedParams,
  onModelChange,
  onParamsChange,
  incomingImages = [],
  requiredTags = [],
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
  const [modelPanelAnchor, setModelPanelAnchor] = useState<PanelAnchor | null>(null);
  const [paramsPanelAnchor, setParamsPanelAnchor] = useState<PanelAnchor | null>(null);
  const [modelPanelContentWidth, setModelPanelContentWidth] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(() => (
    typeof window === 'undefined' ? 1024 : window.innerWidth
  ));
  const {
    modelSearchQuery,
    setModelSearchQuery,
    providerFilter,
    setProviderFilter,
    providerOptions,
    providerModels,
    filteredModels,
    selectedModel,
    selectedModelName,
  } = useModelPickerList({ mediaType, modelId, requiredTags });

  const desiredModelPanelWidth = (
    modelPanelContentWidth || MODEL_PANEL_FALLBACK_CONTENT_WIDTH
  ) + MODEL_PANEL_HORIZONTAL_CHROME;
  const modelPanelWidth = Math.min(
    desiredModelPanelWidth,
    Math.max(0, viewportWidth - MODEL_PANEL_VIEWPORT_GUTTER * 2)
  );

  const { schema, values, setParam } = useNodeModelParams({
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
    const handleResize = (): void => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
            setModelPanelAnchor(getPanelAnchor(modelTriggerRef.current));
            setOpenPanel('model');
          }}
        >
          <span className="min-w-0 flex-1 truncate text-xs font-normal leading-none">{selectedModelName}</span>
          {selectedModel && (
            <span className="shrink-0 text-xs leading-none text-text-muted/80">
              {getProviderDisplayName(selectedModel.meta.provider)}
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
              <span className="text-xs leading-none text-text-muted/80">
                {getProviderDisplayName(selectedModel.meta.provider)}
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
              setOpenPanel('params');
            }}
          >
            <SlidersHorizontal className="h-2.5 w-2.5 shrink-0" />
            {paramsSummary.length > 0 ? (
              <>
                <span className="truncate text-xs leading-none">{paramsSummary[0]}</span>
                {paramsSummary[1] && (
                  <span className="text-xs leading-none text-text-muted/80">· {paramsSummary[1]}</span>
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
          className={`nodrag nowheel fixed z-dropdown transition-opacity duration-200 ease-out ${
            isPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          style={buildAdaptivePanelStyle(modelPanelAnchor, modelPanelWidth, viewportWidth)}
        >
          <UiPanel className="w-full p-2">
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
              selectedModel={selectedModel}
              revealSelectedModel={openPanel === 'model'}
              onModelChange={(nextModelId) => {
                onModelChange(nextModelId);
                setOpenPanel(null);
              }}
            />
          </UiPanel>
        </div>,
        document.body
      )}

      {typeof document !== 'undefined' && renderPanel === 'params' && selectedModel && createPortal(
        <div
          ref={paramsPanelRef}
          className={`nodrag nowheel fixed z-dropdown transition-opacity duration-200 ease-out ${
            isPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          style={buildPanelStyle(paramsPanelAnchor)}
        >
          <UiPanel className="w-[440px] p-3">
            <div className="ui-scrollbar max-h-[360px] overflow-y-auto pr-1">
              <ParameterPanel
                currentModel={selectedModel}
                selectedModel={selectedModel.meta.id}
                uploadedImages={incomingImages}
                uploadedVideos={[]}
                values={values}
                onChange={setParam}
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
