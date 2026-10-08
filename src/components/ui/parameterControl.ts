import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { GestureProps } from './UiColorGrading'

export interface ParameterControlProps<T> extends GestureProps {
  value: T
  onChange: (next: T) => void
  defaultValue?: T
  label?: string
  'aria-label'?: string
  size?: 'sm' | 'md'
}

export const clampParameter = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value))
export const wrapParameter = (value: number, min: number, max: number): number => max > min ? ((value - min) % (max - min) + max - min) % (max - min) + min : min
export const parameterKeyStep = (key: string, shift: boolean, step: number): number =>
  (key === 'ArrowUp' || key === 'ArrowRight' ? 1 : key === 'ArrowDown' || key === 'ArrowLeft' ? -1 : 0) * step * (shift ? 10 : 1)

/** Unit coordinates are deliberately not clamped: editors use the outside region to remove handles. */
export function parameterPosition(event: ReactPointerEvent<HTMLElement | SVGElement>): { x: number; y: number } {
  const rect = event.currentTarget.getBoundingClientRect()
  return { x: (event.clientX - rect.left) / (rect.width || 1), y: (event.clientY - rect.top) / (rect.height || 1) }
}

/** One transaction per pointer capture. Clear the session before releasing capture to avoid a second cancel. */
export function useParameterGesture(props: GestureProps) {
  const callbacks = useRef(props)
  callbacks.current = props
  const session = useRef<{ pointerId: number; target: HTMLElement | SVGElement } | null>(null)
  const end = useCallback((cancelled: boolean): void => {
    const active = session.current
    if (!active) return
    session.current = null
    if (active.target.hasPointerCapture?.(active.pointerId)) active.target.releasePointerCapture(active.pointerId)
    if (cancelled) callbacks.current.onCancel()
    else callbacks.current.onFinish()
  }, [])
  useEffect(() => {
    if (props.disabled) end(true)
  }, [props.disabled, end])
  useEffect(() => () => end(true), [end])
  const begin = (event: ReactPointerEvent<HTMLElement | SVGElement>): boolean => {
    if (callbacks.current.disabled || event.button !== 0 || session.current) return false
    event.preventDefault()
    event.currentTarget.focus()
    session.current = { pointerId: event.pointerId, target: event.currentTarget }
    callbacks.current.onBegin()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    return true
  }
  const active = (event: ReactPointerEvent<HTMLElement | SVGElement>): boolean => !callbacks.current.disabled && session.current?.pointerId === event.pointerId
  const atomic = (write: () => void): void => {
    if (callbacks.current.disabled || session.current) return
    callbacks.current.onBegin()
    write()
    callbacks.current.onFinish()
  }
  return {
    begin, active, atomic,
    handlers: {
      onPointerUp: (event: ReactPointerEvent<HTMLElement | SVGElement>) => { if (active(event)) end(false) },
      onPointerCancel: (event: ReactPointerEvent<HTMLElement | SVGElement>) => { if (active(event)) end(true) },
      onLostPointerCapture: (event: ReactPointerEvent<HTMLElement | SVGElement>) => { if (active(event)) end(true) },
      onKeyDownCapture: (event: React.KeyboardEvent) => {
        if (event.key === 'Escape' && session.current) { event.preventDefault(); event.stopPropagation(); end(true) }
      },
    },
  }
}
