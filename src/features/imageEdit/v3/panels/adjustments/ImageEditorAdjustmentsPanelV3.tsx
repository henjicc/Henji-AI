import { ArrowDown, ArrowUp, MoreHorizontal, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';
import { Dropdown, PanelTrigger, UiButton, UiEmpty, UiError, UiFormRow, UiGroup, UiIconButton, UiLoading, UiModal, UiOptionButton, UiSwitch } from '@/components/ui';
import Tooltip from '@/components/ui/Tooltip';
import { listImageEditFilterChoicesV3 } from '../../filterWorkspace/catalog';
import { addImageEditFilterV3, changeImageEditFilterV3, prepareImageEditFilterConversionV3, commitImageEditFilterConversionV3 } from '../../filterWorkspace/service';
import { imageEditFilterParameterAdapterV3, imageEditFilterMixPreviewV3 } from '../../filterWorkspace/parameterAdapter';
import { ImageEditorEffectParametersV3 } from '../../editor/ImageEditorEffectParametersV3';
import { findImageEditLayerLocationV3 } from '../../editor/layerTreeV3';
import { requireImageEditDocumentInstanceV3 } from '../../application/imageEditDocumentInstances';
import { useImageEditorSessionStoreV3 } from '../../store';
import type { ImageEditorPanelContextV3 } from '../../panelFramework/panelRegistry';
import { FilterBlendControlsV3 } from './FilterBlendControlsV3';
import { useImageEditorShellV3 } from '../../shell/ImageEditorShellContextV3';
import { showImageEditorPanelV3 } from '../../panelFramework/layout';

const EMPTY_IDS: readonly string[] = [];
export function ImageEditorAdjustmentsPanelV3({ controller, visible }: ImageEditorPanelContextV3): JSX.Element {
  const { t } = useTranslation('ui');
  const shell = useImageEditorShellV3();
  const selectedIds = useImageEditorSessionStoreV3(state => state.sessions[controller.sessionId]?.selectedLayerIds ?? EMPTY_IDS);
  const location = selectedIds.length === 1 ? findImageEditLayerLocationV3(controller.document.layers, selectedIds[0]) : null;
  const layer = location?.layer;
  const [scope, setScope] = useState<'content' | 'below'>('content');
  const [selectedFilter, setSelectedFilter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conversion, setConversion] = useState<ReturnType<typeof prepareImageEditFilterConversionV3> | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const job = useRef<AbortController | null>(null);
  const choices = useMemo(() => listImageEditFilterChoicesV3(controller.profile), [controller.profile]);
  useEffect(() => { setSelectedFilter(null); setError(null); setConversion(null); return () => job.current?.abort(); }, [controller.sessionId, layer?.id]);
  useEffect(() => { if (!visible) job.current?.abort(); }, [visible]);
  const locked = !layer || layer.locked || Boolean(location?.ancestors.some(ancestor => ancestor.locked));
  const filterLayer = layer?.type === 'effect' || layer?.type === 'adjustment';
  const filter = layer?.filters.find(item => item.id === selectedFilter);
  const adapter = useMemo(() => layer && filter ? imageEditFilterParameterAdapterV3(controller, layer, filter) : null, [controller, layer, filter]);
  const change = (id: string, action: Parameters<typeof changeImageEditFilterV3>[3]): void => {
    try { changeImageEditFilterV3(requireImageEditDocumentInstanceV3(controller.document.id).bus, layer!.id, id, action); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const title = (id: string, kind: 'effect' | 'adjustment'): string => {
    const choice = choices.find(item => item.id === id && item.kind === kind);
    return t(`imageEditor.v3.${kind}.${id}`, { defaultValue: choice?.title ?? t('imageEditor.v3.filterWorkspace.unavailable', { defaultValue: '不可用滤镜' }) });
  };
  const prepareConversion = (filterId?: string): void => {
    if (!layer || !location) return;
    try {
      const bus = requireImageEditDocumentInstanceV3(controller.document.id).bus;
      const target = location.container[location.index - 1];
      if (!filterId && !target) throw new Error(t('imageEditor.v3.filterWorkspace.noTarget'));
      setConversion(prepareImageEditFilterConversionV3(bus, filterId
        ? { direction: 'content-to-composite', layerId: layer.id, filterId, title: title(layer.filters.find(item => item.id === filterId)!.effectId, layer.filters.find(item => item.id === filterId)!.operationType) }
        : { direction: 'composite-to-content', layerId: layer.id, targetLayerId: target.id }));
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <section data-adjustments-panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="flex shrink-0 items-center gap-2 px-3 py-2">
      <Dropdown<'content' | 'below'> className="min-w-0 flex-1" minWidthStrategy="none"
        ariaLabel={t('imageEditor.v3.filterWorkspace.scope', { defaultValue: '滤镜作用范围' })}
        value={filterLayer ? 'below' : scope} disabled={locked || filterLayer || progress !== null}
        display={t(`imageEditor.v3.filterWorkspace.${filterLayer ? 'below' : scope}`, { defaultValue: filterLayer || scope === 'below' ? '下方合成' : '当前图层' })}
        options={[{ value: 'content', label: t('imageEditor.v3.filterWorkspace.content', { defaultValue: '当前图层' }) }, { value: 'below', label: t('imageEditor.v3.filterWorkspace.below', { defaultValue: '下方合成' }) }]} onSelect={setScope} />
      <PanelTrigger panelWidth={240} panelPadding="menu" closeOnPanelClick renderPanel={() => <div role="menu" className="flex flex-col gap-2">
        {(['adjustment', 'effect'] as const).map(kind => <UiGroup key={kind} titleTone="compact" title={t(`imageEditor.v3.filterWorkspace.${kind}Library`, { defaultValue: kind === 'adjustment' ? '颜色调整' : '空间滤镜' })}>
          <div className="flex w-full flex-col gap-1">
          {choices.filter(choice => choice.kind === kind).map(choice => <Tooltip key={choice.id} content={choice.available ? null : choice.reason ?? t('imageEditor.v3.filterWorkspace.unavailable')}><span className="flex" tabIndex={choice.available ? undefined : 0}><UiOptionButton role="menuitem" variant="menu" size="sm" disabled={!choice.available}
            onClick={() => {
              if (!layer || locked || job.current) return;
              const abort = new AbortController(); job.current = abort; setProgress(0); setError(null);
              void Promise.resolve().then(() => addImageEditFilterV3(requireImageEditDocumentInstanceV3(controller.document.id).bus, layer.id, choice, filterLayer ? 'below' : scope, title(choice.id, choice.kind),
                { signal: abort.signal, onProgress: (done, total) => { if (job.current === abort) setProgress(total ? done / total : 0); } }))
                .then(id => {
                  if (job.current !== abort || abort.signal.aborted) return;
                  if (scope === 'content' && !filterLayer) setSelectedFilter(id);
                  else useImageEditorSessionStoreV3.getState().setSelectedLayerIds(controller.sessionId, [id]);
                })
                .catch(cause => { if (job.current === abort && !abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); })
                .finally(() => { if (job.current === abort) { job.current = null; setProgress(null); } });
            }}>{title(choice.id, choice.kind)}</UiOptionButton></span></Tooltip>)}
          </div>
        </UiGroup>)}
      </div>}>
        {({ open, togglePanel }) => <UiIconButton size="md" aria-label={t('imageEditor.v3.filterWorkspace.add', { defaultValue: '添加滤镜或调整' })} disabled={locked || progress !== null || !choices.length} aria-expanded={open} aria-haspopup="menu" onClick={togglePanel}><Plus className="h-4 w-4" /></UiIconButton>}
      </PanelTrigger>
    </div>
    <UiModal isOpen={Boolean(conversion)} title={t('imageEditor.v3.filterWorkspace.convertTitle')} onClose={() => setConversion(null)} footer={<>
      <UiButton onClick={() => setConversion(null)}>{t('imageEditor.v3.filterWorkspace.cancel')}</UiButton>
      <UiButton variant="primary" onClick={() => {
        if (!conversion) return;
        try {
          commitImageEditFilterConversionV3(requireImageEditDocumentInstanceV3(controller.document.id).bus, conversion);
          useImageEditorSessionStoreV3.getState().setSelectedLayerIds(controller.sessionId, [conversion.resultLayerId]);
          setSelectedFilter(conversion.resultFilterId); setConversion(null); setError(null);
        } catch (cause) { setConversion(null); setError(cause instanceof Error ? cause.message : String(cause)); }
      }}>{t('imageEditor.v3.filterWorkspace.convertConfirm')}</UiButton>
    </>}>
      {conversion && <div className="flex flex-col gap-3 text-sm text-text2">
        <p>{t('imageEditor.v3.filterWorkspace.beforeScope', { names: conversion.beforeTargets.join('、') })}</p>
        <p>{t('imageEditor.v3.filterWorkspace.afterScope', { names: conversion.afterTargets.join('、') })}</p>
        {conversion.changesOrder && <p>{t('imageEditor.v3.filterWorkspace.orderNotice')}</p>}
      </div>}
    </UiModal>
    {error && <UiError size="sm" message={error} actions={<UiButton onClick={() => setError(null)}>{t('imageEditor.v3.filterWorkspace.dismiss', { defaultValue: '关闭提示' })}</UiButton>} />}
    {progress !== null && <UiLoading size="sm" message={t('imageEditor.v3.filterWorkspace.preparing', { defaultValue: '正在应用选区' })}>
      <UiButton onClick={() => job.current?.abort()}>{t('imageEditor.v3.filterWorkspace.cancel', { defaultValue: '取消' })}</UiButton>
    </UiLoading>}
    {!layer ? <UiEmpty size="sm" title={t('imageEditor.v3.filterWorkspace.select', { defaultValue: '选择一个图层以添加滤镜或调整' })} /> :
      <div className="flex min-h-0 flex-1 flex-col">
        {filterLayer ? <UiEmpty size="sm" title={t('imageEditor.v3.filterWorkspace.scopeNotice', { defaultValue: '作用于同组下方的合成画面' })}
          action={<UiButton disabled={!shell.api} onClick={() => {
            if (!shell.api) return;
            const definition = shell.panels.find(panel => panel.id === 'properties');
            if (definition) showImageEditorPanelV3(shell.api, definition, t(definition.titleKey, { defaultValue: definition.title }));
          }}>{t('imageEditor.v3.filterWorkspace.editLayerParameters', { defaultValue: '编辑图层参数' })}</UiButton>} /> : <>
          {!layer.filters.length ? <UiEmpty size="sm" title={t('imageEditor.v3.filterWorkspace.empty', { defaultValue: '当前图层还没有滤镜' })} /> :
            <div className={filter ? 'h-32 shrink-0' : 'min-h-0 flex-1'}><Virtuoso className="h-full" data={layer.filters} computeItemKey={(_index, item) => item.id}
              itemContent={(index, item) => <div data-filter-row={item.id} className="flex items-center gap-1 px-3 py-1">
                <UiSwitch aria-label={t('imageEditor.v3.filterWorkspace.enabled', { defaultValue: '启用{{title}}', title: title(item.effectId, item.operationType) })} checked={item.enabled} disabled={locked} onCheckedChange={enabled => change(item.id, { kind: 'update', patch: { enabled } })} />
                <UiOptionButton variant="menu" size="sm" className="min-w-0 flex-1" title={title(item.effectId, item.operationType)} active={filter?.id === item.id} onClick={() => setSelectedFilter(item.id)}><span className="truncate">{title(item.effectId, item.operationType)}</span></UiOptionButton>
                <PanelTrigger panelPadding="menu" panelWidth={180} closeOnPanelClick renderPanel={() => <div role="menu" className="flex flex-col gap-1">
                  <UiOptionButton variant="menu" size="sm" role="menuitem" disabled={locked || index === 0} onClick={() => change(item.id, { kind: 'move', index: index - 1 })}><ArrowUp className="h-3.5 w-3.5" />{t('imageEditor.v3.filterWorkspace.earlier', { defaultValue: '提前执行' })}</UiOptionButton>
                  <UiOptionButton variant="menu" size="sm" role="menuitem" disabled={locked || index === layer.filters.length - 1} onClick={() => change(item.id, { kind: 'move', index: index + 1 })}><ArrowDown className="h-3.5 w-3.5" />{t('imageEditor.v3.filterWorkspace.later', { defaultValue: '延后执行' })}</UiOptionButton>
                  <UiOptionButton variant="menu" size="sm" role="menuitem" disabled={locked} onClick={() => prepareConversion(item.id)}>{t('imageEditor.v3.filterWorkspace.convertComposite')}</UiOptionButton>
                  <UiOptionButton variant="menu" size="sm" role="menuitem" disabled={locked} onClick={() => change(item.id, { kind: 'remove' })}><Trash2 className="h-3.5 w-3.5" />{t('imageEditor.v3.filterWorkspace.remove', { defaultValue: '删除滤镜' })}</UiOptionButton>
                </div>}>
                  {({ open, togglePanel }) => <UiIconButton size="sm" on={open} aria-haspopup="menu" aria-expanded={open} aria-label={t('imageEditor.v3.filterWorkspace.actions', { defaultValue: '滤镜操作' })} onClick={togglePanel}><MoreHorizontal className="h-3.5 w-3.5" /></UiIconButton>}
                </PanelTrigger>
              </div>} /></div>}
          {filter && adapter && <div data-filter-parameters className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <UiGroup titleTone="compact" title={title(filter.effectId, filter.operationType)}>
              <FilterBlendControlsV3 key={filter.id} preview={imageEditFilterMixPreviewV3(controller, layer, filter.id, `filter-mix:${layer.id}:${filter.id}`)} filter={filter} disabled={locked} onChange={patch => change(filter.id, { kind: 'update', patch })} />
              {filter.mask && <UiFormRow density="compact" label={t('imageEditor.v3.filterWorkspace.mask', { defaultValue: '局部蒙版' })} inline>
                <UiIconButton size="sm" disabled={locked} aria-label={t('imageEditor.v3.filterWorkspace.removeMask', { defaultValue: '移除滤镜蒙版' })} onClick={() => change(filter.id, { kind: 'update', patch: { mask: null } })}><X className="h-3.5 w-3.5" /></UiIconButton>
              </UiFormRow>}
              <ImageEditorEffectParametersV3 key={`${layer.id}:${filter.id}`} controller={adapter.controller} layer={adapter.layer} disabled={locked} />
            </UiGroup>
          </div>}
        </>}
        {filterLayer && <UiButton size="sm" disabled={locked} onClick={() => prepareConversion()}>{t('imageEditor.v3.filterWorkspace.convertContent')}</UiButton>}
      </div>}
  </section>;
}
