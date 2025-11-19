import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type Option<T extends string | number | boolean> = {
  label: string
  value: T
  disabled?: boolean
}

type DropdownProps<T extends string | number | boolean> = {
  label?: string
  value?: T
  display?: string
  options?: Option<T>[]
  onSelect?: (value: T) => void
  renderPanel?: () => React.ReactNode
  disabled?: boolean
  className?: string
  buttonClassName?: string
  panelClassName?: string
  portal?: boolean
  zIndex?: number
}

export default function Dropdown<T extends string | number | boolean>(props: DropdownProps<T>) {
  const { label, value, display, options, onSelect, renderPanel, disabled, className, buttonClassName, panelClassName, portal = true, zIndex = 1000 } = props
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const [fixedPos, setFixedPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const [minWidthPx, setMinWidthPx] = useState<number | null>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) {
        if (open) {
          setClosing(true)
          setTimeout(() => { setOpen(false); setClosing(false) }, 200)
        }
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!ref.current) return
    const btn = ref.current.querySelector('[data-dropdown-button]') as HTMLElement | null
    if (!btn) return
    const computeMinWidth = () => {
      if (!portal) return
      const labels: string[] = (options || []).map(o => String((o as any).label ?? o))
      if (!labels.length) labels.push(String(display ?? value ?? ''))
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const cs = window.getComputedStyle(btn)
      const font = `${cs.fontStyle} ${cs.fontVariant} ${cs.fontWeight} ${cs.fontSize} / ${cs.lineHeight} ${cs.fontFamily}`
      ctx.font = font
      const textWidth = Math.max(...labels.map(l => ctx.measureText(l).width))
      const paddingLeft = parseFloat(cs.paddingLeft || '12')
      const paddingRight = parseFloat(cs.paddingRight || '12')
      const arrowSpace = 24
      const borderWidth = (parseFloat(cs.borderLeftWidth || '1') + parseFloat(cs.borderRightWidth || '1')) || 2
      const minW = Math.ceil(textWidth + paddingLeft + paddingRight + arrowSpace + borderWidth)
      setMinWidthPx(minW)
    }
    computeMinWidth()
  }, [options, display, value, portal])

  useEffect(() => {
    const updatePos = () => {
      if (!ref.current) return
      const el = ref.current.querySelector('[data-dropdown-button]') as HTMLElement | null
      const target = el || ref.current
      const rect = target.getBoundingClientRect()
      setFixedPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
    if (open && portal) {
      updatePos()
      const onScrollOrResize = () => updatePos()
      window.addEventListener('scroll', onScrollOrResize, true)
      window.addEventListener('resize', onScrollOrResize)
      return () => {
        window.removeEventListener('scroll', onScrollOrResize, true)
        window.removeEventListener('resize', onScrollOrResize)
      }
    }
  }, [open, portal])

  return (
    <div className={`relative inline-block ${className || ''}`} ref={ref}>
      {label ? <label className="block text-sm font-medium mb-1 text-zinc-300">{label}</label> : null}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return
          if (open) {
            setClosing(true)
            setTimeout(() => { setOpen(false); setClosing(false) }, 200)
          } else {
            setOpen(true)
          }
        }}
        data-dropdown-button
        className={
          `bg-zinc-800/70 backdrop-blur-lg border border-zinc-700/50 rounded-lg px-3 py-2 h-[38px] outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 focus-visible:ring-0 transition-all duration-300 flex items-center justify-between whitespace-nowrap ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
          } ${buttonClassName || 'w-full'}`
        }
        style={minWidthPx ? { minWidth: `${minWidthPx}px` } : undefined}
      >
        <span className="text-sm truncate">{display ?? String(value ?? '')}</span>
        <svg className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ml-2 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
      </button>
      {(open || closing) && (
        portal && fixedPos ? (
          createPortal(
            <div className={`bg-zinc-800/90 backdrop-blur-xl border border-zinc-700/50 rounded-lg shadow-lg text-white ${closing ? 'animate-scale-out' : 'animate-scale-in'} ${panelClassName || ''}`}
              style={{ position: 'fixed', top: fixedPos.top, left: fixedPos.left, width: fixedPos.width, zIndex }}
            >
              {renderPanel ? (
                <div className="max-h-60 overflow-y-auto">{renderPanel()}</div>
              ) : (
                <div className="max-h-60 overflow-y-auto">
                  {(options || []).map(opt => (
                    <div
                      key={String(opt.value)}
                      className={`px-3 py-2 transition-colors duration-200 ${(opt as any).disabled
                        ? 'opacity-50 cursor-not-allowed'
                        : value === opt.value
                          ? 'bg-[#007eff]/20 text-[#66b3ff] cursor-pointer'
                          : 'hover:bg-zinc-700/50 cursor-pointer'
                        }`}
                      onClick={() => {
                        if ((opt as any).disabled) return
                        onSelect && onSelect(opt.value)
                        setClosing(true)
                        setTimeout(() => { setOpen(false); setClosing(false) }, 200)
                      }}
                    >
                      <span className="text-sm">{opt.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>,
            document.body
          )
        ) : (
          <div className={`absolute left-0 z-50 mt-1 w-full bg-zinc-800/90 backdrop-blur-xl border border-zinc-700/50 rounded-lg shadow-lg text-white ${closing ? 'animate-scale-out' : 'animate-scale-in'} ${panelClassName || ''}`}>
            {renderPanel ? (
              <div className="max-h-60 overflow-y-auto">{renderPanel()}</div>
            ) : (
              <div className="max-h-60 overflow-y-auto">
                {(options || []).map(opt => (
                  <div
                    key={String(opt.value)}
                    className={`px-3 py-2 transition-colors duration-200 ${(opt as any).disabled
                      ? 'opacity-50 cursor-not-allowed'
                      : value === opt.value
                        ? 'bg-[#007eff]/20 text-[#66b3ff] cursor-pointer'
                        : 'hover:bg-zinc-700/50 cursor-pointer'
                      }`}
                    onClick={() => {
                      if ((opt as any).disabled) return
                      onSelect && onSelect(opt.value)
                      setClosing(true)
                      setTimeout(() => { setOpen(false); setClosing(false) }, 200)
                    }}
                  >
                    <span className="text-sm">{opt.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
}

