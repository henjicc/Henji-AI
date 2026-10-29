import type { CodeMaterialFiles, CodeFileReference } from '@/core/videoEdit/codeMaterial/sources'
import type { CodeCompilerResponse, CodeCompilerWorker } from './videoEditCodeCompiler'
import type { AuthorCachedMetadata } from './videoEditAuthorMetadataCache'
import type { AuthorModuleUrls } from './videoEditAuthorModules'
import type { AuthorTrustRequest } from './videoEditAuthorTrust'
import { restoreContentTrustError, type ContentTrustFailure } from '@/core/contentTrust'

export type SharedCompilationRequest = { kind: 'code.trust'; token: number; request: AuthorTrustRequest } | { kind: 'code.compile'; token: number; files: CodeMaterialFiles; operation: 'author.bundle' } | { kind: 'code.cancel'; token: number } | { kind: 'code.read'; token: number; file: CodeFileReference } | { kind: 'code.metadata'; token: number; key: string; metadata?: AuthorCachedMetadata } | { kind: 'code.modules'; token: number; files: CodeMaterialFiles } | { kind: 'code.releaseModules'; token: number }
export type SharedCompilationResponse = { kind: 'code.trustResult'; token: number; error?: string; contentTrust?: ContentTrustFailure } | { kind: 'code.compiled'; token: number; result: CodeCompilerResponse } | { kind: 'code.source'; token: number; source?: string; error?: string; contentTrust?: ContentTrustFailure } | { kind: 'code.metadataResult'; token: number; metadata?: AuthorCachedMetadata } | { kind: 'code.moduleUrls'; token: number; url?: string; error?: string; contentTrust?: ContentTrustFailure }

/** Transport only: module bundling, content-keyed caching, limits and cancellation
 * stay in the existing compiler. No GPU objects or document state cross sessions. */
export class VideoEditSharedCompilation {
  private next = 0
  private readonly pending = new Map<number, { worker: CodeCompilerWorker; id: number }>()
  private readonly reads = new Map<number, { resolve(value: string): void; reject(error: Error): void }>()
  private readonly metadataReads = new Map<number, (value: AuthorCachedMetadata | undefined) => void>()
  private readonly moduleReads = new Map<number, { resolve(value: AuthorModuleUrls): void; reject(error: Error): void }>()
  private readonly trustReads = new Map<number, { resolve(): void; reject(error: Error): void }>()
  constructor(private readonly send: (message: SharedCompilationRequest) => void) {}
  trust(request: AuthorTrustRequest): Promise<void> {
    const token = ++this.next
    return new Promise((resolve, reject) => { this.trustReads.set(token, { resolve, reject }); this.send({ kind: 'code.trust', token, request }) })
  }
  modules(files: CodeMaterialFiles): Promise<AuthorModuleUrls> {
    const token = ++this.next
    return new Promise((resolve, reject) => { this.moduleReads.set(token, { resolve, reject }); this.send({ kind: 'code.modules', token, files }) })
  }
  metadata(key: string, metadata?: AuthorCachedMetadata): Promise<AuthorCachedMetadata | undefined> {
    const token = ++this.next
    return new Promise(resolve => { this.metadataReads.set(token, resolve); this.send({ kind: 'code.metadata', token, key, metadata }) })
  }
  read(file: CodeFileReference): Promise<string> {
    const token = ++this.next
    return new Promise((resolve, reject) => { this.reads.set(token, { resolve, reject }); this.send({ kind: 'code.read', token, file }) })
  }
  worker(): CodeCompilerWorker {
    const worker: CodeCompilerWorker = {
      onmessage: null, onerror: null, onmessageerror: null,
      postMessage: message => {
        const token = ++this.next
        this.pending.set(token, { worker, id: message.id })
        this.send({ kind: 'code.compile', token, files: message.files, operation: message.kind })
      },
      terminate: () => {
        for (const [token, entry] of this.pending) if (entry.worker === worker) {
          this.pending.delete(token); this.send({ kind: 'code.cancel', token })
        }
      },
    }
    return worker
  }
  receive(message: SharedCompilationResponse): void {
    if (message.kind === 'code.trustResult') {
      const pending = this.trustReads.get(message.token); this.trustReads.delete(message.token)
      if (message.error) pending?.reject(restoreContentTrustError(new Error(message.error), message.contentTrust)); else pending?.resolve()
      return
    }
    if (message.kind === 'code.moduleUrls') {
      const pending = this.moduleReads.get(message.token); this.moduleReads.delete(message.token)
      if (message.url) pending?.resolve({ url: message.url, dispose: () => this.send({ kind: 'code.releaseModules', token: message.token }) })
      else pending?.reject(restoreContentTrustError(new Error(message.error ?? '源码模块读取失败，请重试。'), message.contentTrust))
      return
    }
    if (message.kind === 'code.metadataResult') {
      this.metadataReads.get(message.token)?.(message.metadata); this.metadataReads.delete(message.token); return
    }
    if (message.kind === 'code.source') {
      const pending = this.reads.get(message.token); this.reads.delete(message.token)
      if (message.source !== undefined) pending?.resolve(message.source)
      else pending?.reject(restoreContentTrustError(new Error(message.error ?? '源码读取失败，请恢复原文件后重试。'), message.contentTrust))
      return
    }
    const entry = this.pending.get(message.token)
    if (!entry) return
    this.pending.delete(message.token)
    entry.worker.onmessage?.({ data: { ...message.result, id: entry.id } } as MessageEvent<CodeCompilerResponse>)
  }
}
