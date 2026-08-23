import { useCallback, useEffect, useMemo, useRef } from 'react'

import type { VideoTrimRange } from '@/components/videoTrim/VideoTrimModal'
import { useCanvasStore } from '@/stores/canvasStore'

interface UseNodeVideoTrimRangeOptions {
  nodeId: string
  videos: string[]
  start: number | undefined
  end: number | undefined
}

export function useNodeVideoTrimRange({
  nodeId,
  videos,
  start,
  end,
}: UseNodeVideoTrimRangeOptions): {
  videoTrimRange: VideoTrimRange | null
  handleVideoTrimRangeChange: (range: VideoTrimRange) => void
} {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)
  const videoTrimRange = useMemo(
    () => (typeof start === 'number' && typeof end === 'number' ? { start, end } : null),
    [end, start]
  )
  const handleVideoTrimRangeChange = useCallback((range: VideoTrimRange) => {
    updateNodeData(nodeId, { videoTrimStart: range.start, videoTrimEnd: range.end })
  }, [nodeId, updateNodeData])

  // 换了一个视频时清空裁剪选区；同一视频重新拖选区不会替换完整视频引用。
  const primaryVideoRef = useRef<string | null>(null)
  useEffect(() => {
    const primaryVideo = videos[0] ?? null
    if (primaryVideoRef.current !== null && primaryVideoRef.current !== primaryVideo && (start !== undefined || end !== undefined)) {
      updateNodeData(nodeId, { videoTrimStart: undefined, videoTrimEnd: undefined })
    }
    primaryVideoRef.current = primaryVideo
  }, [end, nodeId, start, updateNodeData, videos])

  return { videoTrimRange, handleVideoTrimRangeChange }
}
