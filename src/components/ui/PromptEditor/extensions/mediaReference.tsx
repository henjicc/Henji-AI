import {
  mergeAttributes,
  Node,
  type Editor,
  type Range,
} from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'

import type { PromptMediaType } from '@/core/inputs/promptDocument'
import { MediaReferenceNodeView } from '../nodeViews/ReferenceNodeViews'
import { PromptEditorResourceRegistry } from '../resourceRegistry'
import { createSuggestionRenderer } from '../suggestions/createSuggestionRenderer'
import type { PromptSuggestionItem } from '../suggestions/PromptSuggestionList'
import type { PromptReferenceItem } from '../types'

export interface MediaReferenceExtensionOptions {
  registry: PromptEditorResourceRegistry
}

interface MediaReferenceAttributes {
  resourceId: string
  mediaType: PromptMediaType
  fallbackLabel: string
  sourceNodeId: string | null
}

const mediaReferenceSuggestionKey = new PluginKey('promptMediaReferenceSuggestion')

function readAttributes(attrs: Record<string, unknown>): MediaReferenceAttributes {
  const mediaType = attrs.mediaType
  return {
    resourceId: typeof attrs.resourceId === 'string' ? attrs.resourceId : '',
    mediaType: mediaType === 'video' || mediaType === 'audio' ? mediaType : 'image',
    fallbackLabel: typeof attrs.fallbackLabel === 'string'
      ? attrs.fallbackLabel
      : '失效引用',
    sourceNodeId: typeof attrs.sourceNodeId === 'string' ? attrs.sourceNodeId : null,
  }
}

function insertMediaReference(
  editor: Editor,
  range: Range,
  reference: PromptReferenceItem,
): void {
  editor.chain()
    .focus()
    .insertContentAt(range, [
      {
        type: 'mediaReference',
        attrs: {
          resourceId: reference.resourceId,
          mediaType: reference.mediaType,
          fallbackLabel: reference.label,
          sourceNodeId: reference.sourceNodeId ?? null,
        },
      },
      { type: 'text', text: ' ' },
    ])
    .run()
}

export const MediaReferenceExtension = Node.create<MediaReferenceExtensionOptions>({
  name: 'mediaReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { registry: new PromptEditorResourceRegistry() }
  },

  addAttributes() {
    return {
      resourceId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-reference-id') ?? '',
        renderHTML: (attributes) => ({
          'data-reference-id': readAttributes(attributes).resourceId,
        }),
      },
      mediaType: {
        default: 'image',
        parseHTML: (element) => element.getAttribute('data-media-type') ?? 'image',
        renderHTML: (attributes) => ({
          'data-media-type': readAttributes(attributes).mediaType,
        }),
      },
      fallbackLabel: {
        default: '失效引用',
        parseHTML: (element) => element.getAttribute('data-fallback-label') ?? '失效引用',
        renderHTML: (attributes) => ({
          'data-fallback-label': readAttributes(attributes).fallbackLabel,
        }),
      },
      sourceNodeId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-source-node-id'),
        renderHTML: (attributes) => ({
          'data-source-node-id': readAttributes(attributes).sourceNodeId,
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-prompt-media-reference]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = readAttributes(node.attrs)
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-prompt-media-reference': '' }),
      `@${attrs.fallbackLabel}`,
    ]
  },

  renderText({ node }) {
    return `@${readAttributes(node.attrs).fallbackLabel}`
  },

  addNodeView() {
    return ReactNodeViewRenderer(MediaReferenceNodeView, { as: 'span' })
  },

  addProseMirrorPlugins() {
    const registry = this.options.registry
    return [
      Suggestion<PromptSuggestionItem, PromptSuggestionItem>({
        editor: this.editor,
        pluginKey: mediaReferenceSuggestionKey,
        char: '@',
        container: registry.getSuggestionContainer(),
        items: async ({ query }) => (
          (await registry.getReferenceSuggestions(query)).map((value) => ({
            kind: 'reference' as const,
            value,
          }))
        ),
        command: ({ editor, range, props }): void => {
          if (props.kind === 'reference') insertMediaReference(editor, range, props.value)
        },
        render: createSuggestionRenderer(),
      }),
    ]
  },
})
