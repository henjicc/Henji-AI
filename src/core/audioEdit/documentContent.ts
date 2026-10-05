import { audioEditContentSchema, type AudioEditDocumentContent } from '../documents/kinds/audioEdit'
import { DEFAULT_AUDIO_EDIT_SETTINGS } from './edits'
import { audioEditProjectSchema } from './schema'
import type { AudioEditProjectDocument, AudioEditSourceMetadata } from './types'

/*
 * 口播文档内容（`.henji-audio`，3.3）与工具内存形态（AudioEditProjectDocument）的互转。主进程与渲染层共用。
 *
 * 文档外壳负责 ID、名称（文件名）、创建 / 修改时间与版本；内容里是其余全部字段。
 * 工具认识的字段按 `audioEditProjectSchema` 严格校验；不认识的顶层字段（更新版本写入的）原样保留在 extras，
 * 保存时再放回去，不因为旧版本打开过就丢掉。
 */

/** 外壳信息（来自文档元信息）。 */
export interface AudioEditDocumentShell {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  revision: number
}

const KNOWN_KEYS = new Set([
  'source', 'referenceScript', 'transcript', 'suggestions', 'vstEnabled', 'selectedAsrModelId', 'cuts',
  'batchSettings', 'processorChain', 'xmlFrameRate', 'viewSettings', 'editBaseline',
])
const SHELL_KEYS = new Set(['id', 'name', 'createdAt', 'updatedAt', 'revision'])

/** 还没导入音频或视频的口播（新建空文档）：工具需要先请用户导入素材。 */
export class AudioEditSourceMissingError extends Error {
  constructor() {
    super('这份口播还没有导入音频或视频。')
    this.name = 'AudioEditSourceMissingError'
  }
}

export interface AudioEditDocumentParts {
  project: AudioEditProjectDocument
  /** 工具不认识的顶层字段，保存时原样写回。 */
  extras: Record<string, unknown>
}

/** 文档内容 → 工具内存形态；内容不合法时抛错，没有素材时抛 AudioEditSourceMissingError。 */
export function audioEditProjectFromDocument(shell: AudioEditDocumentShell, content: unknown): AudioEditDocumentParts {
  const parsed = audioEditContentSchema.parse(content)
  if (!parsed.source) throw new AudioEditSourceMissingError()
  const known: Record<string, unknown> = {}
  const extras: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (value === undefined || SHELL_KEYS.has(key)) continue
    if (KNOWN_KEYS.has(key)) known[key] = value
    else extras[key] = value
  }
  const project = audioEditProjectSchema.parse({
    ...known,
    id: shell.id,
    name: shell.name,
    createdAt: Math.max(0, Math.round(shell.createdAt)),
    updatedAt: Math.max(0, Math.round(shell.updatedAt)),
    revision: Math.max(0, Math.round(shell.revision)),
  }) as AudioEditProjectDocument
  return { project, extras }
}

/** 工具内存形态 → 文档内容（去掉外壳字段，放回不认识的字段）。 */
export function audioEditProjectToDocumentContent(project: AudioEditProjectDocument, extras: Record<string, unknown> = {}): AudioEditDocumentContent {
  const content: Record<string, unknown> = { ...extras }
  for (const [key, value] of Object.entries(project)) {
    if (SHELL_KEYS.has(key) || value === undefined) continue
    content[key] = value
  }
  return content as AudioEditDocumentContent
}

/** 新导入素材的文档内容（导入即建草稿）。 */
export function createAudioEditDocumentContent(source: AudioEditSourceMetadata, referenceScript = ''): AudioEditDocumentContent {
  const content: Record<string, unknown> = {
    source, referenceScript, transcript: [], suggestions: [], vstEnabled: false, cuts: [], processorChain: [],
    batchSettings: { ...DEFAULT_AUDIO_EDIT_SETTINGS, fillers: [...DEFAULT_AUDIO_EDIT_SETTINGS.fillers] },
  }
  return content as AudioEditDocumentContent
}
