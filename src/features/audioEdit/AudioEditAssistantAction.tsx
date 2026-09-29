import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { UiButton, UiTextArea } from '@/components/ui'
import { useNavigationStore } from '@/stores/navigationStore'
import { useAudioEditStore } from './store/audioEditStore'
import { optimizeAudioEditWithAssistant } from './application/audioEditAssistant'

export function AudioEditAssistantAction({ disabled }: { disabled: boolean }) {
  const active = useNavigationStore((state) => state.activeWorkspace === 'tools' && state.activeToolId === 'audioEdit')
  const project = useAudioEditStore((state) => state.project)
  const processing = useAudioEditStore((state) => state.busy)
  const [hint, setHint] = useState('')
  useEffect(() => { setHint('') }, [project?.id])
  if (!active || !project) return null
  return <div className="space-y-2 px-3 pt-3">
    <UiButton variant="plain" className="gap-2" disabled={disabled || processing || !project.transcript.length}
      onClick={() => optimizeAudioEditWithAssistant(project.id, hint)}><Sparkles size={16} />一键优化口播</UiButton>
    <details className="text-xs text-text-muted"><summary className="cursor-pointer">纠错提示（可选）</summary>
      <UiTextArea aria-label="口播纠错提示" rows={2} value={hint} onChange={(event) => setHint(event.target.value)} placeholder="无；仅填写需要核对的同音或近音词" className="mt-2" />
    </details>
  </div>
}
