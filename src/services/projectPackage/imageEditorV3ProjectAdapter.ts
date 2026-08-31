import type { CanvasNode } from '@/features/canvas/domain/canvasNodes'
import {
  parseImageEditSessionReferenceV3,
  type ImageEditSessionReferenceV3,
} from '@/core/imageEdit/v3/sessionReference'
import {
  IMAGE_EDIT_PROJECT_PACKAGE_BUNDLE_PATH_V3,
  IMAGE_EDIT_PROJECT_PACKAGE_EXTENSION_VERSION_V3,
  parseImageEditProjectPackageReferenceMappingsV3,
  toImageEditProjectPackageDocumentReferenceV3,
  type ImageEditProjectPackageExtensionV3,
  type ImageEditProjectPackageReferenceMappingV3,
} from '@/core/imageEdit/v3/projectPackageContracts'

function readNodeSession(node: CanvasNode): ImageEditSessionReferenceV3 | null {
  const value = (node.data as DynamicValueMap).imageEditSession
  if (value === undefined) return null
  const imageUrl = (node.data as DynamicValueMap).imageUrl
  const fallbackSourceUrl = typeof imageUrl === 'string' ? imageUrl : ''
  const session = parseImageEditSessionReferenceV3(value, fallbackSourceUrl)
  if (!session) throw new TypeError(`节点 ${node.id} 的图片编辑 V3 会话引用无效`)
  if (fallbackSourceUrl && session.sourceUrl !== fallbackSourceUrl) {
    throw new TypeError(`节点 ${node.id} 的图片编辑 V3 来源与图片不一致`)
  }
  return session
}

export function createProjectImageEditorV3Extension(
  nodes: readonly CanvasNode[],
): ImageEditProjectPackageExtensionV3 | undefined {
  const documents = new Map<string, ReturnType<typeof toImageEditProjectPackageDocumentReferenceV3>>()
  for (const node of nodes) {
    const session = readNodeSession(node)
    if (!session) continue
    const reference = toImageEditProjectPackageDocumentReferenceV3(session)
    const previous = documents.get(reference.documentRef)
    if (previous && (
      previous.revision !== reference.revision
      || previous.previewRef !== reference.previewRef
    )) {
      throw new TypeError(`同一图片编辑文档存在冲突版本：${reference.documentRef}`)
    }
    documents.set(reference.documentRef, reference)
  }
  if (documents.size === 0) return undefined
  return {
    version: IMAGE_EDIT_PROJECT_PACKAGE_EXTENSION_VERSION_V3,
    bundlePath: IMAGE_EDIT_PROJECT_PACKAGE_BUNDLE_PATH_V3,
    documents: [...documents.values()],
  }
}

export function mapProjectImageEditorV3SessionSource(
  data: DynamicValueMap,
  mapValue: (value: string) => string,
): DynamicValueMap {
  const raw = data.imageEditSession
  if (raw === undefined) return data
  const fallback = typeof data.imageUrl === 'string' ? data.imageUrl : ''
  const session = parseImageEditSessionReferenceV3(raw, fallback)
  if (!session) throw new TypeError('图片编辑 V3 会话引用无效')
  return {
    ...data,
    imageEditSession: {
      ...session,
      sourceUrl: mapValue(session.sourceUrl),
    },
  }
}

export function rewriteProjectImageEditorV3References(
  nodes: readonly CanvasNode[],
  rawMappings: unknown,
): CanvasNode[] {
  const mappings = parseImageEditProjectPackageReferenceMappingsV3(rawMappings)
  const bySource = new Map<string, ImageEditProjectPackageReferenceMappingV3>()
  for (const mapping of mappings) bySource.set(mapping.source.documentRef, mapping)

  const used = new Set<string>()
  const rewritten = nodes.map((node) => {
    const session = readNodeSession(node)
    if (!session) return node
    const mapping = bySource.get(session.documentRef)
    if (!mapping) throw new Error(`项目包缺少图片编辑文档映射：${session.documentRef}`)
    if (
      mapping.source.revision !== session.revision
      || mapping.source.previewRef !== session.previewRef
    ) {
      throw new Error(`项目包图片编辑文档映射版本不匹配：${session.documentRef}`)
    }
    used.add(session.documentRef)
    return {
      ...node,
      data: {
        ...node.data,
        imageEditSession: {
          ...session,
          documentRef: mapping.imported.documentRef,
          revision: mapping.imported.revision,
          previewRef: mapping.imported.previewRef,
        },
      },
    } as CanvasNode
  })

  for (const mapping of mappings) {
    if (!used.has(mapping.source.documentRef)) {
      throw new Error(`项目包包含未被节点引用的图片编辑文档映射：${mapping.source.documentRef}`)
    }
  }
  return rewritten
}
