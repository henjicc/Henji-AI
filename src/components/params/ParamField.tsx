import type { ReactNode } from 'react'
import { UI_FIELD_INLINE_ROW_CLASS, UiFieldLayoutContext, useUiFieldLayout } from '@/components/ui'

interface ParamFieldProps {
  children: ReactNode
  /** 表单排布下的外层布局类（宽度等）。 */
  className?: string
  /**
   * 是否适合工具条排布。大块控件（多行文本、单选卡片、带刻度的数值）在工具条里仍按表单排布：
   * 标签在上、控件在下，并把排布重置为 `form`，避免内部字段继承工具条外观。
   */
  inline?: boolean
}

/**
 * 参数控件的统一外层：表单排布 = 标签在上；工具条排布（`UiFieldLayoutContext` = `toolbar`）= 标签在左、
 * 控件在右的一行。外观（标签档、触发器皮肤）由 `ParamLabel` / `Dropdown` / `PanelTrigger` 按排布自取。
 */
export function ParamField({ children, className = 'w-auto', inline = true }: ParamFieldProps): JSX.Element {
  const layout = useUiFieldLayout()
  if (layout !== 'toolbar') return <div className={className}>{children}</div>
  if (!inline) {
    return (
      <div className={className}>
        <UiFieldLayoutContext.Provider value="form">{children}</UiFieldLayoutContext.Provider>
      </div>
    )
  }
  return <div className={UI_FIELD_INLINE_ROW_CLASS}>{children}</div>
}
