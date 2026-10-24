import type { ComponentProps, ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { UiFormRow, UiIconButton, useUiPropertyMenu } from '@/components/ui'
import { UI_ICON_SIZE } from '@/core/theme/icons'

export interface VideoEditPropertyReset { label: string; disabled: boolean; onReset: () => void }

/**
 * 效果控件的一行属性（重要记录 019）：就是属性面板排布里的 `UiFormRow`，重置放在名称上的右键菜单；
 * 没有面板级菜单的宿主里退回行尾按钮。固有属性、智能区域、遮罩共用这一行，不各写一份。
 */
export function VideoEditPropertyRow({ label, tooltip, reset, children, ...rest }: { label: string; tooltip: string; reset?: VideoEditPropertyReset; children: ReactNode } & Omit<ComponentProps<typeof UiFormRow>, 'label' | 'info' | 'trailing' | 'children'>): React.ReactElement {
  const menu = useUiPropertyMenu()
  return <UiFormRow label={label} info={tooltip} {...rest}
    trailing={reset && !menu ? <UiIconButton size="2xs" aria-label={reset.label} tooltip={reset.label} disabled={reset.disabled} onClick={reset.onReset}><RotateCcw /></UiIconButton> : undefined}
    onContextMenu={reset && menu ? event => menu(event, [{ id: 'reset', label: reset.label, icon: <RotateCcw size={UI_ICON_SIZE.sm} />, disabled: reset.disabled, onClick: reset.onReset }]) : undefined}>
    {children}
  </UiFormRow>
}
