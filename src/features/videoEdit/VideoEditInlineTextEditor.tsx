import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties } from 'react'
import { ownerWindowOf } from '@/utils/crossRealmDom'

export interface VideoEditInlineTextEditorProps {
  /** 只在挂载时写入；之后正文归浏览器的编辑状态管，输入法组字不被外部重绘打断。 */
  text: string
  /** 双击位置（客户端坐标）：光标落在那里，否则放在末尾。 */
  caret?: { x: number; y: number }
  maxLength?: number
  /** 默认正文透明，看到的是画面重排后的字；改动不会马上反映到画面时（交给助手改源码）显示正文。 */
  transparent?: boolean
  ariaLabel: string
  className?: string
  style?: CSSProperties
  onText: (text: string) => void
  /** 传入时 Enter 结束编辑，Shift+Enter 换行；不传时 Enter 照常换行。 */
  onEnter?: () => void
  onEscape: () => void
  onBlur: () => void
}

/**
 * 节目画面上的原地文字编辑：透明正文叠在渲染出来的字上，只露出光标和选区，每次输入都写回作品，画面跟着重排。
 * 文字片段、字幕与代码元素共用这一个编辑框，输入法、光标与长度上限只有一份实现。
 */
export const VideoEditInlineTextEditor = forwardRef<HTMLDivElement, VideoEditInlineTextEditorProps>(function VideoEditInlineTextEditor({ text, caret, maxLength = 2000, transparent = true, ariaLabel, className = '', style, onText, onEnter, onEscape, onBlur }, ref) {
  const editor = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => editor.current!)
  useLayoutEffect(() => {
    const element = editor.current
    if (!element) return
    element.textContent = text
    element.focus()
    const doc = element.ownerDocument
    const atPoint = caret && doc.caretRangeFromPoint?.(caret.x, caret.y)
    const range = atPoint && element.contains(atPoint.startContainer) ? atPoint : doc.createRange()
    if (range !== atPoint) { range.selectNodeContents(element); range.collapse(false) }
    const selection = ownerWindowOf(element).getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
    // 正文只在挂载时写入。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <div ref={editor} role="textbox" data-content-text-editor aria-label={ariaLabel} aria-multiline contentEditable="plaintext-only" suppressContentEditableWarning className={`${transparent ? 'text-transparent' : ''} outline-none ${className}`} style={{ caretColor: 'var(--on-media)', ...style }}
    onPointerDown={event => event.stopPropagation()}
    onInput={event => {
      const raw = event.currentTarget.innerText ?? event.currentTarget.textContent ?? ''; let value = raw.slice(0, maxLength)
      if (raw.length > maxLength) {
        if (/^[\uD800-\uDBFF]$/.test(value.at(-1) ?? '')) value = value.slice(0, -1)
        event.currentTarget.textContent = value
        const range = event.currentTarget.ownerDocument.createRange(); range.selectNodeContents(event.currentTarget); range.collapse(false)
        const selection = ownerWindowOf(event.currentTarget).getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
      }
      onText(value)
    }}
    onBlur={onBlur}
    onKeyDown={event => {
      event.stopPropagation()
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Escape') { event.preventDefault(); onEscape() }
      else if (onEnter && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onEnter() }
    }} />
})
