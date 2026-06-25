import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Sparkles, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { registry } from '@/core/ModelRegistry';
import { getI18nText } from '@/core/types/I18nText';
import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution';
import ParameterPanel from '@/components/MediaGenerator/components/ParameterPanel';
import { UiChipButton, UiOptionButton, UiPanel } from '@/components/ui';
import {
  getProviderDisplayName,
  type CanvasModelMediaType,
} from '@/features/canvas/domain/defaultModels';
import { useNodeModelParams } from './useNodeModelParams';

interface NodeModelParamsControlsProps {
  mediaType: CanvasModelMediaType;
  modelId: string;
  storedParams: Record<string, unknown> | undefined;
  onModelChange: (modelId: string) => void;
  onParamsChange: (nextParams: Record<string, unknown>) => void;
  /** 上游连线输入的图片（用于智能宽高比预览与联动） */
  incomingImages?: string[];
  chipClassName?: string;
  modelChipClassName?: string;
  paramsChipClassName?: string;
  /** 是否显示参数浮层 chip（逐行渲染模式下置 false，仅保留模型选择） */
  showParamsChip?: boolean;
}

interface PanelAnchor {
  left: number;
  top: number;
}

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

export const NodeModelParamsControls = memo(({
  mediaType,
  modelId,
  storedParams,
  onModelChange,
  onParamsChange,
  incomingImages = [],
  chipClassName = '',
  modelChipClassName = 'max-w-[260px] justify-start',
  paramsChipClassName = 'max-w-[120px] justify-start',
  showParamsChip = true,
}: NodeModelParamsControlsProps) => {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLDivElement>(null);
  const paramsTriggerRef = useRef<HTMLDivElement>(null);
  const modelPanelRef = useRef<HTMLDivElement>(null);
  const paramsPanelRef = useRef<HTMLDivElement>(null);
  const [openPanel, setOpenPanel] = useState<'model' | 'params' | null>(null);
  const [renderPanel, setRenderPanel] = useState<'model' | 'params' | null>(null);
  const [isPanelVisible, setIsPanelVisible] = useState(false);
  const [modelPanelAnchor, setModelPanelAnchor] = useState<PanelAnchor | null>(null);
  const [paramsPanelAnchor, setParamsPanelAnchor] = useState<PanelAnchor | null>(null);

  const models = useMemo(() => registry.getModelsByType(mediaType), [mediaType]);
  const selectedModel = useMemo(
    () => registry.getModel(modelId) ?? models[0],
    [modelId, models]
  );
  const selectedModelName = selectedModel
    ? getI18nText(selectedModel.meta.name, i18n.language) || selectedModel.meta.id
    : modelId;

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

  return (
    <div ref={containerRef} className="flex items-center gap-1">
      <div ref={modelTriggerRef} className="relative flex">
        <UiChipButton
          active={openPanel === 'model'}
          className={`${chipClassName} ${modelChipClassName}`}
          onClick={(event) => {
            event.stopPropagation();
            if (openPanel === 'model') {
              setOpenPanel(null);
              return;
            }
            setModelPanelAnchor(getPanelAnchor(modelTriggerRef.current));
            setOpenPanel('model');
          }}
        >
          <Sparkles className="h-3 w-3 shrink-0" />
          <span className="min-w-0 truncate text-xs font-normal leading-none">{selectedModelName}</span>
          {selectedModel && (
            <span className="shrink-0 text-xs leading-none text-text-muted/80">
              {getProviderDisplayName(selectedModel.meta.provider)}
            </span>
          )}
        </UiChipButton>
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
          className={`nodrag nowheel fixed z-[80] transition-opacity duration-200 ease-out ${
            isPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          style={buildPanelStyle(modelPanelAnchor)}
        >
          <UiPanel className="w-[360px] p-2">
            <div className="ui-scrollbar max-h-[300px] space-y-1 overflow-y-auto pr-1">
              {models.map((model) => {
                const active = model.meta.id === selectedModel?.meta.id;
                const displayName = getI18nText(model.meta.name, i18n.language) || model.meta.id;

                return (
                  <UiOptionButton
                    key={model.meta.id}
                    active={active}
                    className={`w-full items-start gap-3 rounded-lg px-3 py-2 ${
                      active ? '' : '!border-transparent !bg-transparent hover:!border-transparent hover:!bg-layer'
                    }`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onModelChange(model.meta.id);
                      setOpenPanel(null);
                    }}
                  >
                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted ${active ? 'bg-white/15 text-white' : 'bg-bg-dark'}`}>
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-sm ${active ? 'text-white' : 'text-text-dark'}`}>{displayName}</div>
                      <div className={`truncate text-xs ${active ? 'text-white/70' : 'text-text-muted'}`}>
                        {getProviderDisplayName(model.meta.provider)}
                        {model.meta.description ? ` · ${model.meta.description}` : ''}
                      </div>
                    </div>
                    {active && <Check className="mt-0.5 h-4 w-4 shrink-0 text-white" />}
                  </UiOptionButton>
                );
              })}
            </div>
          </UiPanel>
        </div>,
        document.body
      )}

      {typeof document !== 'undefined' && renderPanel === 'params' && selectedModel && createPortal(
        <div
          ref={paramsPanelRef}
          className={`nodrag nowheel fixed z-[80] transition-opacity duration-200 ease-out ${
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
