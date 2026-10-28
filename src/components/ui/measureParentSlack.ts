import { ownerWindowOf } from '@/utils/crossRealmDom'

/**
 * 父级行里没被任何子项（含外边距、间距、内边距）占用的宽度。
 *
 * 放不下就收起的控件（`UiOverflowRow`、`UiSegmented`）收起后宽度只剩内容宽度，单看自己测不到“现在放得下了”；
 * 加上父级的空余宽度才能在窗口放宽后放回（重要记录 020）。
 *
 * 兄弟项标了 `data-overflow-yield` 时，它超出自身 `min-width` 的部分也算空余：这类兄弟（面板底栏的状态文字）
 * 只分剩余宽度、可以截断，收纳行需要空间时它先让。
 */
export function measureParentSlack(element: HTMLElement): number {
  const parent = element.parentElement
  if (!parent) return 0
  const view = ownerWindowOf(element)
  const style = view.getComputedStyle(parent)
  const children = Array.from(parent.children).filter((child) => view.getComputedStyle(child).display !== 'none')
  let used = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
  used += (Number.parseFloat(style.columnGap) || 0) * Math.max(0, children.length - 1)
  for (const child of children) {
    const childStyle = view.getComputedStyle(child)
    const width = child.getBoundingClientRect().width
    const yielded = child !== element && child.hasAttribute('data-overflow-yield')
    used += (yielded ? Math.min(width, Number.parseFloat(childStyle.minWidth) || 0) : width)
      +(Number.parseFloat(childStyle.marginLeft) || 0)
      + (Number.parseFloat(childStyle.marginRight) || 0)
  }
  return Math.max(0, Math.floor(parent.clientWidth - used))
}
