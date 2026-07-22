import type { JSONContent } from '@tiptap/core'

export type PrototypeMediaType = 'image' | 'video' | 'audio'

export interface PrototypeReference {
  id: string
  label: string
  mediaType: PrototypeMediaType
  thumbnailSrc?: string
  sourceNodeId?: string
}

export interface PromptEditorPrototypeHandle {
  focus: () => void
  getDocument: () => JSONContent
  replaceDocument: (document: JSONContent) => void
}

export function createPrototypeDocument(index = 1): JSONContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: `镜头 ${index}：雨后的城市街道，` },
          {
            type: 'mediaReference',
            attrs: {
              id: 'asset-demo-image',
              label: '图1',
              mediaType: 'image',
              sourceNodeId: null,
            },
          },
          { type: 'text', text: ' 作为构图参考。' },
        ],
      },
    ],
  }
}

export function createReplacementDocument(): JSONContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '程序化替换：保持主体清晰，参考 ' },
          {
            type: 'mediaReference',
            attrs: {
              id: 'asset-demo-video',
              label: '视频1',
              mediaType: 'video',
              sourceNodeId: 'prototype-source-node',
            },
          },
          { type: 'text', text: ' 的运动节奏。' },
        ],
      },
    ],
  }
}
