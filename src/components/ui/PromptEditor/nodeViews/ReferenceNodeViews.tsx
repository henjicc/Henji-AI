import { useSyncExternalStore } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'

import type { PromptMediaType } from '@/core/inputs/promptDocument'
import type { PromptEditorResourceRegistry } from '../resourceRegistry'

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
      className={`mx-0.5 inline-flex max-w-[180px] select-none items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 align-middle text-xs ${
        selected
          ? 'border-accent bg-brand-600 text-white'
          : reference
            ? 'border-border-dark bg-layer text-text-dark'
            : 'border-red-500/50 bg-surface-dark text-red-300'
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
          className="h-5 w-5 shrink-0 rounded object-cover"
          draggable={false}
        />
      ) : (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-surface-dark px-1 text-[9px] text-text-muted">
          {attrs.mediaType}
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
      className={`mx-0.5 inline-flex max-w-[180px] select-none items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 align-middle text-xs ${
        selected
          ? 'border-accent bg-brand-600 text-white'
          : variable
            ? 'border-border-dark bg-layer text-text-dark'
            : 'border-red-500/50 bg-surface-dark text-red-300'
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
