import { UI_COVER_FRAME_CLASS, UI_COVER_GROUP_CLASS, UI_ICON_SIZE_CLASS, UI_TOOLTIP_MEDIA_CLASS } from '@/components/ui/styleTokens'
import { createLogger } from '@/core/logging'
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { readFile } from '@/platform/desktopApi'
import { AudioLines, Play, Plus, RefreshCw, Scissors, X } from 'lucide-react'
import { useDragDrop } from '@/contexts/DragDropContext'
import { readHenjiDragData, type HenjiDragTransferData } from '@/contexts/dragDataTransfer'
import { useNativeDragDrop } from '@/hooks/useNativeDragDrop'
import { urlToFile } from '@/utils/imageConversion'
import { toFetchableMediaUrl } from '@/services/imageSource'
import { inferMimeFromPath, isDesktop } from '@/utils/save'
import { UiIconButton, UiInput, UiOptionButton } from '../primitives'
import { UI_DURATION, UI_EASE, UI_EASE_STACK } from '../motion'
import { useReorderDrag } from './useReorderDrag'
import Tooltip from '../Tooltip'

const logger = createLogger('components.ui.fileUploader.MediaStripUploader')

type MediaType = 'image' | 'video' | 'audio'

/** 宿主把“添加素材”入口放在别处（如生成输入区底栏的“+”）时，经此打开同一个文件选择器。 */
export interface MediaStripUploaderHandle {
  openFilePicker: () => void
}

interface MediaStripUploaderProps {
  files: string[]
  fileTypes?: MediaType[]
  onUpload: (files: File[]) => Promise<void> | void
  onRemove: (index: number) => void
  onReplace?: (index: number, file: File) => Promise<void> | void
  onTrim?: (index: number) => void
  onReorder?: (from: number, to: number) => void
  onFileClick?: (fileUrl: string, fileList: string[]) => void
  onDragStateChange?: (isDragging: boolean) => void
  accept?: string
  multiple?: boolean
  maxCount?: number
  hideUploadButton?: boolean
  disabled?: boolean
  hintText?: string
  /** 每张的编号；不传时按类型各自从 1 数。混合素材调换过顺序时由宿主给出与提示词引用一致的序号 */
  fileNumbers?: number[]
  /** 素材增删之前调用：宿主借此记下布局，让卡片与下方输入框滑到新位置 */
  onBeforeLayoutChange?: () => void
}

function inferVideoMimeFromPath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.mov')) return 'video/quicktime'
  if (lower.endsWith('.avi')) return 'video/x-msvideo'
  if (lower.endsWith('.mkv')) return 'video/x-matroska'
  return 'video/mp4'
}

function inferAudioMimeFromPath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.flac')) return 'audio/flac'
  if (lower.endsWith('.ogg')) return 'audio/ogg'
  if (lower.endsWith('.m4a')) return 'audio/mp4'
  return 'audio/mpeg'
}

async function dragTransferDataToFile(dragData: HenjiDragTransferData): Promise<File | null> {
  if (dragData.type === 'image') {
    if (dragData.filePath && isDesktop()) {
      const bytes = await readFile(dragData.filePath)
      const mime = inferMimeFromPath(dragData.filePath)
      const blob = new Blob([bytes], { type: mime })
      const filename = dragData.filePath.split(/[\\/]/).pop() || `image-${Date.now()}.jpg`
      return new File([blob], filename, { type: mime })
    }

    return await urlToFile(toFetchableMediaUrl(dragData.imageUrl), `image-${Date.now()}.jpg`)
  }

  if (dragData.type === 'video' && dragData.filePath && isDesktop()) {
    const bytes = await readFile(dragData.filePath)
    const mime = inferVideoMimeFromPath(dragData.filePath)
    const blob = new Blob([bytes], { type: mime })
    const filename = dragData.filePath.split(/[\\/]/).pop() || `video-${Date.now()}.mp4`
    return new File([blob], filename, { type: mime })
  }

  if (dragData.type === 'audio' && dragData.filePath && isDesktop()) {
    const bytes = await readFile(dragData.filePath)
    const mime = inferAudioMimeFromPath(dragData.filePath)
    const blob = new Blob([bytes], { type: mime })
    const filename = dragData.filePath.split(/[\\/]/).pop() || `audio-${Date.now()}.mp3`
    return new File([blob], filename, { type: mime })
  }

  return null
}

