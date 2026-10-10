import { FileImage, RefreshCw, Layers, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { UiButton, UiGroup, UiError, Dropdown } from '@/components/ui';
import { listDocuments } from '@/commands/documents';
import type { ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes';
import { useSmartContentV3 } from './SmartContentContext';

export function SmartContentPropertiesV3({ layer, disabled }: { layer: ImageEditLayerV3; disabled: boolean }): JSX.Element | null {
  const view = useSmartContentV3();
  const [sources, setSources] = useState<{ label: string; value: string }[]>([]);
  const [sourceError, setSourceError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (layer.type === 'smart') void listDocuments({ kind: 'image_document' }).then(documents => {
      if (alive) setSources(documents.map(document => ({ label: document.name, value: document.id })));
    }).catch(() => { if (alive) setSourceError('图片来源暂时无法读取，请稍后重试'); });
    return () => { alive = false; };
  }, [layer.type]);
  if (!view || (layer.type !== 'raster' && layer.type !== 'smart')) return null;
  return <UiGroup title="智能对象" titleTone="compact" gap="stack">
    {layer.type === 'raster' ? <UiButton variant="secondary" disabled={disabled || view.busy} onClick={() => { void view.convert(layer.id, 'smart'); }}><FileImage className="h-4 w-4" />转换为智能对象</UiButton> : <>
      <p className="text-xs leading-relaxed text-text2">{layer.content.origin ? '受管理来源 · 更新时同步本图片中的关联实例' : '嵌入内容 · 保存时与原图片一起保存'}</p>
      <UiButton variant="secondary" disabled={disabled || view.busy} onClick={() => view.open(layer.id)}><Layers className="h-4 w-4" />打开内容</UiButton>
      {layer.content.origin ? <UiButton disabled={disabled || view.busy} onClick={() => { void view.refresh(layer.id); }}><RefreshCw className="h-4 w-4" />从来源刷新</UiButton> : null}
      <Dropdown<string> ariaLabel="选择图片文档来源" value="" display="从图片文档替换来源" className="w-full" minWidthStrategy="none" disabled={disabled || view.busy}
        options={sources} onSelect={id => { void view.refresh(layer.id, { kind: 'image_edit.document', id: `v3:${encodeURIComponent(id)}` }); }} />
      {!sources.length && !sourceError ? <p className="text-xs text-text3">还没有可用的图片文档，可继续编辑嵌入内容。</p> : null}
      <UiButton disabled={disabled || view.busy} onClick={() => { void view.convert(layer.id, 'raster'); }}><FileImage className="h-4 w-4" />栅格化内容</UiButton>
    </>}
    {view.busy ? <div role="status" className="flex items-center gap-2 text-xs text-text2">{!view.canCancel ? '正在保存内容' : view.progress === null ? '正在更新内容' : `正在更新内容 ${view.progress}%`}{view.canCancel ? <UiButton onClick={view.cancel}><X className="h-3 w-3" />取消</UiButton> : null}</div> : null}
    {view.error || sourceError ? <UiError size="sm" message={view.error ?? sourceError ?? ''} /> : null}
  </UiGroup>;
}
