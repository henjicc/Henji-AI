import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AUTO_REQUEST_ASPECT_RATIO } from '@/features/canvas/domain/canvasNodes';
import {
  getModelProvider,
  type AspectRatioOption,
  type ImageModelDefinition,
  type ResolutionOption,
} from '@/features/canvas/models';
import {
  UiChipButton,
  UiPanel,
} from '@/components/ui';

interface ModelParamsControlsProps {
  imageModels: ImageModelDefinition[];
  selectedModel: ImageModelDefinition;
  selectedResolution: ResolutionOption;
  selectedAspectRatio: AspectRatioOption;
  aspectRatioOptions: AspectRatioOption[];
  onModelChange: (modelId: string) => void;
  onResolutionChange: (resolution: string) => void;
  onAspectRatioChange: (aspectRatio: string) => void;
  showProviderName?: boolean;
  triggerSize?: 'md' | 'sm';
  chipClassName?: string;
  modelChipClassName?: string;
  paramsChipClassName?: string;
  modelPanelAlign?: 'center' | 'start';
  paramsPanelAlign?: 'center' | 'start';
  modelPanelClassName?: string;
  paramsPanelClassName?: string;
}

interface PanelAnchor {
  left: number;
  top: number;
}

function NanoBananaIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M1.5 19.824c0-.548.444-.992.991-.992h.744a.991.991 0 010 1.983H2.49a.991.991 0 01-.991-.991z" fill="#F3AD61" />
      <path d="M14.837 13.5h7.076c.522 0 .784-.657.413-1.044l-1.634-1.704a3.183 3.183 0 00-4.636 0l-1.633 1.704c-.37.385-.107 1.044.414 1.044zM3.587 13.5h7.076c.521 0 .784-.659.414-1.044l-1.635-1.704a3.183 3.183 0 00-4.636 0l-1.633 1.704c-.37.385-.107 1.044.414 1.044z" fill="#F9C23C" />
      <path d="M12.525 1.521c3.69-.53 5.97 8.923 4.309 12.744-1.662 3.82-5.248 4.657-9.053 6.152a3.49 3.49 0 01-1.279.244c-1.443 0-2.227 1.187-2.774-.282-.707-1.9.22-4.031 2.069-4.757 2.014-.79 3.084-2.308 3.89-4.364.82-2.096.877-2.956.873-5.241-.003-1.827-.123-4.195 1.965-4.496z" fill="#FEEFC2" />
      <path d="M16.834 14.264l-7.095-3.257c-.815 1.873-2.29 3.308-4.156 4.043-2.16.848-3.605 3.171-2.422 5.54 2.364 4.727 13.673-.05 13.673-6.325z" fill="#FCD53F" />
      <path d="M13.68 12.362c.296.094.46.41.365.707-1.486 4.65-5.818 6.798-9.689 6.997a.562.562 0 11-.057-1.124c3.553-.182 7.372-2.138 8.674-6.216a.562.562 0 01.707-.364z" fill="#F9C23C" />
      <path d="M17.43 19.85l-7.648-8.835h6.753c1.595.08 2.846 1.433 2.846 3.073v5.664c0 .997-.898 1.302-1.95.098z" fill="#FFF478" />
    </svg>
  );
}

function getRatioPreviewStyle(ratio: string): { width: number; height: number } {
  const [rawW, rawH] = ratio.split(':').map((value) => Number(value));
  const width = Number.isFinite(rawW) && rawW > 0 ? rawW : 1;
  const height = Number.isFinite(rawH) && rawH > 0 ? rawH : 1;

  const box = 20;
  if (width >= height) {
    return {
      width: box,
      height: Math.max(8, Math.round((box * height) / width)),
    };
  }

  return {
    width: Math.max(8, Math.round((box * width) / height)),
    height: box,
  };
}

