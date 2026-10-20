import { createVideoEditSequence, videoEditComposition, type VideoEditDocument } from '@/core/videoEdit/document'
import { VIDEO_EDIT_DOCUMENT_VERSION } from '@/core/persistence/schemaVersions'
import type { CodeAuthorBundle, CodeAuthorProgram } from '@/core/videoEdit/codeAuthorProgram'
import { VideoEditOffscreenPool } from '../engine/videoEditOffscreenPool'
import { VideoEditRenderTransport } from '../engine/videoEditRenderTransport'

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
  const url = URL.createObjectURL(new Blob([bundle.code], { type: 'text/javascript' }))
  let lease: Awaited<ReturnType<typeof authorInspectionPool.acquire>> | undefined
  let succeeded = false
  let terminate: (() => void) | undefined
  try {
    lease = await authorInspectionPool.acquire(videoEditComposition(document, sequence.id), controller.signal)
    const session = lease.session
    terminate = () => { void session.dispose() }
    controller.signal.addEventListener('abort', terminate, { once: true })
    controller.signal.throwIfAborted()
    const metadata = await session.readAuthorMetadata(url, bundle.locations)
    controller.signal.throwIfAborted()
    await session.releaseAuthor(url)
    succeeded = true
    return { ...metadata, seed: 0, apiVersion: 4, languageVersion: 4, bundle }
  } finally {
    signal?.removeEventListener('abort', cancel)
    if (terminate) controller.signal.removeEventListener('abort', terminate)
    URL.revokeObjectURL(url)
    await lease?.release(!succeeded)
  }
}
