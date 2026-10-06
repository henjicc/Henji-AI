import { useState } from 'react'
import { UiButton, UiCheckbox, UiError, UiFormRow, UiGroup, UiModal } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { exportVideoEdit } from '../application/videoEditExport'
import { VideoEditLoudnessFields } from './VideoEditLoudnessFields'
import { videoEditUserErrorMessage } from '../application/videoEditUserError'

export function VideoEditExportDialog({ projectId, onClose }: { projectId: string; onClose: () => void }): React.ReactElement {
  const [enabled, setEnabled] = useState(false)
  const [target, setTarget] = useState(-14)
  const [peak, setPeak] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (): Promise<void> => {
    setBusy(true); setError('')
    try { await exportVideoEdit(projectId, undefined, true, undefined, enabled ? { targetLufs: target, truePeakDbtp: peak } : undefined); onClose() }
    catch (reason) { setError(videoEditUserErrorMessage(reason)); setBusy(false) }
  }
  return <UiModal isOpen title="导出视频" onClose={() => { if (!busy) onClose() }} footer={<><UiButton disabled={busy} onClick={onClose}>取消</UiButton><UiButton variant="primary" disabled={busy} onClick={() => void submit()}>导出</UiButton></>}>
    <UiGroup>
      <UiFormRow label="响度标准化" info="仅调整这次导出的整片声音，不改变时间线或预览音量。" inline><UiCheckbox checked={enabled} onCheckedChange={setEnabled} /></UiFormRow>
      {enabled && <><VideoEditLoudnessFields target={target} onTarget={setTarget} /><UiFormRow label="真峰值上限" info="限制采样点之间的峰值，降低播放或编码时爆音的风险。" inline><div className="flex items-center gap-2"><NumberInput ariaLabel="真峰值上限 dBTP" value={peak} min={-8} max={0} step={.1} precision={1} widthClassName="w-24" onChange={setPeak} /><span>dBTP</span></div></UiFormRow></>}
      <p className="text-xs text-text2">{enabled ? `导出摘要：整片标准化到 ${target} LUFS，真峰值不高于 ${peak} dBTP。` : '导出摘要：保持时间线音量。'}</p>
    </UiGroup>
    {error && <UiError message={error} />}
  </UiModal>
}
