import { Children, isValidElement, useContext, type MouseEvent, type ReactNode } from 'react'
import { UI_FIELD_INLINE_ROW_CLASS, UiFieldLayoutContext, UiFormRow, useUiFieldLayout } from '@/components/ui'
import { ParamLabel } from './ParamLabel'

import { ParamPanelRowsContext } from './paramPanelRows'

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
  const panelRows = useContext(ParamPanelRowsContext)
  if (panelRows && inline) {
    const nodes = Children.toArray(children)
    const label = nodes.find(node => isValidElement(node) && node.type === ParamLabel)
    if (label) return <UiFormRow label={label} density="compact">
      {nodes.filter(node => node !== label)}
    </UiFormRow>
  }
  if (layout !== 'toolbar') return <div className={className}>{children}</div>
  if (!inline) {
    return (
      <div className={className}>
        <UiFieldLayoutContext.Provider value="form">{children}</UiFieldLayoutContext.Provider>
      </div>
    )
  }
  return <div className={UI_FIELD_INLINE_ROW_CLASS} onClick={activateControlFromLabel}>{children}</div>
}

/**
 * 工具条参数行里点参数名，等同点它右边的控件（与原生 `<label>` 相同：按钮被点击、输入框获得焦点）。
 * 不用 `<label>` 包住整行：控件自己可能带 `<label>`，嵌套标签无效。
 */
function activateControlFromLabel(event: MouseEvent<HTMLDivElement>): void {
  if (!(event.target instanceof Element) || !event.target.closest('[data-param-label]')) return
  const control = event.currentTarget.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')
  if (!control) return
  if (control instanceof HTMLButtonElement) control.click()
  else control.focus()
}
