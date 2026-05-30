import type { ReactNode } from 'react'

const IMAGE_REFERENCE_TOKEN_REGEX = /@图\d+/g
const TEMPLATE_VARIABLE_TOKEN_REGEX = /\{\{[a-zA-Z0-9_.-]+\}\}/g

export interface PickerAnchor {
  left: number
  top: number
}

export const PICKER_FALLBACK_ANCHOR: PickerAnchor = { left: 8, top: 8 }
export const DEFAULT_PICKER_OFFSET_Y = 20

function getTextareaCaretOffset(
  textarea: HTMLTextAreaElement,
  caretIndex: number
): PickerAnchor {
  const mirror = document.createElement('div')
  const computed = window.getComputedStyle(textarea)
  const mirrorStyle = mirror.style
  mirrorStyle.position = 'absolute'
  mirrorStyle.visibility = 'hidden'
  mirrorStyle.pointerEvents = 'none'
  mirrorStyle.whiteSpace = 'pre-wrap'
  mirrorStyle.overflowWrap = 'break-word'
  mirrorStyle.wordBreak = 'break-word'
  mirrorStyle.boxSizing = computed.boxSizing
  mirrorStyle.width = `${textarea.clientWidth}px`
  mirrorStyle.font = computed.font
  mirrorStyle.lineHeight = computed.lineHeight
  mirrorStyle.letterSpacing = computed.letterSpacing
  mirrorStyle.padding = computed.padding
  mirrorStyle.border = computed.border
  mirrorStyle.textTransform = computed.textTransform
  mirrorStyle.textIndent = computed.textIndent
  mirror.textContent = textarea.value.slice(0, caretIndex)
  const marker = document.createElement('span')
  marker.textContent = textarea.value.slice(caretIndex, caretIndex + 1) || ' '
  mirror.appendChild(marker)
  document.body.appendChild(mirror)
  const left = marker.offsetLeft - textarea.scrollLeft
  const top = marker.offsetTop - textarea.scrollTop
  document.body.removeChild(mirror)
  return {
    left: Math.max(0, left),
    top: Math.max(0, top),
  }
}

export function resolvePickerAnchor(
  container: HTMLDivElement | null,
  textarea: HTMLTextAreaElement,
  caretIndex: number,
  offsetY: number,
  scale: number
): PickerAnchor {
  if (!container) {
    return PICKER_FALLBACK_ANCHOR
  }
  const containerRect = container.getBoundingClientRect()
  const textareaRect = textarea.getBoundingClientRect()
  const caretOffset = getTextareaCaretOffset(textarea, caretIndex)
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  return {
    left: Math.max(0, (textareaRect.left - containerRect.left) / safeScale + caretOffset.left),
    top: Math.max(0, (textareaRect.top - containerRect.top) / safeScale + caretOffset.top + offsetY),
  }
}

export function renderHighlightedText(text: string, tokenRegex: RegExp = IMAGE_REFERENCE_TOKEN_REGEX): ReactNode {
  if (!text) {
    return ' '
  }
  const segments: ReactNode[] = []
  let lastIndex = 0
  tokenRegex.lastIndex = 0
  let match = tokenRegex.exec(text)
  while (match) {
    const matchStart = match.index
    const matchText = match[0]

    if (matchStart > lastIndex) {
      segments.push(<span key={`plain-${lastIndex}`}>{text.slice(lastIndex, matchStart)}</span>)
    }
    segments.push(
      <span
        key={`ref-${matchStart}`}
        className="relative z-0 text-white before:absolute before:-inset-x-[4px] before:-inset-y-[1px] before:-z-10 before:rounded-[7px] before:bg-accent/55 before:content-['']"
      >
        {matchText}
      </span>
    )
    lastIndex = matchStart + matchText.length
    match = tokenRegex.exec(text)
  }
  if (lastIndex < text.length) {
    segments.push(<span key={`plain-${lastIndex}`}>{text.slice(lastIndex)}</span>)
  }
  return segments
}

export function renderHighlightedTemplateText(text: string): ReactNode {
  return renderHighlightedText(text, TEMPLATE_VARIABLE_TOKEN_REGEX)
}
