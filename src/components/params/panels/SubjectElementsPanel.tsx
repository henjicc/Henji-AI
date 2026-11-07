/**
 * 元素面板（`panel: 'subject-elements'`）：每个元素是一个角色或物体，用 2–4 张图（第 1 张为正面主图）
 * 或一段单镜头视频描述。生成面板与画布节点都经 PanelTrigger 打开同一个面板、写同一份值：
 * `[{ id, name, kind, images, videos, videoSeconds? }]`，媒体是本地受管路径，提交时由主进程上传到当前供应商；
 * `videoSeconds` 是上传时读到的视频时长，只用于估价。
 *
 * 提示词里的引用写法随供应商不同：`indexed` 按顺序写 `@Element1`（Fal），`named` 写元素名 `@名称`（KIE）。
 */

import React, { useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { UiButton, UiEmpty, UiIconButton, UiInlineStatus, UiInput, UiRecordItem, UiRecordList, UiSegmented, UiSpecialPanel, UI_TEXT_LABEL_CLASS, UI_TEXT_META_CLASS } from '@/components/ui'
import FileUploader from '@/components/ui/FileUploader'
import { useReorderDrag } from '@/components/ui/fileUploader/useReorderDrag'
import { useNotification } from '@/contexts/NotificationContext'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import { getI18nText } from '@/core/types/I18nText'
import type { ImageUploadParamDef } from '@/core/types'
import { importLocalMedia } from '@/services/localMediaImport'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { ImageUpload } from '../upload/ImageUpload'

export interface SubjectElementsPanelConfig {
  naming: 'indexed' | 'named'
  maxItems: number
  maxVideoItems: number
  minImages: number
  maxImages: number
  /** 视频元素时长范围（秒） */
  minVideoSeconds: number
  maxVideoSeconds: number
}

interface ElementValue {
  id: string
  name: string
  kind: 'image' | 'video'
  images: string[]
  videos: string[]
  videoSeconds?: number
}

const TEXT = {
  empty: { zh: '还没有元素', en: 'No elements yet' },
  add: { zh: '添加元素', en: 'Add Element' },
  image: { zh: '图片', en: 'Images' },
  video: { zh: '视频', en: 'Video' },
  kind: { zh: '元素 {n} 的素材类型', en: 'Element {n} source' },
  name: { zh: '元素 {n} 名称', en: 'Element {n} name' },
  defaultName: { zh: '主体{n}', en: 'Subject{n}' },
  remove: { zh: '删除元素 {n}', en: 'Remove element {n}' },
  drag: { zh: '拖动调整元素顺序', en: 'Drag to reorder elements' },
  summary: { zh: '{count} 个元素', en: '{count} elements' },
  full: { zh: '最多 {max} 个元素', en: 'Up to {max} elements' },
  videoFull: { zh: '最多 {max} 个视频元素', en: 'Up to {max} video elements' },
  needImages: { zh: '元素 {n} 需要 {min}–{max} 张图', en: 'Element {n} needs {min}–{max} images' },
  needVideo: { zh: '元素 {n} 还没有视频', en: 'Element {n} has no video yet' },
  videoLength: { zh: '视频需在 {min}–{max} 秒', en: 'Video must be {min}–{max}s' },
} as const

const FALLBACK_CONFIG: SubjectElementsPanelConfig = { naming: 'indexed', maxItems: 7, maxVideoItems: 3, minImages: 2, maxImages: 4, minVideoSeconds: 3, maxVideoSeconds: 8 }

function format(text: { zh: string; en: string }, language: string, values: Record<string, string | number> = {}): string {
  return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, String(value)), getI18nText(text, language))
}