export const ModelParamsControls = memo(({
  imageModels,
  selectedModel,
  selectedResolution,
  selectedAspectRatio,
  aspectRatioOptions,
  onModelChange,
  onResolutionChange,
  onAspectRatioChange,
  showProviderName = true,
  triggerSize = 'md',
  chipClassName = '',
  modelChipClassName = 'w-[220px] justify-start',
  paramsChipClassName = 'w-[120px] justify-start',
  modelPanelAlign = 'center',
  paramsPanelAlign = 'center',
  modelPanelClassName = 'w-[360px] p-2',
  paramsPanelClassName = 'w-[420px] p-3',
}: ModelParamsControlsProps) => {
  const { t } = useTranslation();
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

  const selectedProvider = useMemo(
    () => getModelProvider(selectedModel.providerId),
    [selectedModel.providerId]
  );
  const isCompactTrigger = triggerSize === 'sm';
  const modelIconClassName = isCompactTrigger ? 'h-3 w-3 shrink-0' : 'h-4 w-4 shrink-0';
  const paramsIconClassName = isCompactTrigger ? 'h-2.5 w-2.5 shrink-0' : 'h-4 w-4 shrink-0';
  const modelTextClassName = isCompactTrigger
    ? 'min-w-0 truncate text-[10px] font-medium leading-none'
    : 'min-w-0 truncate font-medium';
  const providerTextClassName = isCompactTrigger
    ? 'shrink-0 text-[10px] leading-none text-text-muted/80'
    : 'shrink-0 text-text-muted/80';
  const paramsPrimaryTextClassName = isCompactTrigger
    ? 'truncate text-[10px] leading-none'
    : 'truncate';
  const paramsSecondaryTextClassName = isCompactTrigger
    ? 'text-[10px] leading-none text-text-muted/80'
    : 'text-text-muted/80';

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

    if (!openPanel) {
      setIsPanelVisible(false);
      switchTimer = setTimeout(() => setRenderPanel(null), animationDurationMs);
      return () => {
        if (switchTimer) {
          clearTimeout(switchTimer);
        }
        if (enterRaf1) {
          cancelAnimationFrame(enterRaf1);
        }
        if (enterRaf2) {
          cancelAnimationFrame(enterRaf2);
        }
      };
    }

    if (renderPanel && renderPanel !== openPanel) {
      setIsPanelVisible(false);
      switchTimer = setTimeout(() => {
        setRenderPanel(openPanel);
        startEnterAnimation();
      }, animationDurationMs);
      return () => {
        if (switchTimer) {
          clearTimeout(switchTimer);
        }
        if (enterRaf1) {
          cancelAnimationFrame(enterRaf1);
        }
        if (enterRaf2) {
          cancelAnimationFrame(enterRaf2);
        }
      };
    }

    if (!renderPanel) {
      setRenderPanel(openPanel);
    }
    startEnterAnimation();

    return () => {
      if (switchTimer) {
        clearTimeout(switchTimer);
      }
      if (enterRaf1) {
        cancelAnimationFrame(enterRaf1);
      }
      if (enterRaf2) {
        cancelAnimationFrame(enterRaf2);
      }
    };
  }, [openPanel, renderPanel]);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as globalThis.Node;
      if (containerRef.current?.contains(target)) {
        return;
      }
      if (modelPanelRef.current?.contains(target)) {
        return;
      }
      if (paramsPanelRef.current?.contains(target)) {
        return;
      }
      setOpenPanel(null);
    };

    document.addEventListener('mousedown', handleOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
    };
  }, []);

  const getPanelAnchor = (
    triggerElement: HTMLDivElement | null,
    align: 'center' | 'start'
  ): PanelAnchor | null => {
    if (!triggerElement) {
      return null;
    }
    const rect = triggerElement.getBoundingClientRect();
    return {
      left: align === 'center' ? rect.left + rect.width / 2 : rect.left,
      top: rect.top - 8,
    };
  };

  const buildPanelStyle = (
    anchor: PanelAnchor | null,
    align: 'center' | 'start'
  ): React.CSSProperties | undefined => {
    if (!anchor) {
      return undefined;
    }

    const xTransform = align === 'center' ? 'translateX(-50%) ' : '';
    return {
      left: anchor.left,
      top: anchor.top,
      transform: `${xTransform}translateY(-100%)`,
    };
  };

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
            setModelPanelAnchor(getPanelAnchor(modelTriggerRef.current, modelPanelAlign));
            setOpenPanel('model');
          }}
        >
          <NanoBananaIcon className={modelIconClassName} />
          <span className={modelTextClassName}>{selectedModel.displayName}</span>
          {showProviderName && (
            <span className={providerTextClassName}>{selectedProvider.name}</span>
          )}
        </UiChipButton>
      </div>

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
            setParamsPanelAnchor(getPanelAnchor(paramsTriggerRef.current, paramsPanelAlign));
            setOpenPanel('params');
          }}
        >
          <SlidersHorizontal className={paramsIconClassName} />
          <span className={paramsPrimaryTextClassName}>{selectedAspectRatio.label}</span>
          <span className={paramsSecondaryTextClassName}>· {selectedResolution.label}</span>
        </UiChipButton>
      </div>

      {typeof document !== 'undefined' && renderPanel === 'model' && createPortal(
        <div
          ref={modelPanelRef}
          className={`fixed z-[80] transition-opacity duration-200 ease-out ${isPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          style={buildPanelStyle(modelPanelAnchor, modelPanelAlign)}
        >
          <UiPanel className={modelPanelClassName}>
            <div className="ui-scrollbar max-h-[300px] space-y-1 overflow-y-auto pr-1">
              {imageModels.map((model) => {
                const provider = getModelProvider(model.providerId);
                const active = model.id === selectedModel.id;

                return (
                  <button
                    key={model.id}
                    className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${active
                      ? 'border-accent/45 bg-accent/15'
                      : 'border-transparent bg-bg-dark/70 hover:border-[rgba(255,255,255,0.14)]'
                      }`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onModelChange(model.id);
                      setOpenPanel(null);
                    }}
                  >
                    <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-bg-dark text-text-muted">
                      <NanoBananaIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-text-dark">{model.displayName}</div>
                      <div className="truncate text-xs text-text-muted">
                        {provider.name} · {model.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </UiPanel>
        </div>,
        document.body
      )}

      {typeof document !== 'undefined' && renderPanel === 'params' && createPortal(
        <div
          ref={paramsPanelRef}
          className={`fixed z-[80] transition-opacity duration-200 ease-out ${isPanelVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          style={buildPanelStyle(paramsPanelAnchor, paramsPanelAlign)}
        >
          <UiPanel className={paramsPanelClassName}>
            <div>
              <div className="mb-2 text-xs text-text-muted">{t('modelParams.quality')}</div>
              <div className="grid grid-cols-4 gap-1 rounded-xl border border-[rgba(255,255,255,0.1)] bg-bg-dark/65 p-1">
                {selectedModel.resolutions.map((item) => {
                  const active = item.value === selectedResolution.value;
                  return (
                    <button
                      key={item.value}
                      className={`h-8 rounded-lg text-sm transition-colors ${active
                        ? 'bg-surface-dark text-text-dark'
                        : 'text-text-muted hover:bg-bg-dark'
                        }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onResolutionChange(item.value);
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3">
              <div className="mb-2 text-xs text-text-muted">{t('modelParams.aspectRatio')}</div>
              <div className="grid grid-cols-5 gap-1 rounded-xl border border-[rgba(255,255,255,0.1)] bg-bg-dark/65 p-1">
                {aspectRatioOptions.map((item) => {
                  const active = item.value === selectedAspectRatio.value;
                  const previewStyle = getRatioPreviewStyle(
                    item.value === AUTO_REQUEST_ASPECT_RATIO ? '1:1' : item.value
                  );

                  return (
                    <button
                      key={item.value}
                      className={`rounded-lg px-1 py-1.5 transition-colors ${active
                        ? 'bg-surface-dark text-text-dark'
                        : 'text-text-muted hover:bg-bg-dark'
                        }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onAspectRatioChange(item.value);
                      }}
                    >
                      <div className="mb-1 flex h-6 items-center justify-center">
                        {item.value === AUTO_REQUEST_ASPECT_RATIO ? (
                          <Zap className="h-3 w-3" strokeWidth={2.4} />
                        ) : (
                          <span
                            className="inline-block rounded-[3px] border border-current/60"
                            style={previewStyle}
                          />
                        )}
                      </div>
                      <div className="text-[10px]">{item.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </UiPanel>
        </div>,
        document.body
      )}
    </div>
  );
});

ModelParamsControls.displayName = 'ModelParamsControls';
