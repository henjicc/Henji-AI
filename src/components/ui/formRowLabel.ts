import { createContext, useContext } from 'react'

/**
 * 表单行标签关联（任务 5.8，B-50）。
 *
 * `UiFormRow` 的标签是一段文字，右侧控件（开关、下拉、输入框…）原来没有可访问名称，读屏只读“开关”。
 * 表单行用这个上下文把标签与说明的 id 交给行内的 `Ui*` 控件：控件自己没有 `aria-label` /
 * `aria-labelledby` 时，用 `aria-labelledby` 指向行标签、`aria-describedby` 指向说明。
 * 同 `UiFieldLayoutContext`：`Dropdown` / `PanelTrigger` / `UiModal` 的浮层内容一律重置为 null，
 * 浮层里的字段不继承打开它的那一行的标签。
 */
export interface UiFormRowLabelling {
  labelId: string
  hintId?: string
}

export const UiFormRowLabelContext = createContext<UiFormRowLabelling | null>(null)

export function useUiFormRowLabelling(): UiFormRowLabelling | null {
  return useContext(UiFormRowLabelContext)
}

interface LabellingProps {
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  id?: string
}

/**
 * 控件自身没有可访问名称时，返回指向所在表单行标签的 aria 属性；已有名称时返回空对象（调用方的名称优先）。
 * `selfId` 用于“标签 + 自身内容”组合命名（下拉触发器：读作“时长 5s”而不是只读“5s”或只读“时长”）。
 */
export function resolveFormRowLabelling(
  row: UiFormRowLabelling | null,
  props: LabellingProps,
  selfId?: string,
): { 'aria-labelledby'?: string; 'aria-describedby'?: string } {
  if (!row || props['aria-label'] || props['aria-labelledby']) return {}
  return {
    'aria-labelledby': selfId ? `${row.labelId} ${selfId}` : row.labelId,
    ...(row.hintId && !props['aria-describedby'] ? { 'aria-describedby': row.hintId } : {}),
  }
}
