import { useSyncExternalStore } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { FileAudio, Film, Image as ImageIcon } from 'lucide-react'

import type { PromptMediaType } from '@/core/inputs/promptDocument'
import type { PromptEditorResourceRegistry } from '../resourceRegistry'
import { PROMPT_ATOM_CLASS, PROMPT_MEDIA_ATOM_CLASS } from '../promptEditorStyles'
import { UI_ICON_SIZE_CLASS } from '../../styleTokens'

/** 没有缩略图（引用失效、音频）时按媒体类型画图标；不显示 image / video 这类内部类型值 */
const MEDIA_TYPE_ICON = { image: ImageIcon, video: Film, audio: FileAudio } as const

interface ReferenceExtensionOptions {
  registry: PromptEditorResourceRegistry
}

interface MediaReferenceAttributes {
  resourceId: string
  mediaType: PromptMediaType
  fallbackLabel: string
  sourceNodeId?: string
}

interface TemplateVariableAttributes {
  key: string
  fallbackLabel: string
}

function readMediaAttributes(attrs: Record<string, unknown>): MediaReferenceAttributes {
  const mediaType = attrs.mediaType
  return {
    resourceId: typeof attrs.resourceId === 'string' ? attrs.resourceId : '',
    mediaType: mediaType === 'video' || mediaType === 'audio' ? mediaType : 'image',
    fallbackLabel: typeof attrs.fallbackLabel === 'string'
      ? attrs.fallbackLabel
      : '失效引用',
    ...(typeof attrs.sourceNodeId === 'string' && attrs.sourceNodeId
      ? { sourceNodeId: attrs.sourceNodeId }
      : {}),
  }
}

function readVariableAttributes(attrs: Record<string, unknown>): TemplateVariableAttributes {
  return {
    key: typeof attrs.key === 'string' ? attrs.key : '',
    fallbackLabel: typeof attrs.fallbackLabel === 'string'
      ? attrs.fallbackLabel
      : '失效变量',
  }
}

function useRegistryVersion(registry: PromptEditorResourceRegistry): void {
  useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getServerSnapshot,
  )
}

export function MediaReferenceNodeView({
  node,
  extension,
  selected,
}: NodeViewProps): JSX.Element {
  const attrs = readMediaAttributes(node.attrs)
  const { registry } = extension.options as ReferenceExtensionOptions
  useRegistryVersion(registry)
  const reference = registry.resolveReference(attrs.resourceId)
  const label = reference?.label ?? attrs.fallbackLabel

  return (
    <NodeViewWrapper
      as="span"
      className={`${PROMPT_MEDIA_ATOM_CLASS} ${
        selected
          ? 'border-accent bg-accent-tint text-text1'
          : reference
            ? 'border-transparent bg-selected text-text2'
            : 'border-danger-text/50 bg-raised text-danger-text'
      }`}
      data-prompt-media-reference=""
      data-reference-id={attrs.resourceId}
      data-reference-state={reference ? 'resolved' : 'missing'}
      data-media-type={attrs.mediaType}
      title={reference ? label : `引用已失效：${label}`}
    >
      {reference?.thumbnailSrc ? (
        <img
          src={reference.thumbnailSrc}
          alt=""
          className="h-[1.25em] w-[1.25em] shrink-0 rounded-control object-cover"
          draggable={false}
        />
      ) : (
        <span className="inline-flex h-[1.25em] w-[1.25em] shrink-0 items-center justify-center rounded-control bg-raised text-text2">
          {(() => { const Icon = MEDIA_TYPE_ICON[attrs.mediaType] ?? ImageIcon; return <Icon aria-hidden="true" className={UI_ICON_SIZE_CLASS.xs} /> })()}
        </span>
      )}
      <span className="truncate">@{label}</span>
    </NodeViewWrapper>
  )
}

export function TemplateVariableNodeView({
  node,
  extension,
  selected,
}: NodeViewProps): JSX.Element {
  const attrs = readVariableAttributes(node.attrs)
  const { registry } = extension.options as ReferenceExtensionOptions
  useRegistryVersion(registry)
  const variable = registry.resolveVariable(attrs.key)
  const label = variable?.label ?? attrs.fallbackLabel

  return (
    <NodeViewWrapper
      as="span"
      className={`${PROMPT_ATOM_CLASS} ${
        selected
          ? 'border-accent bg-accent-tint text-text1'
          : variable
            ? 'border-transparent bg-selected text-text2'
            : 'border-danger-text/50 bg-raised text-danger-text'
      }`}
      data-prompt-template-variable=""
      data-variable-key={attrs.key}
      data-variable-state={variable ? 'resolved' : 'missing'}
      title={variable ? label : `变量已失效：${label}`}
    >
      <span className="truncate">{'{{'}{label}{'}}'}</span>
    </NodeViewWrapper>
  )
}
