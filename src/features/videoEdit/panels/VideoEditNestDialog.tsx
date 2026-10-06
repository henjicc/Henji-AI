import { useState } from 'react'
import { UiButton, UiError, UiFormRow, UiInput, UiModal } from '@/components/ui'
import { nestVideoEditSelection, type VideoEditNestTarget } from '../application/videoEditNesting'

export function VideoEditNestDialog({ target, onClose }: { target: VideoEditNestTarget; onClose: () => void }): React.ReactElement {
  const [name, setName] = useState('嵌套序列')
  const [error, setError] = useState('')
  const submit = (): void => {
    try { nestVideoEditSelection(target, name, false); onClose() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  return <UiModal isOpen title="嵌套序列" onClose={onClose} footer={<><UiButton onClick={onClose}>取消</UiButton><UiButton variant="primary" disabled={!name.trim()} onClick={submit}>确定</UiButton></>}>
    <UiFormRow label="序列名称"><UiInput autoFocus aria-label="序列名称" maxLength={200} value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && name.trim()) submit() }} /></UiFormRow>
    {error && <UiError message={error} />}
  </UiModal>
}
