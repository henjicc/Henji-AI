/**
 * 显式发行：node scripts/freeze-layout-library.ts <新版本号>。
 * 仅创建尚不存在的版本目录；日常构建调用 build-author-libraries.ts，只复制并核对冻结产物。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild-wasm'
import ts from 'typescript'
import { generateDtsBundle } from 'dts-bundle-generator'
import { AUTHOR_LIBRARIES } from '../src/core/videoEdit/codeMaterial/authorLibraries.ts'
import { assertNewFrozenAuthorRelease, sha256, type FrozenAuthorManifest } from './lib/frozenAuthorLibraries.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const version = process.argv[2]
const release = AUTHOR_LIBRARIES['henji-layout'][version]
if (process.argv.length !== 3 || !release?.frozen) throw new Error('请先登记 henji-layout 的新版本，再传入该版本号。')
const destination = path.resolve(root, release.frozen)
assertNewFrozenAuthorRelease(root, release.frozen)
const entryRoot = 'src/features/videoEdit/authorLibraries'
const entries = ['text', 'flex'].map(name => `${entryRoot}/${name}.ts`)
const inputs: Record<string, string> = {}
const outputs: Record<string, string> = {}
const files: Record<string, string> = {}
const config = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, esModuleInterop: true, baseUrl: root, paths: { '@/*': ['src/*'] }, types: [], lib: ['lib.esnext.d.ts', 'lib.webworker.d.ts'], declaration: true }
const program = ts.createProgram(entries.map(entry => path.join(root, entry)), config)
const checker = program.getTypeChecker()
const styleFile = program.getSourceFile(path.join(root, 'src/core/imaging/vectorContent/text.ts'))!
const textFile = program.getSourceFile(path.join(root, entries[0]))!
const resolveAlias = (source: ts.SourceFile, name: string): string => {
  const node = source.statements.find((statement): statement is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(statement) && statement.name.text === name)!
  return checker.typeToString(checker.getTypeAtLocation(node), node, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias)
}
const aliases = { TextStyle: resolveAlias(styleFile, 'TextStyle'), TextStyleInput: resolveAlias(textFile, 'TextStyleInput') }
// 声明由 TypeScript 与既有权威类型生成；Zod 只用于构建期推导，不要求作者安装应用内部依赖。
const configFile = path.join(root, '.tmp', `layout-types-${process.pid}.json`)
fs.mkdirSync(path.dirname(configFile), { recursive: true })
fs.writeFileSync(configFile, JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, skipLibCheck: true, esModuleInterop: true, baseUrl: root, paths: { '@/*': ['src/*'] }, types: [], lib: ['ESNext', 'WebWorker'] }, files: entries.map(entry => path.join(root, entry)) }))
let declarations: string[]
try { declarations = generateDtsBundle(entries.map(filePath => ({ filePath: path.join(root, filePath), output: { noBanner: true, exportReferencedTypes: false }, libraries: { allowedTypesLibraries: [] } })), { preferredConfigPath: configFile }) }
finally { fs.unlinkSync(configFile) }
for (const [index, declaration] of declarations.entries()) {
  const ast = ts.createSourceFile('types.d.ts', declaration, ts.ScriptTarget.Latest, true)
  let text = declaration
  for (const node of [...ast.statements].reverse()) {
    let replacement: string | undefined
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'zod') replacement = ''
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => ['textStyleSchema', 'ready'].includes(item.name.getText(ast)))) replacement = ''
    if (ts.isTypeAliasDeclaration(node) && Object.hasOwn(aliases, node.name.text)) replacement = `${node.modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword) ? 'export ' : ''}type ${node.name.text} = ${aliases[node.name.text as keyof typeof aliases]};`
    if (replacement !== undefined) text = text.slice(0, node.getStart(ast)) + replacement + text.slice(node.end)
  }
  if (/\bimport\b|\bz\.(?:infer|input|Zod)/.test(text)) throw new Error('作者声明仍依赖未发行的类型模块。')
  files[index ? 'flex.d.ts' : 'text.d.ts'] = text
}
files['package.json'] = JSON.stringify({ name: 'henji-layout', version, exports: { './text': { types: './text.d.ts' }, './flex': { types: './flex.d.ts' } } })
outputs['types.json'] = JSON.stringify({ mount: 'henji-layout', modules: ['text.mjs', 'flex.mjs'], files })
const bundled = await esbuild.build({ absWorkingDir: root, entryPoints: { text: entries[0], 'flex-runtime': entries[1] }, bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2020', outdir: destination, outExtension: { '.js': '.mjs' }, write: false, metafile: true, minify: true, legalComments: 'inline' })
for (const file of bundled.outputFiles) outputs[path.relative(destination, file.path).split(path.sep).join('/')] = file.text
// 顶层 await 只在独立 ESM 发行外壳执行，ES2020 bundle 使用 /load 显式初始化，不打包 Yoga 默认入口。
outputs['flex.mjs'] = "import { ready, layoutBoxes } from './flex-runtime.mjs';\nawait ready;\nexport { layoutBoxes };\n"
outputs.LICENSE = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8')
outputs['NOTICE.txt'] = `Yoga 3.2.1 (MIT)\n${fs.readFileSync(path.join(root, 'scripts/third-party-licenses/author-libs/yoga-MIT.txt'), 'utf8')}\nZod\n${fs.readFileSync(path.join(root, 'node_modules/zod/LICENSE'), 'utf8')}`
for (const file of [...Object.keys(bundled.metafile.inputs), ...program.getSourceFiles().filter(file => !file.isDeclarationFile).map(file => path.relative(root, file.fileName).split(path.sep).join('/')), 'scripts/freeze-layout-library.ts', 'package-lock.json']) inputs[file] = sha256(fs.readFileSync(path.resolve(root, file)))
const manifest: FrozenAuthorManifest = { library: 'henji-layout', version, inputs, outputs: Object.fromEntries(Object.entries(outputs).map(([file, text]) => [file, sha256(text)])) }
fs.mkdirSync(destination, { recursive: true })
for (const [file, text] of Object.entries(outputs)) fs.writeFileSync(path.join(destination, file), text, { flag: 'wx' })
fs.writeFileSync(path.join(destination, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
process.stdout.write(`已冻结 henji-layout@${version}：${Object.keys(outputs).length} 个产物。\n`)
