import { useState, type HTMLAttributes, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { UiButton, UiIconButton } from '@/components/ui'
import Tooltip from '@/components/ui/Tooltip'
import { UI_PROPERTY_REVEAL_CLASS } from '@/components/ui/styleTokens'
import { ICON_EFFECT_DISABLED, ICON_EFFECT_ENABLED, UI_ICON_SIZE } from '@/core/theme/icons'

/** 折叠状态在本次运行内记住（换片段、关面板再开都保持），与 PR 效果控件一致。 */
const collapsedSections = new Set<string>()

/** 每节前的 fx 开关（对齐 AE）：开着是 fx，关掉换成带斜杠的 fx；停用只是不生效，参数与关键帧都保留。 */
export function VideoEditEffectToggle({ enabled, label, tooltip, disabled, size = '2xs', onChange }: { enabled: boolean; label: string; tooltip: string; disabled?: boolean; size?: '2xs' | 'sm'; onChange: (enabled: boolean) => void }): React.ReactElement {
  const Icon = enabled ? ICON_EFFECT_ENABLED : ICON_EFFECT_DISABLED
  return <UiIconButton size={size} aria-pressed={enabled} aria-label={label} tooltip={tooltip} disabled={disabled} onClick={() => onChange(!enabled)}><Icon /></UiIconButton>
}

interface SectionProps {
  id: string; title: string; info?: ReactNode; actions?: ReactNode; children: ReactNode
  enabled?: boolean; onEnabledChange?: (enabled: boolean) => void
  /** 由调用方管理展开（附加效果按效果记住）；不传时按 `id` 在本次运行内记住。 */
  open?: boolean; onOpenChange?: (open: boolean) => void
  /** 折叠按钮与 fx 开关的名称；默认“收起/展开{title}”“停用/启用{title}分区”。 */
  collapseLabel?: string; toggleLabel?: string; toggleTooltip?: string; busy?: boolean
  /**
   * 标题行本身的属性：附加效果拿来做选中、拖动排序与键盘焦点。给了它，点标题行只选中（PR），
   * 折叠只认前面的箭头按钮；不给时整行可点折叠。
   */
  headerProps?: HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, unknown>
  headerRef?: (element: HTMLDivElement | null) => void
}

/**
 * 效果控件的一节（重要记录 019，对齐 AE）：标题行是四列里的 箭头 / fx / 名称 / 悬停才出现的整节动作（重置等），
 * 整行可点折叠；节与节之间一条分隔线，不画卡片。停用的一节标题变灰、内容变淡。说明放标题悬停提示。
 */
export function VideoEditEffectSection({ id, title, info, actions, children, enabled, onEnabledChange, open: controlled, onOpenChange, collapseLabel, toggleLabel, toggleTooltip, busy, headerProps, headerRef }: SectionProps): React.ReactElement {
  const [remembered, setRemembered] = useState(() => !collapsedSections.has(id))
  const open = controlled ?? remembered
  const toggle = (): void => {
    if (onOpenChange) { onOpenChange(!open); return }
    if (open) collapsedSections.add(id); else collapsedSections.delete(id)
    setRemembered(!open)
  }
  const inactive = enabled === false
  const Chevron = open ? ChevronDown : ChevronRight
  const name = collapseLabel ?? `${open ? '收起' : '展开'}${title}`
  const overlay = <UiButton size="sm" className="absolute inset-0 w-full" aria-expanded={open} aria-label={name} disabled={busy} onClick={toggle} />
  return <section className="border-t border-line pb-1.5 pt-1" data-video-edit-effect-section={id}>
    <div ref={headerRef} {...headerProps} className={`group/property relative mx-1 grid h-control-sm grid-cols-property-row items-center gap-x-1 rounded-control pr-2 ${headerProps?.className ?? ''}`}>
      {headerProps
        ? <span className="relative flex justify-center"><UiIconButton size="2xs" aria-expanded={open} aria-label={name} tooltip={name} disabled={busy} onClick={toggle}><Chevron /></UiIconButton></span>
        : <>{info ? <Tooltip content={info} delay={200} asChild>{overlay}</Tooltip> : overlay}
          <span aria-hidden="true" className="pointer-events-none relative flex justify-center text-text3"><Chevron size={UI_ICON_SIZE.sm} /></span></>}
      <span className="relative flex justify-center">{onEnabledChange && <VideoEditEffectToggle enabled={enabled !== false} disabled={busy}
        label={toggleLabel ?? `${inactive ? '启用' : '停用'}${title}分区`} tooltip={toggleTooltip ?? (inactive ? `启用${title}` : `停用${title}（保留参数与关键帧）`)} onChange={onEnabledChange} />}</span>
      {/* 名称占名称列与数值列：窄面板里长名称不被数值列挤断；整节动作贴右，悬停才出现。 */}
      <span className="pointer-events-none relative col-span-2 flex min-w-0 items-center gap-1">
        <span className={`min-w-0 flex-1 truncate text-xs font-semibold ${inactive ? 'text-text3' : 'text-text2'}`}>{title}</span>
        {actions && <span className={`pointer-events-auto flex shrink-0 items-center gap-0.5 ${UI_PROPERTY_REVEAL_CLASS}`}>{actions}</span>}
      </span>
    </div>
    {open ? <div className={`flex flex-col ${inactive ? 'opacity-50' : ''}`}>{children}</div> : null}
  </section>
}
