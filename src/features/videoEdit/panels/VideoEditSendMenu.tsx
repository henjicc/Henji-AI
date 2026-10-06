import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Dropdown, PanelTrigger, UI_TEXT_META_CLASS, UiButton, UiError, UiModal, UiOptionButton } from '@/components/ui'
import { ICON_WORKSPACE_VIDEO_EDIT } from '@/core/theme/icons'
import { listVideoEditSendDestinations, prepareVideoEditSendDestination, planVideoEditSend, sendCreativeResultToVideoEdit, type VideoEditSendMediaKind, type VideoEditSendMode } from '../application/videoEditResultSend'
import { VIDEO_EDIT_SEND_MODES as MODES, runVideoEditSend as runSend, type VideoEditSendNotify as Notify, type VideoEditSendSourceResolver as SourceResolver } from './videoEditSendActions'
import { createVideoEditCreativeTransfer, runVideoEditCreativeTransfer } from '../application/videoEditCreativeTransfer'
import type { VideoEditResultReceipt, VideoEditResultTarget } from '../application/videoEditResultTarget'

export type { VideoEditBoundTarget } from './videoEditSendActions'
/** One send entry for every creative workspace; targets are frozen at the click, before any export work. */
export function VideoEditSendMenu({ mediaKind, resolveSource, notify, disabled, boundTarget }: { mediaKind: VideoEditSendMediaKind; resolveSource: SourceResolver; notify: Notify; disabled?: boolean; boundTarget?: { target: VideoEditResultTarget; label: string } }): React.ReactElement {
  const [running, setRunning] = useState<AbortController | null>(null)
  const operation = useRef<AbortController | null>(null)
  useEffect(() => () => operation.current?.abort(), [])
  const start = (run: (signal: AbortSignal) => Promise<VideoEditResultReceipt>): void => {
    if (operation.current) return
    const controller = new AbortController(); operation.current = controller; setRunning(controller)
    void runSend(() => run(controller.signal), notify).finally(() => { operation.current = null; setRunning(current => current === controller ? null : current) })
  }
  if (running) return <UiButton variant="secondary" onClick={() => running.abort()}>正在加入剪辑… 取消</UiButton>
  return <PanelTrigger disabled={disabled} panelWidth={340} panelPadding="menu" renderPanel={() => (
    <VideoEditSendOptions mediaKind={mediaKind} send={(mode, projectId) => start(async signal => sendCreativeResultToVideoEdit(resolveSource, { mediaKind, mode, ...(projectId ? { projectId } : {}) }, signal))}>
      {boundTarget && <UiOptionButton type="button" role="menuitem" variant="menu" size="md" className="w-full flex-col items-start gap-0.5 text-left"
        onClick={() => start(async signal => runVideoEditCreativeTransfer(createVideoEditCreativeTransfer(boundTarget.target, await resolveSource()), signal))}>
        <span>替换回剪辑（原位置一帧）</span><span className={UI_TEXT_META_CLASS}>{boundTarget.label}</span>
      </UiOptionButton>}
    </VideoEditSendOptions>
  )}>
    {({ open, togglePanel }) => <UiButton type="button" variant="secondary" disabled={disabled} aria-expanded={open} aria-haspopup="menu" onClick={event => { event.stopPropagation(); togglePanel() }}>
      <ICON_WORKSPACE_VIDEO_EDIT size={15} className="mr-1.5" />加入剪辑<ChevronDown size={14} className="ml-1.5" />
    </UiButton>}
  </PanelTrigger>
}

/** Context-menu hosts open the same destination and placement chooser. */
export function VideoEditSendDialog({ mediaKind, resolveSource, notify, onClose }: { mediaKind: VideoEditSendMediaKind; resolveSource: SourceResolver; notify: Notify; onClose: () => void }): React.ReactElement {
  const [running, setRunning] = useState<AbortController | null>(null)
  const operation = useRef<AbortController | null>(null)
  useEffect(() => () => operation.current?.abort(), [])
  const send = (mode: VideoEditSendMode, projectId?: string): void => {
    if (operation.current) return
    const controller = new AbortController(); operation.current = controller; setRunning(controller)
    void runSend(async () => {
      const receipt = await sendCreativeResultToVideoEdit(resolveSource, { mediaKind, mode, ...(projectId ? { projectId } : {}) }, controller.signal)
      onClose(); return receipt
    }, notify).finally(() => { operation.current = null; setRunning(null) })
  }
  return <UiModal isOpen title="发送到剪辑" onClose={() => { if (!running) onClose() }} footer={<UiButton onClick={() => { running?.abort(); if (!running) onClose() }}>{running ? '取消发送' : '取消'}</UiButton>}>
    {running ? <span className={UI_TEXT_META_CLASS}>正在加入剪辑…</span> : <VideoEditSendOptions mediaKind={mediaKind} send={send}>{null}</VideoEditSendOptions>}
  </UiModal>
}

function VideoEditSendOptions({ mediaKind, send, children }: { mediaKind: VideoEditSendMediaKind; send: (mode: VideoEditSendMode, projectId?: string) => void; children: React.ReactNode }): React.ReactElement {
  const [destinations, setDestinations] = useState<Array<{ id: string; name: string }>>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    void listVideoEditSendDestinations().then(values => { if (live) setDestinations(values) }).catch(cause => { if (live) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { live = false }
  }, [])
  const select = (id: string): void => {
    setSelected(id); setError('')
    if (!id) return
    setLoading(true)
    void prepareVideoEditSendDestination(id).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setLoading(false))
  }
  return <div role="menu" aria-label="加入剪辑" className="flex flex-col gap-0.5">
    <Dropdown label="目标剪辑" value={selected} disabled={loading} options={[{ value: '', label: '当前剪辑' }, ...destinations.map(value => ({ value: value.id, label: value.name }))]} onSelect={select} />
    {error && <UiError size="xs" title={error} message="" />}
    {children}
    {MODES.map(({ mode, title }) => {
      const plan = planVideoEditSend({ mediaKind, mode, ...(selected ? { projectId: selected } : {}) })
      return <UiOptionButton key={mode} role="menuitem" variant="menu" disabled={loading || Boolean(error) || !plan.available} size="md" className="w-full flex-col items-start gap-0.5 text-left"
        onClick={() => send(mode, selected || undefined)}>
        <span>{title}</span><span className={UI_TEXT_META_CLASS}>{plan.available ? plan.label : plan.reason}</span>
      </UiOptionButton>
    })}
  </div>
}
