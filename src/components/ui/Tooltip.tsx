import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

type TooltipProps = {
    children: React.ReactElement
    content: React.ReactNode
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
            className={`fixed z-tooltip -translate-x-1/2 -translate-y-full w-max max-w-[min(320px,calc(100vw-32px))] whitespace-normal text-left leading-5 bg-surface-dark/90 border border-border-dark/50 rounded-lg shadow-panel text-xs text-white p-3 pointer-events-none ${visible ? (closing ? 'animate-fade-out' : 'animate-fade-in') : 'hidden'
                } ${className || ''}`}
            style={{
                top: coords.top,
                left: coords.left,
            }}
        >
            {content}
        </span>
    )

    // Extract className from children to apply to wrapper
    const childClassName = children.props.className || ''
    const shouldFlex = childClassName.includes('flex-1') || childClassName.includes('flex-grow')

    return (
        <>
            <span
                ref={triggerRef}
                className={`relative ${shouldFlex ? 'flex' : 'inline-block'} ${shouldFlex ? childClassName.match(/flex-\d+|flex-grow/)?.[0] || '' : ''}`}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                {children}
            </span>
            {createPortal(tooltipContent, document.body)}
        </>
    )
}
