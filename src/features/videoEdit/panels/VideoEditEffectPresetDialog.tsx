import { useState } from 'react'
import { UiButton, UiCheckbox, UiError, UiFormRow, UiGroup, UiInput, UiModal, UiSwitch } from '@/components/ui'
import { videoEditEffectMedia, type VideoEditEffect } from '@/core/videoEdit/compositing'
import { useVideoEditEffectLibraryStore, videoEditStylePieceEffectCopies } from '../application/videoEditEffectPresets'
import { saveVideoEditStylePieceFromEffects } from '../application/videoEditStyleCode'
import { elementOfEventTarget } from '@/utils/crossRealmDom'

type Props = { initialName: string; onClose: () => void } & ({ projectId: string; effects: readonly VideoEditEffect[]; presetId?: undefined } | { presetId: string; projectId?: undefined; effects?: undefined })

/** 保存风格件（代码滤镜连同固定源码一起保存）与重命名共用一个对话框。 */
export function VideoEditEffectPresetDialog({ projectId, effects, presetId, initialName, onClose }: Props): React.ReactElement {
  const [name, setName] = useState(initialName)
  const [selection, setSelection] = useState(() => new Set(effects?.map(effect => effect.id)))
  const selectedEffects = effects?.filter(effect => selection.has(effect.id)) ?? []
  const [includeShapes, setIncludeShapes] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const canSave = !!name.trim() && (!!presetId || selectedEffects.length > 0)
  const save = async (): Promise<void> => {
    if (!canSave || saving) return
    setSaving(true)
    try {
      if (presetId) useVideoEditEffectLibraryStore.getState().renamePreset(presetId, name)
      else {
        const copies = videoEditStylePieceEffectCopies(selectedEffects, includeShapes)
        await saveVideoEditStylePieceFromEffects(projectId!, { name, media: videoEditEffectMedia(copies[0]), effects: copies, description: '', usage: '', knobs: [] })
      }
      onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setSaving(false) }
  }
  const tracked = selectedEffects.some(effect => effect.mask?.regionId === 'tracker' || effect.mask?.regionId === 'shapes' && effect.mask.shapes.some(shape => shape.follow))
  return <UiModal isOpen title={presetId ? '重命名风格件' : '保存为风格件'} size="compact" onClose={onClose} footer={<><UiButton disabled={saving} onClick={onClose}>取消</UiButton><UiButton variant="primary" loading={saving} disabled={!canSave} disabledReason={!name.trim() ? '先填写名称' : '至少勾选一个效果'} onClick={() => { void save() }}>保存</UiButton></>}>
    <div className="flex flex-col gap-3" onKeyDown={event => { if (event.key === 'Enter' && elementOfEventTarget(event.target)?.tagName === 'INPUT') { event.preventDefault(); event.stopPropagation(); void save() } }}>
      <UiFormRow label="名称"><UiInput autoFocus aria-label="风格件名称" value={name} maxLength={200} disabled={saving} onChange={event => setName(event.target.value)} /></UiFormRow>
      {!presetId && <UiGroup role="group" aria-label="要保存的效果" title="要保存的效果" titleTone="compact" info={tracked ? '风格件不保存跟踪绑定；应用到新片段后需重新跟踪。' : undefined}>
        {effects?.map(effect => <UiFormRow key={effect.id} label={effect.name} inline density="compact"><UiCheckbox aria-label={`保存效果：${effect.name}`} checked={selection.has(effect.id)} disabled={saving} onCheckedChange={checked => setSelection(previous => { const next = new Set(previous); if (checked) next.add(effect.id); else next.delete(effect.id); return next })} /></UiFormRow>)}
      </UiGroup>}
      {selectedEffects.some(effect => effect.mask?.regionId === 'shapes') && <UiFormRow label="保存手绘遮罩" info="保存遮罩形状、羽化与扩展；在新片段上使用相同的相对位置。"><UiSwitch aria-label="保存手绘遮罩" checked={includeShapes} disabled={saving} onCheckedChange={setIncludeShapes} /></UiFormRow>}
      {error && <UiError size="xs" title={error} message="" />}
    </div>
  </UiModal>
}
