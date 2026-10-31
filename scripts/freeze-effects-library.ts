import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild-wasm'
import { AUTHOR_LIBRARIES } from '../src/core/videoEdit/codeMaterial/authorLibraries.ts'
import { assertNewFrozenAuthorRelease, sha256, type FrozenAuthorManifest } from './lib/frozenAuthorLibraries.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const version = process.argv[2]
const release = AUTHOR_LIBRARIES['henji-effects'][version]
if (process.argv.length !== 3 || !release?.frozen) throw new Error('请先登记 henji-effects 的新版本，再传入版本号。')
assertNewFrozenAuthorRelease(root, release.frozen)
const destination = path.join(root, release.frozen)
const bundled = await esbuild.build({ absWorkingDir: root, entryPoints: ['src/features/videoEdit/authorLibraries/effects.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2020', write: false, metafile: true })
const types = fs.readFileSync(path.join(root, 'resources/video-edit-author/effects-library.d.ts'), 'utf8')
const outputs: Record<string, string> = {
  'index.mjs': bundled.outputFiles[0].text,
  'types.json': JSON.stringify({ mount: 'henji-effects', modules: ['index.mjs'], files: { 'index.d.ts': types, 'package.json': JSON.stringify({ name: 'henji-effects', version, types: './index.d.ts' }) } }),
  LICENSE: fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'),
}
const inputs = [...Object.keys(bundled.metafile.inputs), 'resources/video-edit-author/effects-library.d.ts', 'scripts/generate-author-effects.ts', 'scripts/freeze-effects-library.ts']
const manifest: FrozenAuthorManifest = { library: 'henji-effects', version, inputs: Object.fromEntries(inputs.map(file => [file, sha256(fs.readFileSync(path.join(root, file)))])), outputs: Object.fromEntries(Object.entries(outputs).map(([file, text]) => [file, sha256(text)])) }
fs.mkdirSync(destination, { recursive: true })
for (const [file, text] of Object.entries(outputs)) fs.writeFileSync(path.join(destination, file), text, { flag: 'wx' })
fs.writeFileSync(path.join(destination, 'release.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
console.log(`已冻结 henji-effects@${version}。`)
