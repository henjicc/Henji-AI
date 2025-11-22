import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

type TooltipProps = {
    children: React.ReactElement
    content: string
    delay?: number // Hover delay in milliseconds
    className?: string
}

export default function Tooltip({ children, content, delay = 500, className }: TooltipProps) {
    const [visible, setVisible] = useState(false)
    const [closing, setClosing] = useState(false)
    const [coords, setCoords] = useState({ top: 0, left: 0 })
    const timerRef = useRef<number | null>(null)
    const triggerRef = useRef<HTMLElement>(null)

    const updatePosition = () => {
        if (triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect()
            setCoords({
                top: rect.top - 8, // 8px gap
                left: rect.left + rect.width / 2
            })
        }
    }

    const handleMouseEnter = () => {
        if (timerRef.current) {
            window.clearTimeout(timerRef.current)
        }
        timerRef.current = window.setTimeout(() => {
            updatePosition()
            setVisible(true)
            setClosing(false)
        }, delay)
    }

    const handleMouseLeave = () => {
        if (timerRef.current) {
            window.clearTimeout(timerRef.current)
            timerRef.current = null
        }
        if (visible) {
            setClosing(true)
            window.setTimeout(() => {
                setVisible(false)
                setClosing(false)
            }, 300)
        }
    }

    useEffect(() => {
        const handleScrollOrResize = () => {
            if (visible && !closing) {
                updatePosition()
            }
        }

        window.addEventListener('scroll', handleScrollOrResize, true)
        window.addEventListener('resize', handleScrollOrResize)

        return () => {
            window.removeEventListener('scroll', handleScrollOrResize, true)
            window.removeEventListener('resize', handleScrollOrResize)
            if (timerRef.current) {
                window.clearTimeout(timerRef.current)
            }
        }
    }, [visible, closing])

    const tooltipContent = (
        <span
            className={`fixed z-[9999] -translate-x-1/2 -translate-y-full w-[280px] bg-zinc-800/90 border border-zinc-700/50 rounded-lg shadow-lg text-xs text-white p-3 pointer-events-none ${visible ? (closing ? 'animate-fade-out' : 'animate-fade-in') : 'hidden'
                } ${className || ''}`}
            style={{
                top: coords.top,
                left: coords.left,
            }}
        >
            {content}
        </span>
    )

    return (
        <>
            <span
                ref={triggerRef}
                className="relative inline-block"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                {children}
            </span>
            {createPortal(tooltipContent, document.body)}
        </>
    )
}
