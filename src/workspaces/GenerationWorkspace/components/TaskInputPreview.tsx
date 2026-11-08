import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import React, { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/hooks/useI18n'
import { AudioLines, Play } from 'lucide-react'
import Tooltip from '@/components/ui/Tooltip'
import { toDisplaySrc } from '@/platform/desktopApi'

export interface TaskInputPreviewProps {
  taskId: string
  inputImages: string[]
  inputVideos: string[]
  uploadedFilePaths?: string[]
  uploadedVideoFilePaths?: string[]
  uploadedAudioFilePaths?: string[]
  onOpenImage: (url: string, list: string[], filePaths: string[]) => void
  onOpenVideo: (url: string, filePath?: string) => void
  onOpenAudio: (url: string, filePath?: string) => void
  onStartImageDrag?: (e: React.MouseEvent, imageUrl: string, filePath?: string) => void
  onStartVideoDrag?: (e: React.MouseEvent, videoUrl: string, filePath?: string) => void
  onStartImageNativeDrag?: (e: React.DragEvent, imageUrl: string, filePath?: string) => void
  onStartVideoNativeDrag?: (e: React.DragEvent, videoUrl: string, filePath?: string) => void
  onNativeDragEnd?: () => void
  nativeFileDragEnabled?: boolean
  shouldIgnoreClick?: () => boolean
}

interface InputItem {
  kind: 'image' | 'video' | 'audio'
  src: string
  filePath?: string
}

/** 参考素材统一按 9:16 竖卡显示；收起时最多叠 3 张。 */
const CARD_WIDTH = 56
const CARD_HEIGHT = Math.round(CARD_WIDTH * 16 / 9)
const CARD_GAP = 8
const STACKED = 3
/** 收起时后面两张往右错开并微微转开，像一叠卡片。 */
const STACK_OFFSET = [{ x: 0, rotate: 0 }, { x: 9, rotate: 6 }, { x: 18, rotate: 12 }]
/** 堆叠占位：最后一张卡转开后的外沿（转角会让卡片右上角再往外伸一点）。 */
function stackWidth(count: number): number {
  const last = Math.min(count, STACKED) - 1
  return CARD_WIDTH + STACK_OFFSET[last].x + (last > 0 ? 8 : 0)
}

/**
 * 生成记录左侧的参考素材堆：收起是一叠卡片，点开后在本行铺开（盖住右侧的提示词与信息），
 * 铺开后点卡片查看，悬停出大图气泡；点空白处或按 Esc 收起。只有一张时点开直接查看。
 * 所在行需要 `relative`：铺开层相对整行定位。
 */
export function TaskInputPreview({
  taskId,
  inputImages,
  inputVideos,
  uploadedFilePaths,
  uploadedVideoFilePaths,
  uploadedAudioFilePaths,
  onOpenImage,
  onOpenVideo,
  onOpenAudio,
  onStartImageDrag,
  onStartVideoDrag,
  onStartImageNativeDrag,
  onStartVideoNativeDrag,
  onNativeDragEnd,
  nativeFileDragEnabled = false,
  shouldIgnoreClick,
}: TaskInputPreviewProps): JSX.Element | null {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const layerRef = useRef<HTMLDivElement>(null)
  const items: InputItem[] = [
    ...inputImages.map((src, index) => ({ kind: 'image' as const, src, filePath: uploadedFilePaths?.[index] })),
    ...inputVideos.map((src, index) => ({ kind: 'video' as const, src, filePath: uploadedVideoFilePaths?.[index] })),
    ...(uploadedAudioFilePaths ?? []).map(filePath => ({ kind: 'audio' as const, src: toDisplaySrc(filePath.replace(/\\/g, '/')), filePath })),
  ]

  useEffect(() => {
    if (!expanded) return
    const collapse = (event: PointerEvent): void => {
      if (!layerRef.current?.contains(event.target as Node)) setExpanded(false)
    }
    // 查看器等模态层开着时 Esc 属于它们，不顺带收起这一叠。
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"]')) setExpanded(false)
    }
    document.addEventListener('pointerdown', collapse, true)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', collapse, true)
      document.removeEventListener('keydown', escape)
    }
  }, [expanded])

  if (items.length === 0) return null

  const open = (item: InputItem): void => {
    if (shouldIgnoreClick?.()) return
    if (item.kind === 'image') onOpenImage(item.src, inputImages, uploadedFilePaths ?? [])
    else if (item.kind === 'video') onOpenVideo(item.src, item.filePath)
    else onOpenAudio(item.src, item.filePath)
  }
  const activate = (item: InputItem): void => {
    if (expanded || items.length === 1) open(item)
    else if (!shouldIgnoreClick?.()) setExpanded(true)
  }

  const preview = (item: InputItem): React.ReactNode => {
    // 收起时悬停在一叠上不弹大图（看不出指的是哪张）；只有一张时就是它本身。
    if (!expanded && items.length > 1) return null
    if (item.kind === 'image') return <img src={item.src} alt="" className="block max-h-60 max-w-full rounded-control object-contain" draggable={false} />
    if (item.kind === 'video') return <video src={item.src} className="block max-h-60 max-w-full rounded-control" muted autoPlay loop playsInline />
    return <span className="block truncate">{item.filePath?.split(/[\\/]/).pop()}</span>
  }

  const card = (item: InputItem, index: number): JSX.Element => {
    const stackIndex = Math.min(index, STACKED - 1)
    const offset = STACK_OFFSET[stackIndex]
    const hidden = !expanded && index >= STACKED
    const x = expanded ? index * (CARD_WIDTH + CARD_GAP) : offset.x
    const style: React.CSSProperties = {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      transform: `translateX(${x}px) rotate(${expanded ? 0 : offset.rotate}deg)`,
      zIndex: items.length - index,
      opacity: hidden ? 0 : 1,
    }
    const label = item.kind === 'image'
      ? t('ui:workspace.inputImageAlt', { index: index + 1 })
      : item.kind === 'video' ? t('ui:viewer.videoAlt') : t('ui:viewer.audioAlt')
    return (
      // 铺开时换一个 Tooltip 实例：点开那一下会让原实例在指针移出前不再弹气泡。
      <Tooltip key={`${taskId}-${item.kind}-${index}-${expanded ? 'open' : 'stack'}`} asChild content={preview(item)}>
        <div
          aria-label={label}
          className={`absolute left-0.5 top-0.5 origin-bottom-left cursor-pointer overflow-hidden rounded-lg bg-media ring-2 ring-window transition-[transform,opacity] duration-240 ease-out ${hidden ? 'pointer-events-none' : ''}`}
          style={style}
          onClick={(event) => { event.stopPropagation(); activate(item) }}
          onMouseDown={(event) => {
            if (item.kind === 'audio') return
            event.stopPropagation()
            if (item.kind === 'image') onStartImageDrag?.(event, item.src, item.filePath)
            else onStartVideoDrag?.(event, item.src, item.filePath)
          }}
          draggable={nativeFileDragEnabled && item.kind !== 'audio' && Boolean(item.filePath)}
          onDragStart={(event) => {
            event.stopPropagation()
            if (item.kind === 'image') onStartImageNativeDrag?.(event, item.src, item.filePath)
            else if (item.kind === 'video') onStartVideoNativeDrag?.(event, item.src, item.filePath)
          }}
          onDragEnd={onNativeDragEnd}
        >
          {item.kind === 'image' && <img src={item.src} alt={label} className="h-full w-full object-cover" draggable={false} />}
          {item.kind === 'video' && (
            <>
              <video src={item.src} className="h-full w-full object-cover" muted draggable={false} />
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-media-scrim">
                <Play className={`${UI_ICON_SIZE_CLASS.md} text-on-media`} />
              </span>
            </>
          )}
          {item.kind === 'audio' && (
            <span className="flex h-full w-full items-center justify-center bg-raised text-text2">
              <AudioLines className={UI_ICON_SIZE_CLASS.lg} />
            </span>
          )}
        </div>
      </Tooltip>
    )
  }

  const extra = items.length - STACKED
  const collapsedWidth = stackWidth(items.length)
  return (
    <>
      {/* 占住堆叠的位置；卡片本身画在相对整行定位的层里，铺开时才能盖住右侧 */}
      <div aria-hidden className="shrink-0" style={{ width: collapsedWidth, height: CARD_HEIGHT }} />
      <div
        ref={layerRef}
        role="group"
        aria-label={t('ui:workspace.inputMaterials')}
        className={`absolute -left-0.5 -top-0.5 z-raised ${expanded ? 'right-0 overflow-x-auto overflow-y-hidden bg-window' : ''}`}
        style={{ width: expanded ? undefined : collapsedWidth }}
        onClick={(event) => { if (event.target === event.currentTarget) setExpanded(false) }}
      >
        {/* 四周留 2px 给卡片的分隔描边，铺开滚动时不被裁掉 */}
        <div className="relative" style={{ height: CARD_HEIGHT + 4, width: expanded ? items.length * (CARD_WIDTH + CARD_GAP) : collapsedWidth }} onClick={(event) => { if (event.target === event.currentTarget) setExpanded(false) }}>
          {items.map(card)}
          {!expanded && extra > 0 && (
            <span className="pointer-events-none absolute bottom-1 left-1 z-sticky rounded-control bg-media-scrim px-1 text-2xs tabular-nums text-on-media">
              {items.length}
            </span>
          )}
        </div>
      </div>
    </>
  )
}
