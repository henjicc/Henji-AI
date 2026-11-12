import { getImageDocumentWorkspace } from '@/features/imageEdit/documents/imageDocumentWorkspace'
import { findOpenImageDocument } from '@/features/imageEdit/documents/imageDocumentRuntime'
import type { ToolboxToolEntry } from '../../toolboxRuntime'

export default {
  loadComponent: () => {
    // 进入图片工具页就预热 GPU 渲染线程（已预热或正在用时什么都不做）：打开文档前还要加载编辑器，正好把冷启动藏进去。
    void import('@/features/imageEdit/v3/gpu/imageEditorGpuScenePool')
      .then((module) => module.prewarmImageEditorGpuScene())
      .catch(() => undefined)
    return import('@/features/imageMark/standalone/ImageMarkTool')
  },
  openRecentFile: async (id) => {
    const { requestImageDocumentInEditor } = await import('@/features/imageEdit/documents/imageDocumentWorkspace')
    requestImageDocumentInEditor({ id })
  },
  currentDocumentName: () => {
    const current = getImageDocumentWorkspace().current
    const editing = current ? findOpenImageDocument(current) : undefined
    return editing && !editing.session.isEnded ? editing.session.documentMeta.name : undefined
  },
} satisfies ToolboxToolEntry