/** 卡片按 3:4 竖幅（h-16 w-12） */
const CARD_FRAME_CLASS = 'h-16 w-12'
/** 相邻两张卡片左缘的距离：卡片 48 + 间距 8（gap-2），拖动时其余卡片按它让位 */
const CARD_STEP_PX = 56

function matchesAccept(file: File, accept: string): boolean {
  if (accept === '*') return true
  return accept.split(',').some((pattern) => file.type.startsWith(pattern.trim().replace('/*', '/')))
}

/**
 * 参考素材条：一排常驻的缩略图，每张带与提示词引用一致的编号（“@图片1”“@视频1”），
 * 可拖动排序、点开预览，悬停出删除、替换、裁剪；放不下时横向滚动。
 */
export const MediaStripUploader = forwardRef<MediaStripUploaderHandle, MediaStripUploaderProps>(function MediaStripUploader({
  files,
  fileTypes,
  onUpload,
  onRemove,
  onReplace,
  onTrim,
  onReorder,
  onFileClick,
  onDragStateChange,
  accept = 'image/*',
  multiple = false,
  maxCount = 1,
  hideUploadButton = false,
  disabled = false,
  hintText,
  fileNumbers,
  onBeforeLayoutChange,
}, ref): JSX.Element {
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null)
  const [isHtmlDragging, setIsHtmlDragging] = useState(false)
  const dragCounter = useRef(0)
  const { isDragging: isCustomDragging, dragData, endDrag } = useDragDrop()
  const { isDragging: isNativeDragging, elementRef } = useNativeDragDrop((droppedFiles) => {
    void handleFiles(droppedFiles)
  }, disabled)
  const isDragging = isHtmlDragging || isCustomDragging || isNativeDragging
  const canUploadMore = !maxCount || files.length < maxCount
  const showUploadCard = canUploadMore && !hideUploadButton && !disabled

  const openFilePicker = (): void => {
    if (disabled) return
    uploadInputRef.current?.click()
  }

  useImperativeHandle(ref, () => ({ openFilePicker }))

  const { dragState, itemRefs, handleMouseDown } = useReorderDrag({
    disabled,
    isCustomDragging,
    files,
    allowButtonTarget: true,
    onReorder,
    onDragStateChange,
    onImageClick: onFileClick,
  })

  const handleFiles = async (incomingFiles: File[]): Promise<void> => {
    if (disabled || incomingFiles.length === 0) return
    const acceptedFiles = incomingFiles.filter((file) => matchesAccept(file, accept))
    if (acceptedFiles.length === 0) return
    onBeforeLayoutChange?.()
    await onUpload(multiple ? acceptedFiles : [acceptedFiles[0]])
  }

  const handleUploadChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const nextFiles = event.target.files ? Array.from(event.target.files) : []
    event.currentTarget.value = ''
    await handleFiles(nextFiles)
  }

  const handleReplaceChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    if (!onReplace || replaceIndex === null) return
    const nextFile = event.target.files?.[0]
    event.currentTarget.value = ''
    if (!nextFile) return
    await onReplace(replaceIndex, nextFile)
    setReplaceIndex(null)
  }

  const handleDragEnter = (event: React.DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    dragCounter.current += 1
    setIsHtmlDragging(true)
  }

  const handleDragLeave = (event: React.DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    dragCounter.current -= 1
    if (dragCounter.current <= 0) {
      setIsHtmlDragging(false)
      dragCounter.current = 0
    }
  }

  const handleDrop = async (event: React.DragEvent): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()
    setIsHtmlDragging(false)
    dragCounter.current = 0
    if (disabled) return
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      await handleFiles(Array.from(event.dataTransfer.files))
      return
    }
    const transferredDragData = readHenjiDragData(event.dataTransfer)
    if (!transferredDragData) return
    try {
      const file = await dragTransferDataToFile(transferredDragData)
      if (file) await handleFiles([file])
    } catch (error) {
      logger.error('MediaStripUploader convert transferred drag data failed', error)
    }
  }

  const handleCustomDrop = async (): Promise<void> => {
    if (!isCustomDragging || !dragData) return
    try {
      const file = await dragTransferDataToFile(dragData)
      if (file) await handleFiles([file])
    } catch (error) {
      logger.error(`MediaStripUploader convert ${dragData.type} failed`, error)
    }
    endDrag()
  }

  const typeOf = (index: number): MediaType => fileTypes?.[index] ?? (accept === 'audio/*' ? 'audio' : 'image')
  // 编号按类型各自从 1 数起，与提示词里的“@图片1”“@视频1”对得上
  const typeNumbers = fileNumbers ?? files.map((_, index) => files.slice(0, index + 1).filter((__, i) => typeOf(i) === typeOf(index)).length)
  // 同一个素材加了两次时，位移过渡靠出现次数区分
  const flipKeys = files.map((file, index) => `media-${file}-${files.slice(0, index).filter(other => other === file).length}`)

  /**
   * 拖动排序：被拖的卡片只跟随横向移动（素材条只有一行，纵向位移会被滚动层裁掉），其余卡片实时让出目标位置；
   * 松手后被拖的卡片滑进空位，排序生效时布局与当前画面一致，不再有第二段动画。
   * 过渡只在拖动与落下期间打开：排序生效那一帧位移归零必须瞬间完成，否则卡片会先跳开再滑回来。
   */
  const reorderStyle = (index: number): React.CSSProperties | undefined => {
    const { isDragging: dragging, isDropping, fromIndex, toIndex } = dragState
    if ((!dragging && !isDropping) || fromIndex === null || toIndex === null) return undefined
    if (index === fromIndex) {
      return dragging
        ? { transform: `translateX(${dragState.currentX - dragState.startX}px)`, zIndex: 1 }
        : { transform: `translateX(${(toIndex - fromIndex) * CARD_STEP_PX}px)`, zIndex: 1, transition: `transform ${UI_DURATION.fast}ms ${UI_EASE}` }
    }
    const shift = fromIndex < toIndex
      ? (index > fromIndex && index <= toIndex ? -CARD_STEP_PX : 0)
      : (index >= toIndex && index < fromIndex ? CARD_STEP_PX : 0)
    return { transform: shift ? `translateX(${shift}px)` : undefined, transition: `transform ${UI_DURATION.base}ms ${UI_EASE_STACK}` }
  }

  return (
    <div ref={elementRef} data-media-strip=""
      className={`flex min-w-0 rounded-xl transition-colors duration-120 ${isDragging ? 'bg-raised' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={(event) => { event.preventDefault(); event.stopPropagation() }}
      onDragLeave={handleDragLeave}
      onDrop={(event) => void handleDrop(event)}
      onMouseUp={() => void handleCustomDrop()}>
      {/* 拖动排序时不滚动：被拖的卡片超出末尾会撑出一条闪现的滚动条 */}
      <div className={`ui-scrollbar flex min-w-0 items-center gap-2 overflow-y-hidden px-1.5 py-1.5 ${dragState.isDragging || dragState.isDropping ? 'overflow-x-hidden' : 'overflow-x-auto'}`}>
        {files.map((file, index) => {
          const type = typeOf(index)
          const reordering = (dragState.isDragging || dragState.isDropping) && dragState.fromIndex !== null && dragState.toIndex !== null
          const draggingThis = reordering && dragState.fromIndex === index
          // 拖动排序时收起悬停按钮，免得跟着卡片一起飘
          const actionsHidden = reordering ? 'invisible' : ''
          return (
            <div key={flipKeys[index]} data-flip-key={flipKeys[index]} data-uploader-item={index}
              ref={(element) => { itemRefs.current[index] = element }}
              className="group relative shrink-0"
              style={reorderStyle(index)}
              onMouseDown={(event) => handleMouseDown(index, event)}>
              {/* 卡片外观画在封面框上：悬停发丝线与键盘焦点环由封面卡统一提供 */}
              {/* 缩略图较小，悬停看大图；拖动排序时按下即收起（Tooltip 按下后不再弹出） */}
              {/* 视频条目的 file 是封面图，与缩略图一样用 img 显示 */}
              <Tooltip asChild appearance="media" content={type === 'audio' ? null
                : <img src={file} alt="" className={UI_TOOLTIP_MEDIA_CLASS} draggable={false} />}>
              <UiOptionButton type="button" variant="cover" aria-label={`${type === 'video' ? '视频' : type === 'audio' ? '音频' : '图片'} ${typeNumbers[index]}`}
                className={`${UI_COVER_GROUP_CLASS} shrink-0`}
                // 鼠标点击由拖动排序的钩子判定（没拖动才算点开）；键盘回车、以及提交中拖动被停用时在这里打开预览
                onClick={(event) => { if (event.detail === 0 || disabled) onFileClick?.(file, files) }}>
                <span className={`${UI_COVER_FRAME_CLASS} ${CARD_FRAME_CLASS} rounded-lg ${draggingThis ? 'shadow-thumb' : ''}`}>
                {type === 'audio' ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-raised">
                    <AudioLines aria-hidden="true" className={`${UI_ICON_SIZE_CLASS.lg} text-text2`} />
                  </span>
                ) : (
                  <img src={file} alt={`参考 ${index + 1}`} className="absolute inset-0 block h-full w-full object-cover" draggable={false} />
                )}
                {type === 'video' && (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-media-scrim text-on-media">
                    <Play aria-hidden="true" className={`${UI_ICON_SIZE_CLASS.sm} fill-current`} />
                  </span>
                )}
                <span className="pointer-events-none absolute left-1 top-1 rounded-control bg-media-scrim px-1 font-mono text-2xs leading-4 text-on-media">
                  {typeNumbers[index]}
                </span>
                </span>
              </UiOptionButton>
              </Tooltip>
              <UiIconButton size="2xs" tone="media" shape="circle" type="button" label="移除" tooltip="移除"
                className={`absolute -right-1.5 -top-1.5 opacity-0 transition-opacity duration-120 group-hover:opacity-100 focus-visible:opacity-100 ${actionsHidden}`}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); onBeforeLayoutChange?.(); onRemove(index) }}>
                <X />
              </UiIconButton>
              {onReplace && (
                <UiIconButton size="2xs" tone="media" type="button" label="替换" tooltip="替换"
                  className={`absolute -bottom-1.5 -right-1.5 opacity-0 transition-opacity duration-120 group-hover:opacity-100 focus-visible:opacity-100 ${actionsHidden}`}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => { event.stopPropagation(); setReplaceIndex(index); replaceInputRef.current?.click() }}>
                  <RefreshCw />
                </UiIconButton>
              )}
              {onTrim && type === 'video' && (
                <UiIconButton size="2xs" tone="media" type="button" label="裁剪" tooltip="裁剪"
                  className={`absolute -bottom-1.5 -left-1.5 opacity-0 transition-opacity duration-120 group-hover:opacity-100 focus-visible:opacity-100 ${actionsHidden}`}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => { event.stopPropagation(); onTrim(index) }}>
                  <Scissors />
                </UiIconButton>
              )}
            </div>
          )
        })}
        {showUploadCard ? (
          // 添加卡与缩略图同尺寸同圆角的实底竖块，加号居中；封面框只负责悬停发丝线与键盘焦点环
          <UiOptionButton type="button" variant="cover" aria-label="添加素材" tooltip={hintText ?? '添加素材'}
            className={`${UI_COVER_GROUP_CLASS} shrink-0`}
            onClick={openFilePicker}>
            <span className={`${UI_COVER_FRAME_CLASS} ${CARD_FRAME_CLASS} rounded-lg`}>
              <span className="absolute inset-0 flex items-center justify-center bg-raised text-text2">
                <Plus aria-hidden="true" className={UI_ICON_SIZE_CLASS.md} />
              </span>
            </span>
          </UiOptionButton>
        ) : files.length === 0 ? (
          // 宿主不要添加卡时，没有素材的素材条只在拖入期间出现，这里给一个同形的落点
          <span aria-hidden="true" className={`flex ${CARD_FRAME_CLASS} shrink-0 items-center justify-center rounded-lg bg-raised text-text2`}>
            <Plus className={UI_ICON_SIZE_CLASS.md} />
          </span>
        ) : null}
      </div>
      <UiInput ref={uploadInputRef} type="file" accept={accept} multiple={multiple} className="hidden" disabled={disabled}
        onChange={(event) => void handleUploadChange(event)} />
      <UiInput ref={replaceInputRef} type="file" accept={accept} className="hidden" disabled={disabled}
        onChange={(event) => void handleReplaceChange(event)} />
    </div>
  )
})
