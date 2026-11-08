import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

interface UiMarqueeTextProps {
  text: string
  className?: string
  /** 由外层决定何时滚动（例如整个格子悬停）；不传时悬停或聚焦文字本身才滚动。 */
  playing?: boolean
}

type MarqueeStyle = CSSProperties & {
  '--ui-marquee-distance'?: string
  '--ui-marquee-duration'?: string
}

const MARQUEE_STYLE_ELEMENT_ID = 'ui-marquee-text-keyframes'
const MARQUEE_RUN_CLASS = 'ui-marquee-run'
/** 首尾之间的空隙，与第二份文字前的 `w-8` 一致。 */
const MARQUEE_GAP_PX = 32
const MARQUEE_SPEED_PX_PER_SECOND = 30

function ensureMarqueeKeyframes(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(MARQUEE_STYLE_ELEMENT_ID)) return

  const styleEl = document.createElement('style')
  styleEl.id = MARQUEE_STYLE_ELEMENT_ID
  styleEl.textContent = `
@keyframes ui-marquee-loop {
  from { transform: translateX(0); }
  to { transform: translateX(var(--ui-marquee-distance, 0)); }
}
.${MARQUEE_RUN_CLASS} { animation: ui-marquee-loop var(--ui-marquee-duration, 6s) linear 500ms infinite; }
`
  document.head.appendChild(styleEl)
}

/**
 * 放不下的文字：静息时截断成省略号，滚动时首尾留一段空隙循环滚动。
 * 文字排两份，滚过一份文字加空隙的距离正好回到起点，所以循环没有跳变。
 * 开始滚动前停 500ms：鼠标快速划过一排格子时文字不动，免得满屏闪动。
 */
export function UiMarqueeText({ text, className = '', playing }: UiMarqueeTextProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [selfHovering, setSelfHovering] = useState(false)
  const [textWidth, setTextWidth] = useState(0)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    ensureMarqueeKeyframes()
  }, [])

  useLayoutEffect(() => {
    const containerEl = containerRef.current
    const textEl = textRef.current
    if (!containerEl || !textEl) return

    const measure = () => {
      // 截断时元素宽度只有可见部分，取 scrollWidth；滚动时取带小数的实际宽度，循环接缝才不会每圈跳半个像素
      const rectWidth = textEl.getBoundingClientRect().width
      const width = textEl.scrollWidth > rectWidth + 1 ? textEl.scrollWidth : rectWidth
      setTextWidth(prev => (prev === width ? prev : width))
      const next = textEl.scrollWidth - containerEl.clientWidth > 2
      setOverflowing(prev => (prev === next ? prev : next))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(containerEl)
    observer.observe(textEl)
    return () => observer.disconnect()
  }, [text])

  // 系统要求减少动态效果时保持省略号，不切到滚动排布（否则动画停了文字反而被硬裁）
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  const running = overflowing && !reduceMotion && (playing ?? selfHovering)
  const distance = textWidth + MARQUEE_GAP_PX
  const style: MarqueeStyle | undefined = running
    ? { '--ui-marquee-distance': `-${distance}px`, '--ui-marquee-duration': `${distance / MARQUEE_SPEED_PX_PER_SECOND}s` }
    : undefined

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
      onMouseEnter={() => setSelfHovering(true)}
      onMouseLeave={() => setSelfHovering(false)}
      onFocus={() => setSelfHovering(true)}
      onBlur={() => setSelfHovering(false)}
    >
      <span className={running ? `${MARQUEE_RUN_CLASS} flex w-max whitespace-nowrap will-change-transform` : 'flex min-w-0'} style={style}>
        <span ref={textRef} className={running ? 'shrink-0' : 'min-w-0 truncate'}>{text}</span>
        {running ? (
          <span aria-hidden className="flex shrink-0">
            <span className="w-8 shrink-0" />
            {text}
          </span>
        ) : null}
      </span>
    </div>
  )
}
