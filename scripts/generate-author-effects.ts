import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParam } from '../src/core/videoEdit/builtinEffects.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { loadTypeScript } = require('./check-persistence-compat.cjs') as { loadTypeScript(file: string): { VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS: readonly VideoEditBuiltinEffectDefinition[] } }
const definitions = loadTypeScript('src/core/videoEdit/builtinEffects.ts').VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.filter(value => value.space === 'layer' && value.author)
const retiredBlurIds = Object.keys((loadTypeScript('src/core/videoEdit/blur.ts') as unknown as { RETIRED_BLUR_EFFECTS: Record<string, unknown> }).RETIRED_BLUR_EFFECTS)
const banner = '// 由 scripts/generate-author-effects.ts 生成，请修改效果登记后重新生成。\n'
const typeName = (id: string): string => id.split('_').map(part => part[0].toUpperCase() + part.slice(1)).join('') + 'Params'
function parameter(param: VideoEditBuiltinParam): string {
  const type = param.type === 'number' ? 'number' : param.type === 'boolean' ? 'boolean' : param.type === 'enum' ? param.options.map(option => JSON.stringify(option.value)).join(' | ') : 'string'
  const doc = [param.name, param.description, `默认 ${JSON.stringify(param.default)}`, param.type === 'number' ? `${param.softMin !== undefined || param.softMax !== undefined ? `常用 ${param.softMin ?? param.min}–${param.softMax ?? param.max}；` : ''}硬范围 ${param.min}–${param.max}；单位 ${param.unit}` : '', param.group ? `分组 ${param.group}` : '', param.visibleWhen ? `显隐 ${JSON.stringify(param.visibleWhen)}` : '', `可动画 ${param.animatable !== false}`].filter(Boolean).join('；').replaceAll('*/', '* /')
  return `  /** ${doc} */\n  readonly ${param.key}?: ${type}\n`
}
export function generateAuthorEffects(): Record<string, string> {
  const params = definitions.map(definition => `export interface ${typeName(definition.id)} {\n${definition.params.map(parameter).join('')}}\n`).join('\n')
  const union = `export type BuiltinLayerEffectDescriptor =\n${definitions.map(definition => `  | { readonly id: '${definition.id}'; readonly params?: ${typeName(definition.id)} }`).join('\n')}\nexport interface LookDescriptor { readonly id: 'look'; readonly params: { readonly name: string } }\n/** 旧版 henji-effects（1.0.0）的 blur() 产出并进“模糊”前的 ID，宿主按同一换算转成 blur；新代码直接写 blur。 */\nexport interface RetiredBlurDescriptor { readonly id: ${retiredBlurIds.map(id => `'${id}'`).join(' | ')}; readonly params?: object }\nexport type EffectDescriptor = BuiltinLayerEffectDescriptor | LookDescriptor | RetiredBlurDescriptor\n`
  const declarations = definitions.map(definition => `export declare function ${definition.author!.factory}(params?: ${typeName(definition.id)}): { readonly id: '${definition.id}'; readonly params: ${typeName(definition.id)} }\n`).join('')
  const factories = definitions.map(definition => `export function ${definition.author!.factory}(params: ${typeName(definition.id)} = {}): { readonly id: '${definition.id}'; readonly params: ${typeName(definition.id)} } { return { id: '${definition.id}', params } }\n`).join('')
  const types = banner + params + union
  return {
    'src/core/videoEdit/authorEffects.generated.ts': types,
    'resources/video-edit-author/author-effects.d.ts': types,
    'resources/video-edit-author/effects-library.d.ts': types + declarations + 'export declare function look(name: string, knobs?: Readonly<Record<string, never>>): LookDescriptor\n',
    'src/features/videoEdit/authorLibraries/effects.generated.ts': banner + `import type { ${definitions.map(definition => typeName(definition.id)).join(', ')} } from '@/core/videoEdit/authorEffects.generated'\n` + factories,
  }
}
for (const [file, text] of Object.entries(generateAuthorEffects())) {
  const target = path.join(root, file)
  if (process.argv.includes('--check')) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== text) throw new Error(`效果生成产物过期：${file}`) }
  else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text) }
}
console.log(`作者效果生成${process.argv.includes('--check') ? '检查通过' : '完成'}。`)
