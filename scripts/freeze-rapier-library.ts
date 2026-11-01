import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { AUTHOR_LIBRARIES } from '../src/core/videoEdit/codeMaterial/authorLibraries.ts'
import { assertNewFrozenAuthorRelease, readFrozenAuthorRelease, sha256, validateFrozenAuthorHistory, type FrozenAuthorManifest } from './lib/frozenAuthorLibraries.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const library = '@dimforge/rapier3d-deterministic-compat', version = '0.21.0-henji.1', upstream = '0.21.0'
const integrity = 'sha512-n7JuU62Obljlgq+OeH2DHhTmRSjRzwuJPl54tS9pFIzVQyvXsO5CH+a5KkIRBtnFWDbg1Zicv9BulG0jfBAopA=='
const relative = AUTHOR_LIBRARIES[library][version].frozen!, destination = path.join(root, relative)

if (process.argv[2] === '--check') {
  validateFrozenAuthorHistory(root)
  readFrozenAuthorRelease(destination, library, version)
  const source = JSON.parse(fs.readFileSync(path.join(destination, 'source.json'), 'utf8'))
  if (source.name !== library || source.version !== upstream || source.integrity !== integrity) throw new Error('Rapier 上游来源不符。')
  console.log(`Rapier vendor --check 通过：${library}@${version}`)
} else {
  const archive = process.argv[2]
  if (!archive) throw new Error('用法：node scripts/freeze-rapier-library.ts <npm pack 归档绝对路径> | --check')
  const bytes = fs.readFileSync(archive)
  if (`sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}` !== integrity) throw new Error('npm pack 归档完整性不符。')
  assertNewFrozenAuthorRelease(root, relative)
  const unpacked = path.join(path.dirname(archive), 'package')
  execFileSync('tar', ['-xf', path.basename(archive)], { cwd: path.dirname(archive) })
  const manifest = JSON.parse(fs.readFileSync(path.join(unpacked, 'package.json'), 'utf8'))
  if (manifest.name !== library || manifest.version !== upstream || manifest.license !== 'Apache-2.0') throw new Error('Rapier 包元数据不符。')
  const files: Record<string, string> = {}
  function types(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) types(file)
      else if (entry.name.endsWith('.d.ts')) files[path.relative(unpacked, file).split(path.sep).join('/')] = fs.readFileSync(file, 'utf8')
    }
  }
  types(path.join(unpacked, 'dist'))
  files['package.json'] = JSON.stringify({ name: library, version, types: './dist/rapier.d.ts' })
  const outputs: Record<string, string> = {
    'upstream.mjs': fs.readFileSync(path.join(unpacked, 'dist/rapier.mjs'), 'utf8').replace(/^\/\/[#@] sourceMappingURL=.*(?:\r?\n|$)/gm, ''),
    'rapier.mjs': `import RAPIER, { init as initialize } from './upstream.mjs';
export * from './upstream.mjs';
let ready;
export function init() {
  return ready ??= initialize().catch(error => {
    ready = undefined;
    throw error;
  });
}
export default { ...RAPIER, init };
`,
    'types.json': JSON.stringify({ mount: library, modules: ['rapier.mjs'], files }),
    LICENSE: fs.readFileSync(path.join(unpacked, 'LICENSE'), 'utf8'),
    'source.json': JSON.stringify({ name: library, version: upstream, integrity, url: 'https://registry.npmjs.org/@dimforge/rapier3d-deterministic-compat/-/rapier3d-deterministic-compat-0.21.0.tgz', license: 'Apache-2.0', files: { 'dist/rapier.mjs': sha256(fs.readFileSync(path.join(unpacked, 'dist/rapier.mjs'))) } }, null, 2) + '\n',
    'NOTICE.txt': 'Rapier 3D deterministic-compat 0.21.0 — Dimforge, Apache-2.0.\nHenji removes the upstream ESM sourceMappingURL; embedded WebAssembly is unchanged.\nHenji adds a shared init Promise with retry after failure in rapier.mjs; see source.json and LICENSE.\n',
  }
  const inputs = ['scripts/freeze-rapier-library.ts', 'scripts/lib/frozenAuthorLibraries.ts']
  const release: FrozenAuthorManifest = { library, version, inputs: Object.fromEntries(inputs.map(file => [file, sha256(fs.readFileSync(path.join(root, file)))])), outputs: Object.fromEntries(Object.entries(outputs).map(([file, text]) => [file, sha256(text)])) }
  fs.mkdirSync(destination, { recursive: true })
  for (const [file, text] of Object.entries(outputs)) fs.writeFileSync(path.join(destination, file), text, { flag: 'wx' })
  fs.writeFileSync(path.join(destination, 'release.json'), JSON.stringify(release, null, 2) + '\n', { flag: 'wx' })
  console.log(`已冻结 ${library}@${version}，未安装依赖。`)
}
