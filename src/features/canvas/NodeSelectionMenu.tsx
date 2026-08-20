import {
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

import { UiInput, UiOptionButton, UiPanel } from '@/components/ui'
import { UI_POPOVER_TRANSITION_MS } from '@/components/ui/motion'
import {
  ICON_NODE_AUDIO_GENERATION,
  ICON_NODE_AUDIO_MODEL,
  ICON_NODE_AUDIO_UPLOAD,
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
} from '@/core/theme/icons'
import type { CanvasMediaKind } from '@/features/canvas/canvasUtils'
import { CANVAS_NODE_TYPES, type CanvasNodeType } from '@/features/canvas/domain/canvasNodes'
import {
  type CanvasNodeDefinition,
  type MenuIconKey,
} from '@/features/canvas/domain/nodeRegistry'
import { nodeCatalog } from '@/features/canvas/application/nodeCatalog'
import {
  getSortedNodeMenuDefinitions,
  getUploadAccept,
  NODE_MENU_MAX_HEIGHT,
  NODE_MENU_SECTION_LABEL_KEY,
  NODE_MENU_SECTION_ORDER,
  resolveNodeMenuLayout,
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
}

export function NodeSelectionMenu({
  position,
  allowedTypes,
  uploadKinds,
  onSelect,
  onClose,
}: NodeSelectionMenuProps) {
  const { t } = useTranslation()
  const menuRef = useRef<HTMLDivElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [layout, setLayout] = useState({
    left: position.x,
    top: position.y,
    maxHeight: NODE_MENU_MAX_HEIGHT,
    transformOrigin: 'top left',
  })

  const menuItems = useMemo(() => {
    const candidates = allowedTypes
      ? Array.from(new Set(allowedTypes)).map((type) => nodeCatalog.getDefinition(type))
      : nodeCatalog.getMenuDefinitions()
    return getSortedNodeMenuDefinitions(candidates)
  }, [allowedTypes])

  const sections = useMemo(() => NODE_MENU_SECTION_ORDER
    .map((section) => ({
      section,
      items: menuItems.filter((item) => (item.menuSection ?? 'extensions') === section),
    }))
    .filter((entry) => entry.items.length > 0), [menuItems])

  const closeWithAnimation = useCallback((afterClose?: () => void) => {
    setIsVisible(false)
    window.setTimeout(() => {
      onClose()
      afterClose?.()
    }, UI_POPOVER_TRANSITION_MS)
  }, [onClose])

  const selectItem = useCallback((item: CanvasNodeDefinition, file?: File) => {
    closeWithAnimation(() => onSelect(item.type, file))
  }, [closeWithAnimation, onSelect])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setIsVisible(true)
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  useLayoutEffect(() => {
    const menu = menuRef.current
    const parent = menu?.offsetParent as HTMLElement | null
    if (!menu || !parent) {
      return
    }
    setLayout(resolveNodeMenuLayout({
      position,
      parentWidth: parent.clientWidth,
      parentHeight: parent.clientHeight,
      menuWidth: menu.offsetWidth,
      menuHeight: menu.scrollHeight,
    }))
  }, [position, sections])

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (event.button !== 0) {
        return
      }
      if (!menuRef.current?.contains(event.target as Node)) {
        closeWithAnimation()
      }
    }
    document.addEventListener('mousedown', onPointerDown, true)
    return () => document.removeEventListener('mousedown', onPointerDown, true)
  }, [closeWithAnimation])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeWithAnimation()
      return
    }
    if (event.key === 'Enter') {
      const activeItem = document.activeElement as HTMLButtonElement | null
      if (activeItem?.getAttribute('role') === 'menuitem') {
        event.preventDefault()
        activeItem.click()
      }
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return
    }
    event.preventDefault()
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []
    )
    if (items.length === 0) {
      return
    }
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    const delta = event.key === 'ArrowDown' ? 1 : -1
    items[(currentIndex + delta + items.length) % items.length]?.focus()
  }, [closeWithAnimation])

  const handleUploadFile = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    const uploadItem = menuItems.find((item) => item.type === CANVAS_NODE_TYPES.universalUpload)
    if (file && uploadItem) {
      selectItem(uploadItem, file)
    }
  }, [menuItems, selectItem])

  return (
    <UiPanel
      ref={menuRef}
      variant="glass"
      role="menu"
      aria-label={t('node.menuTitle')}
      className={`ui-scrollbar absolute z-dropdown w-[284px] overflow-y-auto overflow-x-hidden p-2 transition-[opacity,transform] duration-150 ease-out ${
        isVisible ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-1 scale-[0.98] opacity-0'
      }`}
      style={{
        left: layout.left,
        top: layout.top,
        maxHeight: layout.maxHeight,
        transformOrigin: layout.transformOrigin,
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="relative px-3 pb-2 pt-1 text-sm font-semibold text-text-dark">
        {t('node.menuTitle')}
      </div>
      {sections.map(({ section, items }, sectionIndex) => (
        <div
          key={section}
          className={sectionIndex > 0
            ? 'relative mt-1 border-t border-border-dark/60 pt-1'
            : 'relative'}
        >
          <div className="px-3 pb-1 pt-1 text-2xs font-medium tracking-wide text-text-muted">
            {t(NODE_MENU_SECTION_LABEL_KEY[section])}
          </div>
          {items.map((item) => {
            const Icon = iconMap[item.menuIcon]
            const chooseFileFirst = Boolean(allowedTypes)
              && item.menuBehavior === 'chooseMediaBeforeCreate'
            return (
              <UiOptionButton
                key={item.type}
                role="menuitem"
                tabIndex={-1}
                variant="menu"
                className="h-11 w-full gap-3 rounded-lg px-3 !transition-none"
                onClick={() => {
                  if (chooseFileFirst) {
                    uploadInputRef.current?.click()
                    return
                  }
                  selectItem(item)
                }}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-layer/70">
                  <Icon className="h-4 w-4 text-accent" />
                </span>
                <span className="text-sm font-medium text-text-dark">{t(item.menuLabelKey)}</span>
              </UiOptionButton>
            )
          })}
        </div>
      ))}
      <UiInput
        ref={uploadInputRef}
        type="file"
        accept={getUploadAccept(uploadKinds)}
        className="hidden"
        onChange={handleUploadFile}
      />
    </UiPanel>
  )
}
