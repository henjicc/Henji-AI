import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Dropdown, PanelTrigger, UI_TEXT_META_CLASS, UiButton, UiError, UiIconButton, UiModal, UiOptionButton } from '@/components/ui'
import { ICON_WORKSPACE_VIDEO_EDIT } from '@/core/theme/icons'
import { listVideoEditSendDestinations, prepareVideoEditSendDestination, planVideoEditSend, sendCreativeResultToVideoEdit, type VideoEditSendMediaKind, type VideoEditSendMode } from '../application/videoEditResultSend'
import { VIDEO_EDIT_SEND_MODES as MODES, runVideoEditSend as runSend, type VideoEditSendNotify as Notify, type VideoEditSendSourceResolver as SourceResolver } from './videoEditSendActions'
import { createVideoEditCreativeTransfer, runVideoEditCreativeTransfer } from '../application/videoEditCreativeTransfer'
import type { VideoEditResultReceipt, VideoEditResultTarget } from '../application/videoEditResultTarget'

/** One send entry for every creative workspace; targets are frozen at the click, before any export work. */
/**
 * `trigger="icon"`：放进一排通用图标动作（复制、收进资产库、下载）时只用剪辑图标，名称进悬停提示；
 * 默认是带文字的按钮，用在交付动作那一组。
 */
export function VideoEditSendMenu({ mediaKind, resolveSource, notify, disabled, boundTarget, trigger = 'button' }: { mediaKind: VideoEditSendMediaKind; resolveSource: SourceResolver; notify: Notify; disabled?: boolean; boundTarget?: { target: VideoEditResultTarget; label: string }; trigger?: 'button' | 'command' | 'icon' }): React.ReactElement {
  // 命令带里的次要动作静默无底（唯一主动作是导出）；放在卡片菜单这类面板里时仍是带底的次级按钮
  const variant = trigger === 'command' ? 'quiet' : 'secondary'
  const [running, setRunning] = useState<AbortController | null>(null)
  const operation = useRef<AbortController | null>(null)
  useEffect(() => () => operation.current?.abort(), [])
  const start = (run: (signal: AbortSignal) => Promise<VideoEditResultReceipt>): void => {
    if (operation.current) return
    const controller = new AbortController(); operation.current = controller; setRunning(controller)
    void runSend(() => run(controller.signal), notify).finally(() => { operation.current = null; setRunning(current => current === controller ? null : current) })
  }
  if (running) return <UiButton variant={variant} onClick={() => running.abort()}>正在加入剪辑… 取消</UiButton>
  return <PanelTrigger disabled={disabled} panelSize="compact" panelPadding="menu" renderPanel={() => (
    <VideoEditSendOptions mediaKind={mediaKind} send={(mode, projectId) => start(async signal => sendCreativeResultToVideoEdit(resolveSource, { mediaKind, mode, ...(projectId ? { projectId } : {}) }, signal))}>
      {boundTarget && <UiOptionButton type="button" role="menuitem" variant="menu" size="md" className="w-full"
        onClick={() => start(async signal => runVideoEditCreativeTransfer(createVideoEditCreativeTransfer(boundTarget.target, await resolveSource()), signal))}>
        <MenuItemText title="替换回剪辑（原位置一帧）" detail={boundTarget.label} />
      </UiOptionButton>}
    </VideoEditSendOptions>
  )}>
    {({ open, togglePanel }) => trigger === 'icon'
      ? <UiIconButton type="button" disabled={disabled} tooltip="加入剪辑" aria-expanded={open} aria-haspopup="menu" onClick={event => { event.stopPropagation(); togglePanel() }}>
        <ICON_WORKSPACE_VIDEO_EDIT />
      </UiIconButton>
      : <UiButton type="button" variant={variant} disabled={disabled} aria-expanded={open} aria-haspopup="menu" onClick={event => { event.stopPropagation(); togglePanel() }}>
        <ICON_WORKSPACE_VIDEO_EDIT  className="mr-1.5" />加入剪辑<ChevronDown  className="ml-1.5" />
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

/** 两行菜单项（名称 + 落点说明）：靠左排，和菜单里其他项同一条左边。 */
function MenuItemText({ title, detail }: { title: string; detail: string }): React.ReactElement {
  return <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"><span>{title}</span><span className={UI_TEXT_META_CLASS}>{detail}</span></span>
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
      return <UiOptionButton key={mode} role="menuitem" variant="menu" disabled={loading || Boolean(error) || !plan.available} size="md" className="w-full"
        onClick={() => send(mode, selected || undefined)}>
        <MenuItemText title={title} detail={plan.available ? plan.label : plan.reason} />
      </UiOptionButton>
    })}
  </div>
}
