import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { PanelTrigger, UI_TEXT_META_CLASS, UiButton, UiOptionButton } from '@/components/ui'
import { ICON_WORKSPACE_VIDEO_EDIT } from '@/core/theme/icons'
import { planVideoEditSend, sendCreativeResultToVideoEdit, type VideoEditSendMediaKind } from '../application/videoEditResultSend'
import { VIDEO_EDIT_SEND_MODES as MODES, runVideoEditSend as runSend, type VideoEditSendNotify as Notify, type VideoEditSendSourceResolver as SourceResolver } from './videoEditSendActions'
import { createVideoEditCreativeTransfer, runVideoEditCreativeTransfer } from '../application/videoEditCreativeTransfer'
import type { VideoEditResultReceipt, VideoEditResultTarget } from '../application/videoEditResultTarget'

export type { VideoEditBoundTarget } from './videoEditSendActions'
/** One send entry for every creative workspace; targets are frozen at the click, before any export work. */
export function VideoEditSendMenu({ mediaKind, resolveSource, notify, disabled, boundTarget }: { mediaKind: VideoEditSendMediaKind; resolveSource: SourceResolver; notify: Notify; disabled?: boolean; boundTarget?: { target: VideoEditResultTarget; label: string } }): React.ReactElement {
  const [running, setRunning] = useState<AbortController | null>(null)
  const start = (run: (signal: AbortSignal) => Promise<VideoEditResultReceipt>): void => {
    const controller = new AbortController(); setRunning(controller)
    void runSend(() => run(controller.signal), notify).finally(() => setRunning(current => current === controller ? null : current))
  }
  if (running) return <UiButton variant="ghost" size="sm" onClick={() => running.abort()}>正在加入剪辑… 取消</UiButton>
  return <PanelTrigger disabled={disabled} panelWidth={300} panelClassName="p-1" closeOnPanelClick renderPanel={() => (
    <div role="menu" aria-label="加入剪辑" className="flex flex-col gap-0.5">
      {boundTarget && <UiOptionButton type="button" role="menuitem" variant="menu" className="w-full flex-col items-start gap-0.5 text-left text-sm"
        onClick={() => start(async signal => runVideoEditCreativeTransfer(createVideoEditCreativeTransfer(boundTarget.target, await resolveSource()), signal))}>
        <span>回填到原剪辑位置</span><span className={UI_TEXT_META_CLASS}>{boundTarget.label}</span>
      </UiOptionButton>}
      {MODES.map(({ mode, title }) => {
        const plan = planVideoEditSend({ mediaKind, mode })
        return <UiOptionButton key={mode} type="button" role="menuitem" variant="menu" disabled={!plan.available} className="w-full flex-col items-start gap-0.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => start(async signal => sendCreativeResultToVideoEdit(await resolveSource(), { mediaKind, mode }, signal))}>
          <span>{title}</span><span className={UI_TEXT_META_CLASS}>{plan.available ? plan.label : plan.reason}</span>
        </UiOptionButton>
      })}
    </div>
  )}>
    {({ open, togglePanel }) => <UiButton type="button" variant="ghost" size="sm" disabled={disabled} aria-expanded={open} aria-haspopup="menu" onClick={togglePanel}>
      <ICON_WORKSPACE_VIDEO_EDIT size={15} className="mr-1.5" />加入剪辑<ChevronDown size={14} className="ml-1.5" />
    </UiButton>}
  </PanelTrigger>
}
