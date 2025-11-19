import React, { useState, useRef, useEffect } from 'react'

type TooltipProps = {
    children: React.ReactElement
    content: string
    delay?: number // Hover delay in milliseconds
    className?: string
}

export default function Tooltip({ children, content, delay = 500, className }: TooltipProps) {
    const [visible, setVisible] = useState(false)
    const [closing, setClosing] = useState(false)
    const timerRef = useRef<number | null>(null)

    const handleMouseEnter = () => {
        if (timerRef.current) {
            window.clearTimeout(timerRef.current)
        }
        timerRef.current = window.setTimeout(() => {
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
        return () => {
            if (timerRef.current) {
                window.clearTimeout(timerRef.current)
            }
        }
    }, [])

    return (
        <span
            className="relative inline-block"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {children}
            <span
                className={`absolute z-20 left-1/2 -translate-x-1/2 bottom-full mb-2 w-[280px] bg-zinc-800/90 border border-zinc-700/50 rounded-lg shadow-lg text-xs text-white p-3 ${visible ? (closing ? 'animate-fade-out' : 'animate-fade-in') : 'hidden'
                    } ${className || ''}`}
            >
                {content}
            </span>
        </span>
    )
}
