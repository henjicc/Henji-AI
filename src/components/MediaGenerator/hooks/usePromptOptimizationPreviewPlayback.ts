import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'

const PREVIEW_CLOSE_MS = 220
const GLYPH_REVEAL_INTERVAL_MS = 18

export interface PromptOptimizationPreviewSource {
  active: boolean
  reasoning: string
  content: string
}

export interface PromptOptimizationPreviewGlyph {
  id: string
  value: string
}

interface PromptOptimizationPreviewPlaybackState {
  visible: boolean
  closing: boolean
  reasoningGlyphs: PromptOptimizationPreviewGlyph[]
  contentGlyphs: PromptOptimizationPreviewGlyph[]
}

interface PromptOptimizationPreviewPlaybackResult {
  closing: boolean
  contentGlyphs: PromptOptimizationPreviewGlyph[]
  hasContent: boolean
  reasoningGlyphs: PromptOptimizationPreviewGlyph[]
  visible: boolean
}

function splitGraphemes(value: string): string[] {
  if (!value) {
    return []
  }

  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' })
    return Array.from(segmenter.segment(value), segment => segment.segment)
  }

  return Array.from(value)
}

function buildGlyphs(
  value: string,
  sequenceRef: MutableRefObject<number>
): PromptOptimizationPreviewGlyph[] {
  return splitGraphemes(value).map(glyph => ({
    id: `glyph-${sequenceRef.current++}`,
    value: glyph,
  }))
}

export function usePromptOptimizationPreviewPlayback(
  preview?: PromptOptimizationPreviewSource
): PromptOptimizationPreviewPlaybackResult {
  const [state, setState] = useState<PromptOptimizationPreviewPlaybackState>({
    visible: false,
    closing: false,
    reasoningGlyphs: [],
    contentGlyphs: [],
  })
  const sourceReasoningRef = useRef('')
  const sourceContentRef = useRef('')
  const reasoningQueueRef = useRef<PromptOptimizationPreviewGlyph[]>([])
  const contentQueueRef = useRef<PromptOptimizationPreviewGlyph[]>([])
  const playbackFrameRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const lastRevealAtRef = useRef(0)
  const sequenceRef = useRef(0)

  const stopPlayback = useCallback((): void => {
    if (playbackFrameRef.current !== null) {
      window.cancelAnimationFrame(playbackFrameRef.current)
      playbackFrameRef.current = null
    }
  }, [])

  const resetAll = useCallback((): void => {
    stopPlayback()
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    sourceReasoningRef.current = ''
    sourceContentRef.current = ''
    reasoningQueueRef.current = []
    contentQueueRef.current = []
    lastRevealAtRef.current = 0
    setState({
      visible: false,
      closing: false,
      reasoningGlyphs: [],
      contentGlyphs: [],
    })
  }, [stopPlayback])

  useEffect(() => {
    return () => {
      stopPlayback()
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
    }
  }, [stopPlayback])

  useEffect(() => {
    const nextPreview = preview ?? { active: false, reasoning: '', content: '' }

    if (nextPreview.active) {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }

      setState(previous => ({
        ...previous,
        visible: true,
        closing: false,
      }))

      if (nextPreview.reasoning.startsWith(sourceReasoningRef.current)) {
        const delta = nextPreview.reasoning.slice(sourceReasoningRef.current.length)
        reasoningQueueRef.current.push(...buildGlyphs(delta, sequenceRef))
      } else if (nextPreview.reasoning !== sourceReasoningRef.current) {
        reasoningQueueRef.current = []
        setState(previous => ({
          ...previous,
          reasoningGlyphs: buildGlyphs(nextPreview.reasoning, sequenceRef),
        }))
      }

      if (nextPreview.content.startsWith(sourceContentRef.current)) {
        const delta = nextPreview.content.slice(sourceContentRef.current.length)
        contentQueueRef.current.push(...buildGlyphs(delta, sequenceRef))
      } else if (nextPreview.content !== sourceContentRef.current) {
        contentQueueRef.current = []
        setState(previous => ({
          ...previous,
          contentGlyphs: buildGlyphs(nextPreview.content, sequenceRef),
        }))
      }

      sourceReasoningRef.current = nextPreview.reasoning
      sourceContentRef.current = nextPreview.content
      return
    }

    if (!state.visible) {
      return
    }

    if (reasoningQueueRef.current.length > 0 || contentQueueRef.current.length > 0) {
      setState(previous => ({
        ...previous,
        reasoningGlyphs: previous.reasoningGlyphs.concat(reasoningQueueRef.current),
        contentGlyphs: previous.contentGlyphs.concat(contentQueueRef.current),
      }))
      reasoningQueueRef.current = []
      contentQueueRef.current = []
    }

    setState(previous => ({
      ...previous,
      closing: true,
    }))

    closeTimerRef.current = window.setTimeout(() => {
      resetAll()
    }, PREVIEW_CLOSE_MS)
  }, [preview, resetAll, state.visible])

  useEffect(() => {
    if (!state.visible) {
      stopPlayback()
      return
    }

    const tick = (timestamp: number): void => {
      if (lastRevealAtRef.current === 0) {
        lastRevealAtRef.current = timestamp
      }

      if (timestamp - lastRevealAtRef.current >= GLYPH_REVEAL_INTERVAL_MS) {
        const nextContentGlyph = contentQueueRef.current.shift()
        const nextReasoningGlyph = nextContentGlyph ? null : contentQueueRef.current.length === 0 ? reasoningQueueRef.current.shift() ?? null : null

        if (nextContentGlyph) {
          setState(previous => ({
            ...previous,
            contentGlyphs: previous.contentGlyphs.concat(nextContentGlyph),
          }))
          lastRevealAtRef.current = timestamp
        } else if (nextReasoningGlyph) {
          setState(previous => ({
            ...previous,
            reasoningGlyphs: previous.reasoningGlyphs.concat(nextReasoningGlyph),
          }))
          lastRevealAtRef.current = timestamp
        }
      }

      if (state.visible) {
        playbackFrameRef.current = window.requestAnimationFrame(tick)
      }
    }

    playbackFrameRef.current = window.requestAnimationFrame(tick)
    return () => {
      stopPlayback()
    }
  }, [state.visible, stopPlayback])

  const hasContent = useMemo(() => {
    return state.reasoningGlyphs.length > 0 || state.contentGlyphs.length > 0
  }, [state.contentGlyphs.length, state.reasoningGlyphs.length])

  return {
    closing: state.closing,
    contentGlyphs: state.contentGlyphs,
    hasContent,
    reasoningGlyphs: state.reasoningGlyphs,
    visible: state.visible,
  }
}
