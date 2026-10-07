import { useState } from 'react'
import { UiButton, UiCheckbox, UiError, UiFormRow, UiGroup, UiInput, UiModal, UiSwitch } from '@/components/ui'
import type { VideoEditEffect } from '@/core/videoEdit/compositing'
import { useVideoEditEffectLibraryStore } from '../application/videoEditEffectPresets'
import { elementOfEventTarget } from '@/utils/crossRealmDom'

export function VideoEditEffectPresetDialog({ effects, presetId, initialName, onClose }: { effects?: readonly VideoEditEffect[]; presetId?: string; initialName: string; onClose: () => void }): React.ReactElement {
  const [name, setName] = useState(initialName)
  const [selection, setSelection] = useState(() => new Set(effects?.map(effect => effect.id)))
  const selectedEffects = effects?.filter(effect => selection.has(effect.id)) ?? []
  const [includeShapes, setIncludeShapes] = useState(false)
  const [error, setError] = useState('')
  const canSave = !!name.trim() && (!!presetId || selectedEffects.length > 0)
  const save = (): void => {
    if (!canSave) return
    try {
      const library = useVideoEditEffectLibraryStore.getState()
      if (presetId) library.renamePreset(presetId, name)
      else library.savePreset(name, selectedEffects, includeShapes)
      onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const tracked = selectedEffects.some(effect => effect.mask?.regionId === 'tracker' || effect.mask?.regionId === 'shapes' && effect.mask.shapes.some(shape => shape.follow))
  return <UiModal isOpen title={presetId ? '重命名预设' : '保存为预设'} size="compact" onClose={onClose} footer={<><UiButton onClick={onClose}>取消</UiButton><UiButton variant="primary" disabled={!canSave} onClick={save}>保存</UiButton></>}>
    <div className="flex flex-col gap-3" onKeyDown={event => { if (event.key === 'Enter' && elementOfEventTarget(event.target)?.tagName === 'INPUT') { event.preventDefault(); event.stopPropagation(); save() } }}>
      <UiFormRow label="预设名称"><UiInput autoFocus aria-label="预设名称" value={name} maxLength={200} onChange={event => setName(event.target.value)} /></UiFormRow>
      {!presetId && <UiGroup role="group" aria-label="要保存的效果" title="要保存的效果" titleTone="compact" info={tracked ? '预设不保存跟踪绑定；应用到新片段后需重新跟踪。' : undefined}>
        {effects?.map(effect => <UiFormRow key={effect.id} label={effect.name} inline density="compact"><UiCheckbox aria-label={`保存效果：${effect.name}`} checked={selection.has(effect.id)} onCheckedChange={checked => setSelection(previous => { const next = new Set(previous); if (checked) next.add(effect.id); else next.delete(effect.id); return next })} /></UiFormRow>)}
      </UiGroup>}
      {selectedEffects.some(effect => effect.mask?.regionId === 'shapes') && <UiFormRow label="保存手绘遮罩" info="保存遮罩形状、羽化与扩展；在新片段上使用相同的相对位置。"><UiSwitch aria-label="保存手绘遮罩" checked={includeShapes} onCheckedChange={setIncludeShapes} /></UiFormRow>}
      {error && <UiError size="xs" title={error} message="" />}
    </div>
  </UiModal>
}
