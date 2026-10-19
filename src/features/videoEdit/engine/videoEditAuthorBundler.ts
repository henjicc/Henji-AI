import { build, initialize } from 'esbuild-wasm'
import wasmURL from 'esbuild-wasm/esbuild.wasm?url'
import type { CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { bundleAuthorFiles, type AuthorBundle } from './videoEditAuthorBundle'

let ready: Promise<void> | undefined
/** Called from the existing shared compilation worker, not a worker per effect. */
export async function bundleVideoEditAuthorModule(files: CodeMaterialFiles): Promise<AuthorBundle> {
  ready ??= initialize({ wasmURL, worker: false }).catch(error => { ready = undefined; throw error })
  await ready
  return bundleAuthorFiles(files, build)
}
