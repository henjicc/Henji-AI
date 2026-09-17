import { useEffect, useState } from 'react'
import { UI_TEXT_META_CLASS } from '@/components/ui'
import type { AgentAttachment } from '@/core/assistant/attachments'
import { refreshAssistantAttachments } from './assistantAttachments'

export function AssistantMessageAttachments({ attachments }: { attachments: AgentAttachment[] }): JSX.Element | null {
  const [resolved, setResolved] = useState<Awaited<ReturnType<typeof refreshAssistantAttachments>>>([])
  useEffect(() => {
    let active = true
    void refreshAssistantAttachments(attachments).then(items => { if (active) setResolved(items) })
    return () => { active = false }
  }, [attachments])
  if (attachments.length === 0) return null
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      {attachments.map((attachment, index) => {
        const asset = resolved[index]?.asset
        const unavailable = !asset || asset.inspectionStatus !== 'ready'
        return (
          <div key={attachment.mediaRef} className="min-w-0 overflow-hidden rounded-lg border border-border-dark bg-surface-dark">
            {!unavailable && attachment.modality === 'image' ? (
              <img src={asset.displayUrl} alt={attachment.displayName} className="h-24 w-full object-cover" />
            ) : !unavailable && attachment.modality === 'video' ? (
              <video src={asset.displayUrl} aria-label={attachment.displayName} className="h-24 w-full object-cover" controls />
            ) : !unavailable ? (
              <audio src={asset.displayUrl} aria-label={attachment.displayName} className="h-16 w-full px-1" controls />
            ) : (
              <div className={`flex h-16 items-center justify-center px-2 text-center ${UI_TEXT_META_CLASS}`}>附件源已失效</div>
            )}
            <div className={`truncate px-2 py-1.5 ${UI_TEXT_META_CLASS}`}>{attachment.displayName}</div>
          </div>
        )
      })}
    </div>
  )
}
