import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Power } from 'lucide-react'
import { UiButton, UiGroup, UiIconButton } from '@/components/ui'
import Tooltip from '@/components/ui/Tooltip'

/** 折叠状态在本次运行内记住（换片段、关面板再开都保持），与 PR 效果控件一致。 */
const collapsedSections = new Set<string>()

/** 固有分组和附加效果复用同一折叠标题，展开状态不作为选项选中态。 */
export function VideoEditEffectSectionTitle({ title, open, onToggle, info, disabled, label, effectId, inactive = false }: { title: string; open: boolean; onToggle: () => void; info?: ReactNode; disabled?: boolean; label?: string; effectId?: string; inactive?: boolean }): React.ReactElement {
  const button = <UiButton size="sm" className="min-w-0 gap-1" aria-expanded={open} aria-label={label ?? `${open ? '收起' : '展开'}${title}`} disabled={disabled} data-video-edit-effect={effectId} onClick={onToggle}>
    {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}<span className={`truncate ${inactive ? 'text-text3 line-through' : ''}`}>{title}</span>
  </UiButton>
  return info ? <Tooltip content={info} delay={200}>{button}</Tooltip> : button
}

/**
 * 效果控件的一节（PR 的“运动 / 不透明度 / 音量”等）：标题可折叠，右侧放整节的开关与重置。
 * 只用分隔线切分，不画卡片；说明放标题悬停提示，不铺常驻正文。
 */
export function VideoEditEffectSection({ id, title, info, actions, children, enabled, onEnabledChange }: { id: string; title: string; info?: ReactNode; actions?: ReactNode; children: ReactNode; enabled?: boolean; onEnabledChange?: (enabled: boolean) => void }): React.ReactElement {
  const [open, setOpen] = useState(() => !collapsedSections.has(id))
  const toggle = (): void => {
    const next = !open
    if (next) collapsedSections.delete(id); else collapsedSections.add(id)
    setOpen(next)
  }
  return <UiGroup data-video-edit-effect-section={id} titleTone="compact" divided gap="none" actions={actions} title={<div className="flex min-w-0 items-center gap-1">{onEnabledChange && <UiIconButton size="xs" on={enabled} aria-pressed={enabled} aria-label={`${enabled ? '停用' : '启用'}${title}分区`} title={enabled ? '停用此分区（保留参数与关键帧）' : '恢复此分区'} onClick={() => onEnabledChange(!enabled)}><Power size={12} /></UiIconButton>}<VideoEditEffectSectionTitle title={title} open={open} onToggle={toggle} info={info} inactive={enabled === false} /></div>}>
    {open ? children : null}
  </UiGroup>
}
