import { Node, mergeAttributes, type Range } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, ReactRenderer, type NodeViewProps } from '@tiptap/react'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, {
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from '@tiptap/suggestion'
import { ImageOff } from 'lucide-react'

import { PrototypeSuggestionList, type PrototypeSuggestionListHandle } from './PrototypeSuggestionList'
import type { PrototypeReference } from './prototypeTypes'

interface MediaReferenceOptions {
  references: readonly PrototypeReference[]
}

interface MediaReferenceAttributes {
  id: string
  label: string
  mediaType: string
  sourceNodeId: string | null
}

const mediaReferenceSuggestionKey = new PluginKey('prototypeMediaReferenceSuggestion')

function readAttributes(attrs: Record<string, unknown>): MediaReferenceAttributes {
  return {
    id: typeof attrs.id === 'string' ? attrs.id : '',
    label: typeof attrs.label === 'string' ? attrs.label : '失效引用',
    mediaType: typeof attrs.mediaType === 'string' ? attrs.mediaType : 'image',
    sourceNodeId: typeof attrs.sourceNodeId === 'string' ? attrs.sourceNodeId : null,
  }
}

function MediaReferenceNodeView({ node, extension, selected }: NodeViewProps): JSX.Element {
  const attrs = readAttributes(node.attrs)
  const options = extension.options as MediaReferenceOptions
  const reference = options.references.find((item) => item.id === attrs.id)

  return (
    <NodeViewWrapper
      as="span"
      className={`mx-0.5 inline-flex max-w-[180px] select-none items-center gap-1 rounded-md border px-1.5 py-0.5 align-middle text-xs ${
        selected
          ? 'border-accent bg-brand-600 text-white'
          : reference
            ? 'border-border-dark bg-layer text-text-dark'
            : 'border-red-500/50 bg-surface-dark text-red-300'
      }`}
      data-reference-id={attrs.id}
      data-reference-state={reference ? 'resolved' : 'missing'}
    >
      {reference?.thumbnailSrc ? (
        <img
          src={reference.thumbnailSrc}
          alt=""
          className="h-5 w-5 rounded object-cover"
          draggable={false}
        />
      ) : (
        <ImageOff className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="truncate">@{attrs.label}</span>
    </NodeViewWrapper>
  )
}

function createSuggestionRenderer() {
  let renderer: ReactRenderer<
    PrototypeSuggestionListHandle,
    SuggestionProps<PrototypeReference, PrototypeReference>
  > | null = null
  let unmount: (() => void) | null = null

  return {
    onStart: (props: SuggestionProps<PrototypeReference, PrototypeReference>): void => {
      renderer = new ReactRenderer(PrototypeSuggestionList, {
        editor: props.editor,
        props,
      })
      unmount = props.mount(renderer.element)
    },
    onUpdate: (props: SuggestionProps<PrototypeReference, PrototypeReference>): void => {
      renderer?.updateProps(props)
    },
    onKeyDown: (props: SuggestionKeyDownProps): boolean => (
      renderer?.ref?.onKeyDown(props) ?? false
    ),
    onExit: (): void => {
      unmount?.()
      renderer?.destroy()
      unmount = null
      renderer = null
    },
  }
}

export const MediaReferenceExtension = Node.create<MediaReferenceOptions>({
  name: 'mediaReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { references: [] }
  },

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-reference-id') ?? '',
        renderHTML: (attributes) => ({ 'data-reference-id': readAttributes(attributes).id }),
      },
      label: {
        default: '失效引用',
        parseHTML: (element) => element.getAttribute('data-reference-label') ?? '失效引用',
        renderHTML: (attributes) => ({ 'data-reference-label': readAttributes(attributes).label }),
      },
      mediaType: {
        default: 'image',
        parseHTML: (element) => element.getAttribute('data-media-type') ?? 'image',
        renderHTML: (attributes) => ({ 'data-media-type': readAttributes(attributes).mediaType }),
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
      mergeAttributes(HTMLAttributes, {
        'data-prompt-media-reference': '',
      }),
      `@${attrs.label}`,
    ]
  },

  renderText({ node }) {
    return `@${readAttributes(node.attrs).label}`
  },

  addNodeView() {
    return ReactNodeViewRenderer(MediaReferenceNodeView, { as: 'span' })
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<PrototypeReference, PrototypeReference>({
        editor: this.editor,
        pluginKey: mediaReferenceSuggestionKey,
        char: '@',
        items: ({ query }): PrototypeReference[] => {
          const normalizedQuery = query.trim().toLocaleLowerCase()
          return this.options.references
            .filter((item) => item.label.toLocaleLowerCase().includes(normalizedQuery))
            .slice(0, 8)
        },
        command: ({ editor, range, props }): void => {
          insertMediaReference(editor, range, props)
        },
        render: createSuggestionRenderer,
      }),
    ]
  },
})

function insertMediaReference(
  editor: Parameters<NonNullable<Parameters<typeof Suggestion<PrototypeReference, PrototypeReference>>[0]['command']>>[0]['editor'],
  range: Range,
  reference: PrototypeReference,
): void {
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      {
        type: 'mediaReference',
        attrs: {
          id: reference.id,
          label: reference.label,
          mediaType: reference.mediaType,
          sourceNodeId: reference.sourceNodeId ?? null,
        },
      },
      { type: 'text', text: ' ' },
    ])
    .run()
}
