import { createVideoEditSequence, videoEditComposition, type VideoEditDocument } from '@/core/videoEdit/document'
import { VIDEO_EDIT_DOCUMENT_VERSION } from '@/core/persistence/schemaVersions'
import type { CodeAuthorBundle, CodeAuthorProgram } from '@/core/videoEdit/codeAuthorProgram'
import { VideoEditOffscreenPool } from '../engine/videoEditOffscreenPool'
import { VideoEditRenderTransport } from '../engine/videoEditRenderTransport'
import { prepareAuthorModuleUrls } from '../engine/videoEditAuthorModules'
import { VideoEditRenderWorkerError } from '../engine/videoEditGpuFailure'

// Metadata preparation must not wait for a document lease that is itself
// waiting for metadata (for example while loading declared fonts).
const authorInspectionPool = new VideoEditOffscreenPool(async composition =>
  new VideoEditRenderTransport({ fonts: async () => [], proxies: async () => ({}), maskUpdateTime: () => undefined }, composition))

/** Empty host prevents font preparation from recursively inspecting code.
 * It reuses a bounded render-worker lease, not a worker per effect. */
export async function inspectVideoEditAuthor(bundle: CodeAuthorBundle, signal?: AbortSignal): Promise<CodeAuthorProgram> {
  const controller = new AbortController()
  const cancel = (): void => controller.abort(signal?.reason)
  signal?.throwIfAborted(); signal?.addEventListener('abort', cancel, { once: true })
  const sequence = createVideoEditSequence('代码检查')
  const document: VideoEditDocument = { format: 'henji-video-project', version: VIDEO_EDIT_DOCUMENT_VERSION, id: 'author-inspection', name: sequence.name, revision: 0, media: [], items: [], bins: [], sequences: [sequence] }
  const modules = await prepareAuthorModuleUrls(bundle)
  const { url } = modules
  let lease: Awaited<ReturnType<typeof authorInspectionPool.acquire>> | undefined
  let succeeded = false
  let terminate: (() => void) | undefined
  try {
    lease = await authorInspectionPool.acquire(videoEditComposition(document, sequence.id), controller.signal)
    terminate = () => { void lease?.session.dispose() }
    controller.signal.addEventListener('abort', terminate, { once: true })
    controller.signal.throwIfAborted()
    // 参数声明按同一作者接口解析：v5 起认片子数据参数，v4 代码里的同名自定义类型照旧有效。
    const metadata = await lease.run(videoEditComposition(document, sequence.id), session => session.readAuthorMetadata(url, bundle.locations, bundle.apiVersion))
    controller.signal.throwIfAborted()
    await lease.session.releaseAuthor(url)
    succeeded = true
    // 作者接口版本由编译输入指定：新代码为当前版本，已有记录沿用记录的版本。
    return { ...metadata, seed: 0, apiVersion: bundle.apiVersion ?? 4, languageVersion: 4, bundle }
  } catch (error) { throw error instanceof VideoEditRenderWorkerError ? error.authorError() : error }
  finally {
    signal?.removeEventListener('abort', cancel)
    if (terminate) controller.signal.removeEventListener('abort', terminate)
    modules.dispose()
    await lease?.release(!succeeded)
  }
}
