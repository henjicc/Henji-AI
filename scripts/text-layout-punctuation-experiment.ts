import { layoutText, drawText } from '../src/features/videoEdit/authorLibraries/text'
import { TextFontSession } from '../src/core/imaging/vectorContent/shaping/fontSession'
import { withTextFontSession } from '../src/core/imaging/vectorContent/shaping/fontContext'
import { TextShaper } from '../src/core/imaging/vectorContent/shaping/harfbuzz'
import * as hb from '../resources/video-edit-author/vendor/harfbuzzjs/1.6.4/index.mjs'

export async function punctuationExperiment(session: TextFontSession, fontStack: (family: string) => string): Promise<unknown> {
  const families = ['TicketCJK', 'Noto Sans SC', 'Noto Sans JP']
  await session.prepare({ faces: families.map(family => ({ family })) })
  const cases = [], shaper = new TextShaper(hb)
  const texts = ['「文」', '『文』', '（文）', '《文》', '【文】', '“文”', '文。（「文」）。']
  const stage = document.createElement('div')
  Object.assign(stage.style, { position: 'absolute', left: '0', top: '0', background: 'white' })
  document.body.append(stage)
  for (const family of families) for (const text of texts) for (const scale of [1, 4]) {
    const size = 32, padding = 12, width = Math.ceil((text.length * size + 2 * padding) * scale), height = 80 * scale
    const plan = withTextFontSession(session, () => layoutText(text, { fontFamily: family, fontSize: size, align: 'left', fill: { color: '#000000' } }, { autospace: false, anchor: { x: 0, y: 0, horizontal: 0, vertical: 0 } }))
    const dom = document.createElement('div'), node = document.createTextNode(text), marker = document.createElement('span')
    Object.assign(dom.style, { position: 'absolute', left: `${padding * scale}px`, top: `${padding * scale}px`, font: `${size * scale}px ${fontStack(family)}`, lineHeight: '1.25', whiteSpace: 'pre', fontKerning: 'normal', fontSynthesis: 'none', fontFeatureSettings: '"liga" 0, "clig" 0', textAutospace: 'no-autospace', textSpacingTrim: 'normal' })
    Object.assign(marker.style, { display: 'inline-block', width: '0', height: '0' })
    dom.append(node, marker); stage.replaceChildren(dom)
    const baseline = marker.getBoundingClientRect().top / scale
    const positions = [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(text)].map(segment => {
      const range = document.createRange(); range.setStart(node, segment.index); range.setEnd(node, segment.index + segment.segment.length)
      const rect = range.getBoundingClientRect(), glyph = plan.graphemes.find(g => g.source.start === segment.index)!
      return { text: segment.segment, domX: rect.left / scale - padding, hbX: glyph.x, domWidth: rect.width / scale, hbWidth: glyph.advance }
    })
    const canvas = document.createElement('canvas'); canvas.width = width * devicePixelRatio; canvas.height = height * devicePixelRatio
    Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', width: `${width}px`, height: `${height}px` })
    const ctx = canvas.getContext('2d')!; ctx.scale(scale * devicePixelRatio, scale * devicePixelRatio); ctx.translate(padding, baseline - plan.lines[0].baseline); drawText(ctx, plan)
    const resting = document.createElement('canvas'); resting.width = canvas.width; resting.height = canvas.height
    const restingContext = resting.getContext('2d')!; restingContext.scale(scale * devicePixelRatio, scale * devicePixelRatio); restingContext.translate(padding, baseline - plan.lines[0].baseline); drawText(restingContext, plan, { graphemes: () => ({}) })
    const staticPixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const restingPixels = restingContext.getImageData(0, 0, canvas.width, canvas.height).data
    const font = session.chain({ family }).candidates.find(candidate => candidate.font)?.font
    const variants = font ? Object.fromEntries([['none', { halt: 0, chws: 0 }], ['halt', { halt: 1, chws: 0 }], ['chws', { halt: 0, chws: 1 }]].map(([name, features]) => [name, shaper.shape(font, text, { size, script: 'Hani', language: 'zh-CN', features: features as Record<string, number> })])) : null
    cases.push({ family, text, scale, width, height, baseline, positions, variants, restingDifferentChannels: staticPixels.reduce((sum, value, index) => sum + Number(value !== restingPixels[index]), 0), dom, canvas })
  }
  shaper.dispose(); stage.replaceChildren()
  const browser = globalThis as typeof globalThis & { renderTextPunctuation?: (index: number, mode: string) => void }
  browser.renderTextPunctuation = (index, mode) => {
    const item = cases[index]; stage.style.width = `${item.width}px`; stage.style.height = `${item.height}px`
    stage.replaceChildren(...(mode === 'dom' ? [item.dom] : mode === 'hb' ? [item.canvas] : [item.dom, item.canvas]))
    item.dom.style.color = mode === 'overlay' ? 'red' : 'black'; item.canvas.style.opacity = mode === 'overlay' ? '.5' : '1'
  }
  return { cases: cases.map(({ dom: _dom, canvas: _canvas, ...item }) => item) }
}
