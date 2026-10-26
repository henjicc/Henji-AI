/**
 * 把 gl-transitions 包里的 WGSL（naga 由 GLSL 译出，契约见包 README “WGSL and Metal contract”）改成剪辑转场管线可直接用的模块：
 *
 * - 包里的片元入口 `main` 改成普通函数 `henjiGlTransition(uv)`；
 * - 两段画面在剪辑里是预乘透明度的纹理，gl-transitions 读写直通色：取样后先还原直通色，输出再预乘；
 * - 追加全屏三角形顶点入口 `henjiVertex`（uv 左下角为原点，与 GLSL 规范一致）与片元入口 `henjiFragment`。
 *
 * 只做这几处文本替换，着色器主体保持上游原样；结构与预期不符时直接报错，不生成半成品。
 * 生成脚本与核验脚本共用本文件。
 */

const ENTRY = /@fragment\s*\nfn main\(@location\(0\) _uv: vec2<f32>\) -> @location\(0\) vec4<f32> \{/
const RESERVED = ['henjiGlTransition', 'henjiUnpremultiply', 'henjiVertex', 'henjiFragment', 'HenjiGlVertex']

/** 找到 `start`（左括号位置）对应的右括号位置。 */
function closing(source, start) {
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1
    else if (source[index] === ')') { depth -= 1; if (depth === 0) return index }
  }
  throw new Error('括号不配对')
}

/** 把对 `_from`、`_to` 的每次取样包进 `henjiUnpremultiply(...)`。 */
function wrapSamples(source, textures) {
  let result = ''; let cursor = 0; let count = 0
  const pattern = new RegExp(`textureSampleLevel\\((${textures.join('|')}),`, 'g')
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const open = match.index + 'textureSampleLevel'.length
    const end = closing(source, open)
    result += `${source.slice(cursor, match.index)}henjiUnpremultiply(${source.slice(match.index, end + 1)})`
    cursor = end + 1; count += 1; pattern.lastIndex = cursor
  }
  return { code: result + source.slice(cursor), count }
}

const APPENDIX = `
fn henjiUnpremultiply(c: vec4<f32>) -> vec4<f32> {
    if (c.a <= 0.0) { return vec4<f32>(0.0); }
    return vec4<f32>(c.rgb / c.a, c.a);
}
struct HenjiGlVertex {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}
@vertex
fn henjiVertex(@builtin(vertex_index) index: u32) -> HenjiGlVertex {
    let p = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u)) * 2.0 - 1.0;
    return HenjiGlVertex(vec4<f32>(p, 0.0, 1.0), 0.5 * (p + 1.0));
}
@fragment
fn henjiFragment(v: HenjiGlVertex) -> @location(0) vec4<f32> {
    let c = henjiGlTransition(v.uv);
    let a = clamp(c.a, 0.0, 1.0);
    return vec4<f32>(c.rgb * a, a);
}
`

/**
 * @param {string} name 转场名（报错用）
 * @param {string} source 包内 `wgsl/<name>.wgsl` 原文
 * @returns {string} 改好的 WGSL
 */
function adaptGlTransitionWgsl(name, source) {
  for (const word of RESERVED) if (source.includes(word)) throw new Error(`${name}：着色器里已有名字 ${word}`)
  if ((source.match(new RegExp(ENTRY.source, 'g')) ?? []).length !== 1) throw new Error(`${name}：没有找到唯一的片元入口 main`)
  const renamed = source.replace(ENTRY, 'fn henjiGlTransition(_uv: vec2<f32>) -> vec4<f32> {')
  const { code, count } = wrapSamples(renamed, ['_from', '_to'])
  if (count < 2) throw new Error(`${name}：没有找到两段画面的取样`)
  if (/texture(Sample|Load|Gather)\w*\((_from|_to)\b/.test(code.replace(/henjiUnpremultiply\(textureSampleLevel\((_from|_to),/g, ''))) throw new Error(`${name}：还有未处理的画面取样`)
  return `${code.replace(/\r\n/g, '\n').replace(/\n{2,}/g, '\n').trimEnd()}\n${APPENDIX}`
}

module.exports = { adaptGlTransitionWgsl }
