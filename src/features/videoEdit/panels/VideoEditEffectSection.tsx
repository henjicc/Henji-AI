import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { UiButton, UiGroup } from '@/components/ui'
import Tooltip from '@/components/ui/Tooltip'

/** 折叠状态在本次运行内记住（换片段、关面板再开都保持），与 PR 效果控件一致。 */
const collapsedSections = new Set<string>()

/**
 * 效果控件的一节（PR 的“运动 / 不透明度 / 音量”等）：标题可折叠，右侧放整节的开关与重置。
 * 只用分隔线切分，不画卡片；说明放标题悬停提示，不铺常驻正文。
 */
export function VideoEditEffectSection({ id, title, info, actions, children }: { id: string; title: string; info?: ReactNode; actions?: ReactNode; children: ReactNode }): React.ReactElement {
  const [open, setOpen] = useState(() => !collapsedSections.has(id))
  const toggle = (): void => {
    const next = !open
    if (next) collapsedSections.delete(id); else collapsedSections.add(id)
    setOpen(next)
  }
  const toggleButton = <UiButton size="sm" className="-ml-2 gap-1" aria-expanded={open} aria-label={`${open ? '收起' : '展开'}${title}`} onClick={toggle}>
    {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}{title}
  </UiButton>
  return <UiGroup data-video-edit-effect-section={id} titleTone="compact" divided gap="none" actions={actions} title={info ? <Tooltip content={info} delay={200}>{toggleButton}</Tooltip> : toggleButton}>
    {open ? children : null}
  </UiGroup>
}
