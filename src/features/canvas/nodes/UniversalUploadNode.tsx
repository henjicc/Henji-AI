import { memo, useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'

import { UiInput } from '@/components/ui'
import { createLogger } from '@/core/logging'
import {
  ICON_NODE_AUDIO_UPLOAD,
  ICON_NODE_IMAGE_UPLOAD,
  ICON_NODE_UPLOAD,
  ICON_NODE_VIDEO_UPLOAD,
} from '@/core/theme/icons'
import {
  importCanvasMediaFile,
  validateCanvasMediaFile,
} from '@/features/canvas/application/mediaImport'
import { canvasEventBus } from '@/features/canvas/application/canvasServices'
import {
  CANVAS_NODE_TYPES,
  type UniversalUploadNodeData,
} from '@/features/canvas/domain/canvasNodes'
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay'
import { getSocketColor, type RowMediaKind } from '@/features/canvas/domain/socketTypes'
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader'
import {
  NODE_IDLE_BORDER_CLASS,
  NODE_PORT_NODE_CLASS,
  NODE_PORT_VISIBLE_CLASS,
  NODE_SELECTED_BORDER_CLASS,
} from '@/features/canvas/ui/nodeControlStyles'
import { useCanvasStore } from '@/stores/canvasStore'
import { useSettingsStore } from '@/stores/settingsStore'

const logger = createLogger('features.canvas.nodes.UniversalUploadNode')
const UniversalUploadIcon = ICON_NODE_UPLOAD

const MEDIA_UPLOAD_ICON = {
  image: ICON_NODE_IMAGE_UPLOAD,
  video: ICON_NODE_VIDEO_UPLOAD,
  audio: ICON_NODE_AUDIO_UPLOAD,
} satisfies Record<RowMediaKind, typeof ICON_NODE_UPLOAD>

const MEDIA_SOCKET_TYPE = {
  image: 'IMAGE',
  video: 'VIDEO',
  audio: 'AUDIO',
} as const

type UniversalUploadNodeProps = NodeProps & {
  id: string
  data: UniversalUploadNodeData
  selected?: boolean
}

export const UniversalUploadNode = memo(({ id, data, selected }: UniversalUploadNodeProps) => {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [showPreparing, setShowPreparing] = useState(false)
  const edges = useCanvasStore((state) => state.edges)
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode)
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)
  const resolveUploadPlaceholder = useCanvasStore((state) => state.resolveUploadPlaceholder)
  const useUploadFilenameAsNodeTitle = useSettingsStore((state) => state.useUploadFilenameAsNodeTitle)
  const lockedKind = data.lockedMediaKind ?? null
  const BodyIcon = lockedKind ? MEDIA_UPLOAD_ICON[lockedKind] : UniversalUploadIcon
  const accept = lockedKind ? `${lockedKind}/*` : 'image/*,video/*,audio/*'

  const processFile = useCallback(async (file: File) => {
    const validation = validateCanvasMediaFile(file, lockedKind)
    if (!validation.accepted) {
      updateNodeData(id, { uploadError: validation.reason }, { skipHistory: true })
      logger.warn(
        `拒绝上传文件 reason=${validation.reason} expected=${lockedKind ?? 'any'} name="${file.name}" type="${file.type}"`
      )
      return
    }

    setIsImporting(true)
    setShowPreparing(false)
    const preparingTimer = window.setTimeout(() => setShowPreparing(true), 250)
    updateNodeData(id, { uploadError: null }, { skipHistory: true })
    try {
      const result = await importCanvasMediaFile(file)
      resolveUploadPlaceholder(id, {
        ...result,
        data: {
          ...result.data,
          ...(useUploadFilenameAsNodeTitle ? { displayName: file.name } : {}),
        },
      })
    } catch {
      updateNodeData(id, { uploadError: 'failed' }, { skipHistory: true })
    } finally {
      window.clearTimeout(preparingTimer)
      setShowPreparing(false)
      setIsImporting(false)
    }
  }, [id, lockedKind, resolveUploadPlaceholder, updateNodeData, useUploadFilenameAsNodeTitle])

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) {
      void processFile(file)
    }
  }, [processFile])

  const handleDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const file = event.dataTransfer.files?.[0]
    if (file) {
      void processFile(file)
    }
  }, [processFile])

  useEffect(() => canvasEventBus.subscribe('canvas/import-media', ({ nodeId, file }) => {
    if (nodeId === id) {
      void processFile(file)
    }
  }), [id, processFile])

  const hasConnection = edges.some((edge) => edge.source === id)
  const handleSocketType = lockedKind ? MEDIA_SOCKET_TYPE[lockedKind] : '*'
  const handleLabelKey = lockedKind ?? 'any'

  return (
    <div
      className={`group relative aspect-square w-[240px] overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/85 transition-colors duration-150 ${
        selected ? NODE_SELECTED_BORDER_CLASS : NODE_IDLE_BORDER_CLASS
      }`}
      onClick={() => {
        setSelectedNode(id)
        if (!isImporting) {
          inputRef.current?.click()
        }
      }}
      onDrop={handleDrop}
      onDragOver={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      aria-busy={isImporting}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<UniversalUploadIcon className="h-4 w-4" />}
        titleText={resolveNodeDisplayName(CANVAS_NODE_TYPES.universalUpload, data)}
        editable
        onTitleChange={(displayName) => updateNodeData(id, { displayName })}
      />
      <div className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--node-radius)] bg-bg-dark px-5 text-center">
        <BodyIcon className="h-7 w-7 text-text-muted" />
        <span className="text-sm font-medium text-text-dark">
          {showPreparing
            ? t('node.universalUpload.preparing')
            : t(`node.universalUpload.action.${lockedKind ?? 'any'}`)}
        </span>
        <span className="text-2xs leading-5 text-text-muted">
          {t(`node.universalUpload.hint.${lockedKind ?? 'any'}`)}
        </span>
        {data.uploadError ? (
          <span className="text-xs text-error">
            {t(`node.universalUpload.errors.${data.uploadError}`)}
          </span>
        ) : null}
      </div>
      <UiInput
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        className="hidden"
        onChange={handleFileChange}
      />
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        aria-label={t(`node.universalUpload.port.${handleLabelKey}`)}
        title={t(`node.universalUpload.port.${handleLabelKey}`)}
        className={`${NODE_PORT_NODE_CLASS} ${hasConnection ? NODE_PORT_VISIBLE_CLASS : ''}`}
        style={{
          background: getSocketColor(handleSocketType),
          right: 0,
          top: '50%',
          transform: 'translate(50%, -50%)',
        }}
      />
    </div>
  )
})

UniversalUploadNode.displayName = 'UniversalUploadNode'
