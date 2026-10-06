import { useState } from 'react'
import { UiButton, UiError, UiFormRow, UiInput, UiModal, UiSwitch } from '@/components/ui'
import type { VideoEditEffect } from '@/core/videoEdit/compositing'
import { useVideoEditEffectLibraryStore } from '../application/videoEditEffectPresets'
import { elementOfEventTarget } from '@/utils/crossRealmDom'

export function VideoEditEffectPresetDialog({ effects, presetId, initialName, onClose }: { effects?: readonly VideoEditEffect[]; presetId?: string; initialName: string; onClose: () => void }): React.ReactElement {
  const [name, setName] = useState(initialName)
  const [includeShapes, setIncludeShapes] = useState(false)
  const [error, setError] = useState('')
  const save = (): void => {
    try {
      const library = useVideoEditEffectLibraryStore.getState()
      if (presetId) library.renamePreset(presetId, name)
      else library.savePreset(name, effects ?? [], includeShapes)
      onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const tracked = effects?.some(effect => effect.mask?.regionId === 'tracker' || effect.mask?.regionId === 'shapes' && effect.mask.shapes.some(shape => shape.follow))
  return <UiModal isOpen title={presetId ? '重命名预设' : '保存为预设'} size="compact" onClose={onClose} footer={<><UiButton onClick={onClose}>取消</UiButton><UiButton variant="primary" disabled={!name.trim()} onClick={save}>保存</UiButton></>}>
    <div className="flex flex-col gap-3" onKeyDown={event => { if (event.key === 'Enter' && elementOfEventTarget(event.target)?.tagName === 'INPUT') { event.preventDefault(); event.stopPropagation(); save() } }}>
      <UiFormRow label="预设名称"><UiInput autoFocus aria-label="预设名称" value={name} maxLength={200} onChange={event => setName(event.target.value)} /></UiFormRow>
      {effects?.some(effect => effect.mask?.regionId === 'shapes') && <UiFormRow label="保存手绘遮罩" info="保存遮罩形状、羽化与扩展；在新片段上使用相同的相对位置。"><UiSwitch aria-label="保存手绘遮罩" checked={includeShapes} onCheckedChange={setIncludeShapes} /></UiFormRow>}
      {tracked && <p className="text-xs text-text3">跟踪绑定属于原片段，将不随预设保存。需要时请在新片段上重新跟踪。</p>}
      {error && <UiError size="xs" title={error} message="" />}
    </div>
  </UiModal>
}
