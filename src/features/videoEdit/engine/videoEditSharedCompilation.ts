import type { CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import type { CodeCompilerResponse, CodeCompilerWorker } from './videoEditCodeCompiler'

export type SharedCompilationRequest = { kind: 'code.compile'; token: number; files: CodeMaterialFiles; operation: 'author.bundle' } | { kind: 'code.cancel'; token: number }
export type SharedCompilationResponse = { kind: 'code.compiled'; token: number; result: CodeCompilerResponse }

/** Transport only: module bundling, content-keyed caching, limits and cancellation
 * stay in the existing compiler. No GPU objects or document state cross sessions. */
export class VideoEditSharedCompilation {
  private next = 0
  private readonly pending = new Map<number, { worker: CodeCompilerWorker; id: number }>()
  constructor(private readonly send: (message: SharedCompilationRequest) => void) {}
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
    const entry = this.pending.get(message.token)
    if (!entry) return
    this.pending.delete(message.token)
    entry.worker.onmessage?.({ data: { ...message.result, id: entry.id } } as MessageEvent<CodeCompilerResponse>)
  }
}
