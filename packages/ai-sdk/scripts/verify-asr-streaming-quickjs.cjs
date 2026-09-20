// Explicit probe, not part of ordinary unit tests. Install quickjs-emscripten in a
// temporary directory and pass its absolute module path as argv[2]. No SDK dependency.
const { buildSync } = require('esbuild')
const path = require('node:path')
const { getQuickJS } = require(process.argv[2] || 'quickjs-emscripten')

async function main() {
  const code = buildSync({
    stdin: {
      resolveDir: path.resolve(__dirname, '..'), loader: 'ts',
      contents: `
        import { prepareMedia, multipartAudioRequest, jsonAudioRequest } from './src/capabilities/media-request'
        const signal = { aborted: false }
        globalThis.finished = false
        ;(async () => {
          for (const [size, json] of [[50_000_000, false], [7_500_000, true], [12_000_000, true]]) {
            let offset = 0
            const runtime = {
              media: {
                read: async () => { throw new Error('whole-file read') },
                describe: async () => ({ size, mimeType: 'audio/wav', filename: 'audio.wav' }),
                readChunk: async (_ref, start, length) => {
                  if (start !== offset || length > 65536) throw new Error('invalid chunk request')
                  offset += length
                  return new Uint8Array(length)
                },
              },
              transport: { fetchStream() {} },
            }
            const media = await prepareMedia({ kind: 'media-ref', ref: 'audio' }, runtime, size, signal)
            const request = json ? jsonAudioRequest(media, data => ({ data }))
              : multipartAudioRequest(media, [['model', 'test']])
            let total = 0
            for await (const chunk of request.body) {
              if (chunk.length > 65536) throw new Error('oversized output chunk')
              total += chunk.length
            }
            if (total !== request.contentLength || offset !== size) throw new Error('truncated body')
          }
          globalThis.finished = true
        })().catch(error => { globalThis.failure = String(error); globalThis.finished = true })
      `,
    },
    platform: 'browser', format: 'iife', target: 'es2020', bundle: true, write: false,
  }).outputFiles[0].text
  const QuickJS = await getQuickJS()
  const runtime = QuickJS.newRuntime()
  runtime.setMemoryLimit(64 * 1024 * 1024)
  const context = runtime.newContext()
  try {
    const evaluated = context.evalCode(code)
    if (evaluated.error) throw new Error(JSON.stringify(context.dump(evaluated.error)))
    evaluated.value.dispose()
    while (runtime.hasPendingJob()) {
      const result = runtime.executePendingJobs(1000)
      if (result.error) {
        const error = context.dump(result.error)
        result.error.dispose()
        throw new Error(JSON.stringify(error))
      }
    }
    const finished = context.getProp(context.global, 'finished')
    const failure = context.getProp(context.global, 'failure')
    const done = context.dump(finished)
    const error = context.dump(failure)
    finished.dispose(); failure.dispose()
    if (!done || error) throw new Error(error || 'QuickJS did not finish')
    // Negative control proves this really is a bounded QuickJS runtime.
    const oversized = context.evalCode('new Uint8Array(128 * 1024 * 1024)')
    if (!oversized.error) {
      oversized.value.dispose()
      throw new Error('QuickJS memory ceiling was not enforced')
    }
    oversized.error.dispose()
    console.log('QuickJS 64 MiB: 50 MB multipart + 7.5/12 MB streaming JSON passed; 128 MiB allocation rejected')
  } finally {
    context.dispose(); runtime.dispose()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
