import { useEffect, useRef, useState } from 'react'
import { Dropdown, UiButton, UiFormRow, UiGroup, UiLoading } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { videoEditDuckingSettingsSchema, type VideoEditAudioRole } from '@/core/videoEdit/audioDucking'
import { videoEditComposition } from '@/core/videoEdit/document'
import { isVideoEditDuckingKeyframe } from '@/core/videoEdit/keyframes'
import { generateVideoEditAudioDucking, setVideoEditAudioRoles } from '../application/videoEditAudioDucking'
import { videoEditClipHasSound } from '../application/videoEditLoudness'
import { getActiveVideoEditSequence, type VideoEditInstance } from '../application/videoEditService'

const roles: { value: VideoEditAudioRole; label: string }[] = [{ value: 'dialogue', label: '对话' }, { value: 'music', label: '音乐' }, { value: 'sound_effect', label: '音效' }, { value: 'ambience', label: '环境' }]
/** Lives inside the registered Effects dock/popout; it owns no business state. */
export function VideoEditBasicSoundPanel({ instance, onError }: { instance: VideoEditInstance; onError: (reason: unknown) => void }): React.ReactElement | null {
  const sequence = getActiveVideoEditSequence(instance); const projectId = instance.document.id
  const selected = sequence.clips.filter(clip => (instance.selectedClipIds.length ? instance.selectedClipIds : [instance.selection]).includes(clip.id))
  const composition = videoEditComposition(instance.document, sequence.id)
  const sounds = selected.filter(clip => videoEditClipHasSound(composition, clip))
  const music = sounds.filter(clip => clip.audioRole === 'music')
  const [settings, setSettings] = useState(() => videoEditDuckingSettingsSchema.parse({}))
  const [busy, setBusy] = useState(false); const controller = useRef<AbortController>()
  const scope = `${projectId}:${sequence.id}:${sounds.map(clip => clip.id).join(',')}`
  useEffect(() => {
    setBusy(false)
    return () => { controller.current?.abort(); controller.current = undefined }
  }, [scope])
  if (!sounds.length) return null
  const target = { projectId, sequenceId: sequence.id, clipIds: sounds.map(clip => clip.id) }
  const sameRole = sounds.every(clip => clip.audioRole === sounds[0].audioRole) ? sounds[0].audioRole : undefined
  const run = async (): Promise<void> => {
    if (controller.current) return
    const current = new AbortController(); controller.current = current; setBusy(true)
    try { await generateVideoEditAudioDucking({ ...target, clipIds: music.map(clip => clip.id) }, settings, current.signal) }
    catch (error) { if (!current.signal.aborted) onError(error) }
    finally { if (controller.current === current) { controller.current = undefined; setBusy(false) } }
  }
  return <UiGroup title="基本声音" titleTone="compact" divided>
    <UiFormRow label="声音类型" inline density="compact"><Dropdown size="sm" ariaLabel="声音类型" value={sameRole ?? ''} options={[{ value: '', label: sameRole ? '声音类型' : sounds.some(clip => clip.audioRole) ? '混合类型' : '未标注', disabled: true }, ...roles]} disabled={busy} onSelect={role => { try { setVideoEditAudioRoles(target, role as VideoEditAudioRole) } catch (error) { onError(error) } }} /></UiFormRow>
    {music.length > 0 && <UiGroup title="回避" titleTone="compact">
      <UiFormRow label="目标" inline density="compact"><Dropdown size="sm" ariaLabel="回避目标" value={settings.targetRole} options={roles.filter(role => role.value === 'dialogue' || role.value === 'sound_effect')} disabled={busy} onSelect={role => setSettings(value => ({ ...value, targetRole: role as 'dialogue' | 'sound_effect' }))} /></UiFormRow>
      <UiFormRow label="降低量（dB）" inline density="compact"><NumberInput size="sm" ariaLabel="回避降低量" value={settings.reductionDb} min={0} max={60} step={1} widthClassName="w-24" disabled={busy} onChange={reductionDb => setSettings(value => ({ ...value, reductionDb }))} /></UiFormRow>
      <UiFormRow label="敏感度" inline density="compact"><NumberInput size="sm" ariaLabel="回避敏感度" value={settings.sensitivity} min={0} max={100} step={1} widthClassName="w-24" disabled={busy} onChange={sensitivity => setSettings(value => ({ ...value, sensitivity }))} /></UiFormRow>
      <UiFormRow label="淡化（秒）" inline density="compact"><NumberInput size="sm" ariaLabel="回避淡化时长" value={settings.fadeSeconds} min={0.01} max={5} step={0.05} precision={2} widthClassName="w-24" disabled={busy} onChange={fadeSeconds => setSettings(value => ({ ...value, fadeSeconds }))} /></UiFormRow>
      <div className="flex items-center gap-2"><UiButton size="sm" variant="secondary" disabled={busy} onClick={() => void run()}>{music.some(clip => clip.curves?.volume?.some(isVideoEditDuckingKeyframe)) ? '重新生成回避' : '生成回避'}</UiButton>{busy && <UiButton size="sm" onClick={() => controller.current?.abort()}>取消</UiButton>}</div>
      {busy && <UiLoading size="sm" message="正在分析目标声音…" />}
    </UiGroup>}
  </UiGroup>
}
