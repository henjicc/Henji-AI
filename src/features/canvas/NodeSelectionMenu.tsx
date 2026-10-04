import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'
import { useTranslation } from 'react-i18next'

import {
  PanelTrigger,
  UI_GLASS_ADAPTIVE_DIVIDER_CLASS,
  UI_TEXT_META_CLASS,
  UiInput,
  UiOptionButton,
} from '@/components/ui'
import type { FloatingPanelAnchorRect } from '@/components/ui/floatingPanelPosition'
import {
  ICON_NODE_AUDIO_GENERATION,
  ICON_NODE_AUDIO_MODEL,
  ICON_NODE_AUDIO_UPLOAD,
  ICON_NODE_ASSET_GROUP,
  ICON_NODE_BOOLEAN,
  ICON_NODE_CAMERA_STAGE,
  ICON_NODE_FLOAT,
  ICON_NODE_IMAGE_GENERATION,
  ICON_NODE_IMAGE_MODEL,
  ICON_NODE_IMAGE_UPLOAD,
  ICON_NODE_INTEGER,
  ICON_NODE_STORYBOARD,
  ICON_NODE_TEXT,
  ICON_NODE_TEXT_ANNOTATION,
  ICON_NODE_TEXT_PROCESSING,
  ICON_NODE_UPLOAD,
  ICON_NODE_VIDEO_GENERATION,
  ICON_NODE_VIDEO_MODEL,
  ICON_NODE_VIDEO_UPLOAD,
  ICON_PANORAMA,
} from '@/core/theme/icons'
import type { CanvasMediaKind } from '@/features/canvas/canvasUtils'
import { CANVAS_NODE_TYPES, type CanvasNodeType } from '@/features/canvas/domain/canvasNodes'
import {
  type CanvasNodeDefinition,
  type MenuIconKey,
  type NodeMenuSection,
} from '@/features/canvas/domain/nodeRegistry'
import { nodeCatalog } from '@/features/canvas/application/nodeCatalog'
import {
  getSortedNodeMenuDefinitions,
  getUploadAccept,
  NODE_MENU_SECTION_LABEL_KEY,
  NODE_MENU_SECTION_ORDER,
} from '@/features/canvas/application/nodeMenuLayout'

interface NodeSelectionMenuProps {
  position: { x: number; y: number }
  allowedTypes?: CanvasNodeType[]
  uploadKinds: CanvasMediaKind[]
  onSelect: (type: CanvasNodeType, file?: File) => void
  onClose: () => void
}

const iconMap: Record<MenuIconKey, typeof ICON_NODE_UPLOAD> = {
  upload: ICON_NODE_UPLOAD,
  imageUpload: ICON_NODE_IMAGE_UPLOAD,
  videoUpload: ICON_NODE_VIDEO_UPLOAD,
  audioUpload: ICON_NODE_AUDIO_UPLOAD,
  imageGeneration: ICON_NODE_IMAGE_GENERATION,
  videoGeneration: ICON_NODE_VIDEO_GENERATION,
  audioGeneration: ICON_NODE_AUDIO_GENERATION,
  panorama: ICON_PANORAMA,
  storyboard: ICON_NODE_STORYBOARD,
  textProcessing: ICON_NODE_TEXT_PROCESSING,
  textAnnotation: ICON_NODE_TEXT_ANNOTATION,
  cameraStage: ICON_NODE_CAMERA_STAGE,
  imageModel: ICON_NODE_IMAGE_MODEL,
  videoModel: ICON_NODE_VIDEO_MODEL,
  audioModel: ICON_NODE_AUDIO_MODEL,
  integer: ICON_NODE_INTEGER,
  float: ICON_NODE_FLOAT,
  text: ICON_NODE_TEXT,
  boolean: ICON_NODE_BOOLEAN,
  assetGroup: ICON_NODE_ASSET_GROUP,
}

const MENU_ITEM_SELECTOR = '[role="menuitem"]'

interface NodeMenuSectionEntry {
  section: NodeMenuSection
  items: CanvasNodeDefinition[]
}

interface NodeMenuListProps {
  sections: NodeMenuSectionEntry[]
  allowedTypes?: CanvasNodeType[]
  uploadKinds: CanvasMediaKind[]
  onChoose: (item: CanvasNodeDefinition, file?: File) => void
}

