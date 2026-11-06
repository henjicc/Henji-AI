import { useEffect, useRef, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { UiButton } from '@/components/ui'
import { codeEditOwner, pendingUserCodeEdits } from '@/core/videoEdit/codeEdits'
import { askAssistantToCheckUserEdits } from './application/videoEditUserEditReview'
import { getActiveVideoEditSequence, videoEditRevision, type VideoEditInstance } from './application/videoEditService'
import { sameVideoEditViewFields, useVideoEditViewSelector } from './application/useVideoEditViewSelector'

/**
 * 节目画面左下角：上次助手检查后用户手改过几处（一个参数或一个元素算一处），点一下连同截图交给助手检查；助手检查完标记后消失。
 * `hidden` 时（画面没准备好、出错提示占着底部）只是不显示，正在准备的请求不取消。
 */
export function VideoEditUserEditReviewButton({ instance, hidden, onError }: { instance: VideoEditInstance; hidden: boolean; onError: (error: unknown) => void }): React.ReactElement | null {
  useVideoEditViewSelector(() => [videoEditRevision(), instance.playing, instance.activeSequenceId], sameVideoEditViewFields)
  const pending = useRef<AbortController>(); const [busy, setBusy] = useState(false)
  useEffect(() => () => pending.current?.abort(), [])
  const count = getActiveVideoEditSequence(instance).clips.reduce((sum, clip) => sum + (clip.kind === 'code' ? new Set(pendingUserCodeEdits(clip.edits).map(([key]) => JSON.stringify(codeEditOwner(key) ?? key))).size : 0), 0)
  if (!count || instance.playing || hidden) return null
  const ask = (): void => {
    if (pending.current) return
    const controller = new AbortController(); pending.current = controller; setBusy(true)
    void askAssistantToCheckUserEdits(instance.document.id, controller.signal).catch(error => { if (!controller.signal.aborted) onError(error) }).finally(() => { if (pending.current === controller) { pending.current = undefined; setBusy(false) } })
  }
  return <div className="ui-glass absolute bottom-2 left-2 rounded-control p-0.5" data-video-edit-user-edit-review>
    <UiButton size="sm" variant="quiet" loading={busy} disabled={busy} tooltip="字数、颜色改了以后，让助手看看排版和前后关联要不要跟着调" onClick={ask}><MessageSquare />已手改 {count} 处 · 交给助手检查</UiButton>
  </div>
}
