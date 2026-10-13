import { isHtmlElementNode, ownerDocumentOf } from '@/utils/crossRealmDom'
import { matchVideoEditShortcut, type VideoEditCommandScope, type VideoEditKeyEvent, type VideoEditShortcutOverrides } from '@/core/videoEdit/commands'

/** DOM protection belongs to the host; command meanings and bindings stay in the shared registry. */
export function videoEditKeyboardCommand(event: VideoEditKeyEvent & { target: EventTarget | null }, fallback: VideoEditCommandScope, overrides: VideoEditShortcutOverrides) {
  // 系统浮窗中的目标属于子窗口 realm，不能用主窗口的 instanceof 判定。
  const target = isHtmlElementNode(event.target) ? event.target : null
  // 目标所在窗口或主窗口有模态框时都让出键盘。
  const modal = [...new Set([ownerDocumentOf(target), document])].some(owner => owner.querySelector('[role="dialog"][aria-modal="true"]'))
  const editable = Boolean(modal || target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="dialog"],[role="menu"],[role="listbox"],[role="option"],[data-dropdown-portal]'))
  // 空格同 PR：剪辑里任何地方都是播放/暂停。普通按钮（素材项、工具按钮）获得焦点时也不再吞掉空格——
  // 否则点过素材、拖过片段之后按空格毫无反应；只有开关、复选、单选这类“空格即切换”的控件保留原生行为。
  const nativeSpace = event.code === 'Space' && Boolean(target?.closest('[role="switch"],[role="checkbox"],[role="radio"]'))
  const panel = target?.closest<HTMLElement>('[data-video-edit-panel]')?.dataset.videoEditPanel
  const scope = panel && ['timeline', 'program', 'source', 'project', 'effects'].includes(panel) ? panel as VideoEditCommandScope : fallback
  const id = matchVideoEditShortcut(event, scope, overrides, editable || nativeSpace)
  return id ? { id, scope } : undefined
}