/** 菜单正文：分区标题 + 菜单项；方向键 / Home / End 移动焦点，Enter 执行（Escape 由共享浮层处理）。 */
function NodeMenuList({ sections, allowedTypes, uploadKinds, onChoose }: NodeMenuListProps): JSX.Element {
  const { t } = useTranslation()
  const listRef = useRef<HTMLDivElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  // 浮层定位完成才可见，隐藏态的元素拿不到焦点：等两帧再聚焦首项
  useEffect(() => {
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        listRef.current?.querySelector<HTMLButtonElement>(MENU_ITEM_SELECTOR)?.focus({ preventScroll: true })
      })
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      const activeItem = document.activeElement as HTMLButtonElement | null
      if (activeItem?.getAttribute('role') === 'menuitem') {
        event.preventDefault()
        activeItem.click()
      }
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
      return
    }
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR) ?? [])
    if (items.length === 0) {
      return
    }
    event.preventDefault()
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[nextIndex]?.focus()
  }, [])

  const handleUploadFile = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    const uploadItem = sections
      .flatMap((entry) => entry.items)
      .find((item) => item.type === CANVAS_NODE_TYPES.universalUpload)
    if (file && uploadItem) {
      onChoose(uploadItem, file)
    }
  }, [onChoose, sections])

  return (
    <div
      ref={listRef}
      role="menu"
      aria-label={t('node.menuTitle')}
      tabIndex={-1}
      className="flex min-w-44 max-w-sm flex-col outline-none"
      onKeyDown={handleKeyDown}
    >
      {sections.map(({ section, items }, sectionIndex) => (
        <Fragment key={section}>
          {sectionIndex > 0 && (
            <div role="separator" className={`my-1 border-t ${UI_GLASS_ADAPTIVE_DIVIDER_CLASS}`} />
          )}
          <div className={`px-2 pb-1 pt-1.5 ${UI_TEXT_META_CLASS}`}>
            {t(NODE_MENU_SECTION_LABEL_KEY[section])}
          </div>
          {items.map((item) => {
            const Icon = iconMap[item.menuIcon]
            const chooseFileFirst = Boolean(allowedTypes)
              && item.menuBehavior === 'chooseMediaBeforeCreate'
            return (
              <UiOptionButton
                key={item.type}
                type="button"
                role="menuitem"
                tabIndex={-1}
                variant="menu"
                size="md"
                className="w-full gap-2.5"
                onClick={() => {
                  if (chooseFileFirst) {
                    uploadInputRef.current?.click()
                    return
                  }
                  onChoose(item)
                }}
              >
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-text2" />
                <span className="min-w-0 flex-1 truncate">{t(item.menuLabelKey)}</span>
              </UiOptionButton>
            )
          })}
        </Fragment>
      ))}
      <UiInput
        ref={uploadInputRef}
        type="file"
        accept={getUploadAccept(uploadKinds)}
        className="hidden"
        onChange={handleUploadFile}
      />
    </div>
  )
}

/**
 * 画布“添加节点”菜单（右键空白、双击空白、拖线落空）。浮层走共享 `PanelTrigger` 锚点模式（任务 5.4）：
 * 定位与视口夹取、点外与 Escape（只关最上层）、玻璃表面、收起动画都与其他画布菜单一致，
 * 菜单项与右键菜单同为 `UiOptionButton variant="menu"`，宽度按内容。
 *
 * `position` 是相对画布容器的坐标：在容器里放一个零尺寸锚点读出屏幕矩形。父级每次打开都给出新的
 * position 对象，浮层随之重建；旧菜单正在收起时在别处再右键，不会被旧菜单的收起回调关掉。
 */
export function NodeSelectionMenu({
  position,
  allowedTypes,
  uploadKinds,
  onSelect,
  onClose,
}: NodeSelectionMenuProps) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<{ rect: FloatingPanelAnchorRect; id: number } | null>(null)
  const [open, setOpen] = useState(true)
  const pendingSelectionRef = useRef<{ item: CanvasNodeDefinition; file?: File } | null>(null)
  const callbacksRef = useRef({ onSelect, onClose })
  callbacksRef.current = { onSelect, onClose }

  const sections = useMemo<NodeMenuSectionEntry[]>(() => {
    const candidates = allowedTypes
      ? Array.from(new Set(allowedTypes)).map((type) => nodeCatalog.getDefinition(type))
      : nodeCatalog.getMenuDefinitions()
    const menuItems = getSortedNodeMenuDefinitions(candidates)
    return NODE_MENU_SECTION_ORDER
      .map((section) => ({
        section,
        items: menuItems.filter((item) => (item.menuSection ?? 'extensions') === section),
      }))
      .filter((entry) => entry.items.length > 0)
  }, [allowedTypes])

  useLayoutEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) return
    pendingSelectionRef.current = null
    setAnchor((previous) => ({
      rect: { left: rect.left, top: rect.top, bottom: rect.bottom, width: 0 },
      id: (previous?.id ?? 0) + 1,
    }))
    setOpen(true)
  }, [position])

  const handleOpenChange = useCallback((next: boolean) => {
    if (next) return
    const pending = pendingSelectionRef.current
    pendingSelectionRef.current = null
    callbacksRef.current.onClose()
    if (pending) callbacksRef.current.onSelect(pending.item.type, pending.file)
  }, [])

  const choose = useCallback((item: CanvasNodeDefinition, file?: File) => {
    pendingSelectionRef.current = { item, file }
    setOpen(false)
  }, [])

  return (
    <>
      <div
        ref={anchorRef}
        aria-hidden="true"
        className="pointer-events-none absolute h-0 w-0"
        style={{ left: position.x, top: position.y }}
      />
      {anchor && (
        <PanelTrigger
          key={anchor.id}
          anchor={anchor.rect}
          open={open}
          onOpenChange={handleOpenChange}
          alignment="bottomLeft"
          surface="glass"
          panelPadding="menu"
          panelWidth="content"
          renderPanel={() => (
            <NodeMenuList
              sections={sections}
              allowedTypes={allowedTypes}
              uploadKinds={uploadKinds}
              onChoose={choose}
            />
          )}
        />
      )}
    </>
  )
}
