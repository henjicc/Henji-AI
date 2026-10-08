import { createHash } from 'node:crypto'
import type { CodeFileReference, CodeSource } from './sources'
import { documentCodeSourceResolver, resolveCodeMaterialFiles, type CodeMaterialFiles } from './sources'
/** Explicit new-format fixtures; never imported by production code. */
export function testCodeManifest(source: string, document: { codeSources?: CodeSource[] }): { entry: string; files: CodeFileReference[] } {
  const hash = createHash('sha256').update(source, 'utf8').digest('hex')
  document.codeSources ??= []
  if (!document.codeSources.some(value => value.hash === hash)) document.codeSources.push({ hash, source })
  return { entry: 'main.ts', files: [{ path: 'main.ts', hash }] }
}
export function testCodeSource(document: { codeSources?: CodeSource[] }, version: { entry: string; files: CodeFileReference[] }): string {
  const contents = resolveCodeMaterialFiles(version, documentCodeSourceResolver(document)); return contents.files[contents.entry]
}
export function testSetCodeSource(document: { codeSources?: CodeSource[] }, version: { entry: string; files: CodeFileReference[] }, source: string): void { Object.assign(version, testCodeManifest(source, document)) }
export function testCodeAssetSource(source: string, languageVersion: 1 | 2 | 3): { codeSources: CodeSource[]; sourceVersion: { apiVersion: 1; languageVersion: 1 | 2 | 3; entry: string; files: CodeFileReference[] } } {
  const document: { codeSources: CodeSource[] } = { codeSources: [] }
  return { sourceVersion: { apiVersion: 1, languageVersion, ...testCodeManifest(source, document) }, codeSources: document.codeSources }
}
export function testFilesSource(input: string | CodeMaterialFiles): string { return typeof input === 'string' ? input : input.files[input.entry] }
