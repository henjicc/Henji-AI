const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const root = path.resolve(__dirname, '..'), source = path.join(root, '.tmp/text-layout-sources')
const read = name => fs.readFileSync(path.join(source, name), 'utf8')
const ndjson = name => read(name + '.ndjson').split('\n').filter(Boolean).map(JSON.parse)
const smoke = ndjson('smoke'), facts = ndjson('facts'), rich = ndjson('rich'), reports = ndjson('reports')
const cases = [], counts = {}
function add(group, text, width, size, origin, runs, extra = {}) {
  counts[group] = (counts[group] ?? 0) + 1
  cases.push({ id: group + String(counts[group]).padStart(3, '0'), text, width, size, language: 'zh-CN', font: /[\u3000-\uffff]/u.test(text) ? 'TicketCJK' : 'TicketLatin', runs, origin, ...extra })
}
const repo = 'resources/assistant-skills/video-edit-code-creation/references/'
const titles = [
 ['痕迹AI', repo + 'author-text-motion.md:16'], ['逐字入场', repo + 'author-text-motion.md:59'], ['让灵感浮出画面', repo + 'recipes-text.md:27'], ['输入一个好想法', repo + 'recipes-text-data.md:19'], ['指标', repo + 'recipes-text-data.md:62'], ['0', repo + 'recipes-text-data.md:63'], ['%', repo + 'recipes-text-data.md:64'],
 ['HMMH', 'src/features/videoEdit/authorLibraries/textPixels.test.ts:35'], ['fW', 'src/features/videoEdit/authorLibraries/textPixels.test.ts:82'], ['信息越多，越难判断\nAI 帮你做减法 2026', 'src/features/videoEdit/authorLibraries/textPixels.test.ts:112']]
