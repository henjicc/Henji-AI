import { beforeEach, describe, expect, it } from 'vitest'

import { createEmptyImageEditDocument } from '@/core/imageEdit'
import {
  clearImageMarkToolWorkspaceSourceV3,
  readImageMarkToolWorkspaceSourceV3,
  rememberImageMarkToolWorkspaceSessionV3,
  rememberImageMarkToolWorkspaceSourceV3,
} from './imageMarkToolWorkspaceV3'

describe('图片编辑 V3 工具箱工作区恢复', () => {
  beforeEach(clearImageMarkToolWorkspaceSourceV3)

  it('只保存来源和稳定会话，不把会话状态混入文档', () => {
    rememberImageMarkToolWorkspaceSourceV3({
      url: 'data:image/png;base64,AA==',
      name: 'clipboard.png',
      sessionKey: 4,
      initialDocument: createEmptyImageEditDocument(),
    })
    const session = {
      kind: 'image-edit-v3' as const,
      sourceUrl: `henji-media://image-editor-v3/${'a'.repeat(64)}?mediaType=image%2Fpng`,
      documentRef: 'image-edit-v3:toolbox-document' as const,
      revision: 7,
      previewRef: `sha256:${'b'.repeat(64)}` as const,
    }

    expect(rememberImageMarkToolWorkspaceSessionV3(4, session)).toBe(true)
    expect(readImageMarkToolWorkspaceSourceV3()).toMatchObject({
      url: session.sourceUrl,
      session,
      sessionKey: 4,
    })
    expect(readImageMarkToolWorkspaceSourceV3()).not.toHaveProperty('activeTool')
  })

  it('旧宿主的迟到保存不能覆盖已经打开的新图片', () => {
    rememberImageMarkToolWorkspaceSourceV3({
      url: '/new.png',
      name: 'new.png',
      sessionKey: 9,
      initialDocument: createEmptyImageEditDocument(),
    })
    expect(rememberImageMarkToolWorkspaceSessionV3(8, {
      kind: 'image-edit-v3',
      sourceUrl: '/old.png',
      documentRef: 'image-edit-v3:old-document',
      revision: 1,
      previewRef: null,
    })).toBe(false)
    expect(readImageMarkToolWorkspaceSourceV3()?.url).toBe('/new.png')
  })
})