function strings(value: DynamicValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function readElementValues(value: DynamicValue): ElementValue[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is DynamicValueMap => Boolean(item) && typeof item === 'object' && !Array.isArray(item)).map((item, index) => ({
    id: typeof item.id === 'string' && item.id ? item.id : `element-${index}`,
    name: typeof item.name === 'string' ? item.name : '',
    kind: item.kind === 'video' ? 'video' : 'image',
    images: strings(item.images),
    videos: strings(item.videos),
    ...(typeof item.videoSeconds === 'number' && item.videoSeconds > 0 ? { videoSeconds: item.videoSeconds } : {}),
  }))
}

/** 新元素的默认名称：在已有名称里找第一个没用过的“主体N”。 */
function nextDefaultName(elements: ElementValue[], language: string): string {
  const used = new Set(elements.map(element => element.name.trim().toLowerCase()))
  for (let n = elements.length + 1; ; n += 1) {
    const candidate = format(TEXT.defaultName, language, { n })
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}

interface SubjectElementsPanelProps {
  value: DynamicValue
  onChange: (value: DynamicValue) => void
  config?: Partial<SubjectElementsPanelConfig>
}

export const SubjectElementsPanel: React.FC<SubjectElementsPanelProps> = ({ value, onChange, config }) => {
  const { i18n } = useTranslation()
  const language = i18n.language
  const { showNotification } = useNotification()
  const limits = { ...FALLBACK_CONFIG, ...config }
  const elements = useMemo(() => readElementValues(value), [value])
  const listRef = useRef<HTMLDivElement>(null)
  const latest = useRef(elements)
  latest.current = elements
  const write = useCallback((next: ElementValue[]) => onChange(next as unknown as DynamicValue), [onChange])
  // 上传是异步的，期间用户可能已改了别的元素，所以按 id 写回最新列表。
  const update = useCallback((id: string, patch: Partial<ElementValue>): void => {
    write(latest.current.map(element => element.id === id ? { ...element, ...patch } : element))
  }, [write])
  const add = (): void => write([...elements, { id: crypto.randomUUID(), name: limits.naming === 'named' ? nextDefaultName(elements, language) : '', kind: 'image', images: [], videos: [] }])
  const reorder = useCallback((from: number, to: number): void => {
    const next = elements.slice()
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    write(next)
  }, [elements, write])
  const ids = useMemo(() => elements.map(element => element.id), [elements])
  const { dragState, itemRefs, handleMouseDown } = useReorderDrag({ disabled: false, isCustomDragging: false, files: ids, layout: 'vertical', onReorder: reorder, dragBoundaryRef: listRef, dragThreshold: 4 })
  const videoCount = elements.filter(element => element.kind === 'video').length

  const uploadVideo = async (id: string, files: File[]): Promise<void> => {
    const file = files[0]
    if (!file) return
    const imported = await importLocalMedia(file, 'video')
    if (imported.kind !== 'video') return
    if (imported.durationSeconds < limits.minVideoSeconds || imported.durationSeconds > limits.maxVideoSeconds + 0.05) {
      showNotification(format(TEXT.videoLength, language, { min: limits.minVideoSeconds, max: limits.maxVideoSeconds }), 'error')
      return
    }
    update(id, { videos: [imported.fullPath], videoSeconds: imported.durationSeconds })
  }

  const problem = elements.reduce<string | null>((found, element, index) => {
    if (found) return found
    const n = index + 1
    if (element.kind === 'video') return element.videos.length ? null : format(TEXT.needVideo, language, { n })
    return element.images.length >= limits.minImages ? null : format(TEXT.needImages, language, { n, min: limits.minImages, max: limits.maxImages })
  }, null)
  const status = elements.length === 0 ? null : problem
    ? <UiInlineStatus tone="warning" truncate>{problem}</UiInlineStatus>
    : <span className={UI_TEXT_META_CLASS}>{format(TEXT.summary, language, { count: elements.length })}</span>

  return (
    <UiSpecialPanel
      bodyWidth={360}
      status={status}
      action={(
        <UiButton
          size="sm" variant="secondary" onClick={add}
          disabled={elements.length >= limits.maxItems} disabledReason={format(TEXT.full, language, { max: limits.maxItems })}
        >
          <Plus />{getI18nText(TEXT.add, language)}
        </UiButton>
      )}
    >
      {elements.length === 0 ? <UiEmpty size="xs" title={getI18nText(TEXT.empty, language)} /> : (
        <div ref={listRef}>
          <UiRecordList>
            {elements.map((element, index) => {
              const n = index + 1
              const insertion = (dragState.isDragging || dragState.isDropping) && dragState.toIndex === index && dragState.fromIndex !== index
                ? (dragState.fromIndex! < index ? 'bottom' : 'top') : null
              const imageParam: ImageUploadParamDef = {
                id: `subject-element-${element.id}`, type: 'image-upload', order: 0, default: [],
                name: TEXT.image, maxCount: limits.maxImages,
              }
              return (
                <UiRecordItem
                  key={element.id} index={index} density="compact"
                  ref={node => { itemRefs.current[index] = node }}
                  className={`relative ${dragState.isDragging && dragState.fromIndex === index ? 'opacity-50' : ''}`}
                >
                  {insertion && <span aria-hidden="true" className={`pointer-events-none absolute inset-x-0 z-raised h-0.5 bg-accent ${insertion === 'bottom' ? 'bottom-0' : 'top-0'}`} />}
                  <div
                    className="flex cursor-grab items-center gap-2"
                    onMouseDown={event => {
                      if ((event.target as HTMLElement).closest('button,input,textarea,[role="radiogroup"]')) return
                      handleMouseDown(index, event)
                    }}
                  >
                    <GripVertical aria-label={getI18nText(TEXT.drag, language)} size={UI_ICON_SIZE.sm} className="shrink-0 text-text3" />
                    {limits.naming === 'named' ? (
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        <span className={UI_TEXT_LABEL_CLASS}>@</span>
                        <UiInput
                          size="sm" maxLength={20} aria-label={format(TEXT.name, language, { n })}
                          value={element.name} onChange={event => update(element.id, { name: event.target.value })}
                        />
                      </div>
                    ) : (
                      <span className={`min-w-0 flex-1 truncate ${UI_TEXT_LABEL_CLASS}`}>@Element{n}</span>
                    )}
                    <UiSegmented
                      size="sm" ariaLabel={format(TEXT.kind, language, { n })} value={element.kind}
                      onChange={kind => update(element.id, { kind: kind as ElementValue['kind'] })}
                      options={[
                        { value: 'image', label: getI18nText(TEXT.image, language) },
                        {
                          value: 'video', label: getI18nText(TEXT.video, language),
                          disabled: element.kind !== 'video' && videoCount >= limits.maxVideoItems,
                          title: element.kind !== 'video' && videoCount >= limits.maxVideoItems ? format(TEXT.videoFull, language, { max: limits.maxVideoItems }) : undefined,
                        },
                      ]}
                    />
                    <UiIconButton size="sm" tone="danger" aria-label={format(TEXT.remove, language, { n })} tooltip={format(TEXT.remove, language, { n })} onClick={() => write(elements.filter(item => item.id !== element.id))}>
                      <Trash2 />
                    </UiIconButton>
                  </div>
                  {element.kind === 'image' ? (
                    <ImageUpload param={imageParam} value={element.images} showLabel={false} reorderable onChange={images => update(element.id, { images })} />
                  ) : (
                    <FileUploader
                      density="compact" accept="video/mp4,video/quicktime,video/webm" maxCount={1}
                      files={element.videos.map(resolveImageDisplayUrl)} fileTypes={element.videos.map(() => 'video' as const)}
                      onUpload={files => uploadVideo(element.id, files)}
                      onRemove={() => update(element.id, { videos: [], videoSeconds: undefined })}
                    />
                  )}
                </UiRecordItem>
              )
            })}
          </UiRecordList>
        </div>
      )}
    </UiSpecialPanel>
  )
}