for (const [text, file] of titles) for (const width of [400, 95.984375]) add('R', text, width, 32, { file, license: 'project' })
const used = new Set(), bidi = []
const hasBidi = c => /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(c.paragraph.runs.map(r => r.text).join(''))
function upstream(c) {
  if (!c || used.has(c.id)) return false
  if (hasBidi(c)) { if (!bidi.some(v => v.id === c.id)) bidi.push(c); return false }
  used.add(c.id)
  const p = c.paragraph, text = p.runs.map(r => r.text).join('')
  add('P', text, p.width, p.font.size, { url: 'https://github.com/chenglou/pretext/tree/v1.0.0/harness', caseId: c.id, original: c.origin, family: c.family, license: 'MIT', variation: '统一 pre-wrap / normal / break-word；同字节本机字体；移除盒装饰（如有），保留文本/run/字号/间距/宽度' }, p.runs.map(r => ({ text: r.text, size: r.font.size, weight: r.font.weight, spacing: r.letterSpacing ?? 0 })), { language: p.lang ?? c.pageLang ?? 'zh-CN', font: /[\u3000-\uffff]/u.test(text) ? 'TicketCJK' : 'TicketLatin' })
  return true
}
function take(list, n) { let count = 0; for (const c of list) if (upstream(c) && ++count === n) return; if (count !== n) throw new Error('上游样本不足') }
take([...smoke.filter(c => c.family.includes('cjk-zh')), ...facts.filter(c => /CJK|punctuation|Han|ideograph/i.test(c.origin) && /[\u4e00-\u9fff]/u.test(c.paragraph.runs.map(r => r.text).join('')))], 10)
const accepted = ['report-23cd6052bc54f415', 'report-953b7e9cd05588ed', 'report-b980d5159851daba']
take(accepted.map(id => reports.find(c => c.id === id)), 3)
take([...smoke.filter(c => /soft-hyphen|tab|space/.test(c.family)), ...rich.filter(c => /pre-wrap\/tabs|soft-hyphen-return/.test(c.family))], 7)
take(facts.filter(c => /kern|ligatur/i.test(c.origin) && /^[\x00-\x7f\u00ad]+$/.test(c.paragraph.runs.map(r => r.text).join(''))), 10)
take(smoke.filter(c => /real\/ja-/.test(c.family)), 5)
take(rich.filter(c => c.family.startsWith('rich/runs') && c.paragraph.runs.length > 1), 5)
function unicode(file, n, predicate) {
  const lines = read(file).split('\n'); let count = 0
  for (let i = 0; i < lines.length && count < n; i++) {
    const code = lines[i].split('#')[0].trim(); if (!code || !predicate(lines[i], code)) continue
    const values = code.split(/\s+/).filter(v => /^[0-9a-f]{4,6}$/i.test(v)).map(v => parseInt(v, 16))
    if (!values.length) continue
    add('U', '前' + String.fromCodePoint(...values) + '后结束', 80 + count * 5 / 64, 28, { url: 'https://www.unicode.org/Public/17.0.0/ucd/auxiliary/' + file, line: i + 1, rule: code, license: 'Unicode-3.0' })
    count++
  }
  if (count !== n) throw new Error('Unicode 样本不足')
}
unicode('LineBreakTest.txt', 10, (_, code) => !/000[A-D]|0085|2028|2029/.test(code))
unicode('GraphemeBreakTest.txt', 8, line => /1F[0-9A-F]{3}|200D|FE0F|E0100|20000/.test(line))
unicode('GraphemeBreakTest.txt', 2, line => /0308|0301/.test(line))
// 首轮 Unicode 抽样只命中控制符邻接；原样保留为附加回归，并按类别补齐主集合。
const unicodeCompatibility = cases.splice(70, 10).map(c => ({ ...c, id: 'control-' + c.id }))
counts.U = 10
const graphemeLines = read('GraphemeBreakTest.txt').split('\n')
for (const line of [750, 756, 758, 760, 762, 765, 767, 768, 769, 770]) {
 const rule = graphemeLines[line - 1].split('#')[0].trim()
 const text = rule.split(/\s+/).filter(v => /^[0-9a-f]{4,6}$/i.test(v)).map(v => String.fromCodePoint(parseInt(v, 16))).join('')
 const prefix = line === 769 ? '前☺️' : line === 770 ? '前𠀀' : '前'
 add('U', prefix + text + '后结束', 96 + counts.U / 64, 28, { url: 'https://www.unicode.org/Public/17.0.0/ucd/auxiliary/GraphemeBreakTest.txt', line, rule, wrapper: prefix, license: 'Unicode-3.0' })
}
let seed = 10102026
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
for (let family = 0; family < 8; family++) for (let i = 0; i < 15; i++) {
 const n = 20 + i, size = [20, 28, 36][i % 3]
 const text = [
  `文字AI${n}进入画面Hello未来`, `文字 AI ${n} 进入画面 Hello 未来`, `他说：“你好（世界${n}）！”下一句。`, `开始了吗？！当然……继续，结束。${n}`, `增长-${n}.25% 温度${n}℃ 距离${n}km`, `访问https://example.com/typography/${n}AVATAR然后继续`, `第一行${n}\n第二行\n窄列结束`, `标题${n}小字office与粗体AV继续`][family]
 const width = family === 6 && i < 5 ? 16 + i * 2 : size * (3 + i % 6) + Math.floor(random() * 3 - 1) / 64
 const runs = family === 7 ? [{ text: text.slice(0, 4), size, weight: 700, spacing: 0 }, { text: text.slice(4, 11), size: size * .75, weight: 400, spacing: 0 }, { text: text.slice(11), size: size * 1.2, weight: 700, spacing: 0 }] : undefined
 add('H', text, width, size, { generator: '8 families × 15', family, index: i, seed: 10102026, license: 'project' }, runs)
}
if (cases.length !== 200) throw new Error('固定分组数量不正确')
const config = { schema: 1, seed: 10102026, css: { whiteSpace: 'pre-wrap', wordBreak: 'normal', lineBreak: 'auto', overflowWrap: 'break-word', textAutospace: 'no-autospace', textSpacingTrim: 'normal', fontVariantLigatures: 'no-common-ligatures' }, sources: ['smoke.ndjson','rich.ndjson','facts.ndjson','reports.ndjson','LineBreakTest.txt','GraphemeBreakTest.txt'].map(file => ({ file, sha256: crypto.createHash('sha256').update(read(file)).digest('hex') })), cases, unicodeCompatibility, bidiCompatibility: bidi.map(c => ({ id: c.id, origin: c.origin, paragraph: c.paragraph })), selectionCorrection: '首轮误把混合 bidi 放进200分母；现按设计移至独立兼容组，原数据保留在首次报告，不按成功/失败筛选。' }
const out = path.join(root, 'scripts/fixtures/text-layout-cases.json')
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(config, null, 2) + '\n')
console.log(counts, crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex'))
