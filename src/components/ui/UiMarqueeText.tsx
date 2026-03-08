import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

interface UiMarqueeTextProps {
  text: string
  className?: string
  title?: string
}

type MarqueeStyle = CSSProperties & {
  '--ui-marquee-distance'?: string
}

const MARQUEE_STYLE_ELEMENT_ID = 'ui-marquee-text-keyframes'
const MARQUEE_KEYFRAME_NAME = 'ui-marquee-hover-scroll'

function ensureMarqueeKeyframes(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(MARQUEE_STYLE_ELEMENT_ID)) return

  const styleEl = document.createElement('style')
  styleEl.id = MARQUEE_STYLE_ELEMENT_ID
  styleEl.textContent = `
@keyframes ${MARQUEE_KEYFRAME_NAME} {
  0%, 15% { transform: translateX(0); }
  85%, 100% { transform: translateX(var(--ui-marquee-distance, 0)); }
}
`
  document.head.appendChild(styleEl)
}

export function UiMarqueeText({ text, className = '', title }: UiMarqueeTextProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [isHovering, setIsHovering] = useState(false)
  const [overflowDistance, setOverflowDistance] = useState(0)

  useEffect(() => {
    ensureMarqueeKeyframes()
  }, [])

  useLayoutEffect(() => {
    const containerEl = containerRef.current
    const textEl = textRef.current
    if (!containerEl || !textEl) return

    const measureOverflow = () => {
      const nextDistance = Math.max(0, Math.ceil(textEl.scrollWidth - containerEl.clientWidth))
      setOverflowDistance(prev => (prev === nextDistance ? prev : nextDistance))
    }

    measureOverflow()
    const observer = new ResizeObserver(measureOverflow)
    observer.observe(containerEl)
    observer.observe(textEl)
    window.addEventListener('resize', measureOverflow)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measureOverflow)
    }
  }, [text])

  const isOverflowing = overflowDistance > 2
  const durationSeconds = Math.max(2.4, overflowDistance / 26)
  const marqueeStyle: MarqueeStyle | undefined =
    isHovering && isOverflowing
      ? {
          '--ui-marquee-distance': `-${overflowDistance}px`,
          animationName: MARQUEE_KEYFRAME_NAME,
          animationDuration: `${durationSeconds}s`,
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
        }
      : undefined

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
      title={title ?? text}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onFocus={() => setIsHovering(true)}
      onBlur={() => setIsHovering(false)}
    >
      <span
        ref={textRef}
        className={`block ${isHovering && isOverflowing ? 'whitespace-nowrap will-change-transform' : 'truncate'}`}
        style={marqueeStyle}
      >
        {text}
      </span>
    </div>
  )
}
