import * as hb from '../resources/video-edit-author/vendor/harfbuzzjs/1.6.4/index.mjs'
import { TextShaper } from '../src/core/imaging/vectorContent/shaping/harfbuzz'
import { TextFontSession } from '../src/core/imaging/vectorContent/shaping/fontPolicy'
import { withTextFontSession } from '../src/core/imaging/vectorContent/shaping/fontContext'
import { layoutText, drawText } from '../src/features/videoEdit/authorLibraries/text'

export async function fontFormatsExperiment() {
  const sources: Array<{ id: string; file: string; hash: string; text: string; tables: string[]; url: string; expectedAdvances?: number[] }> = await (await fetch('format-fonts.json')).json()
  const rows = [], captures = [], failures: string[] = [], shaper = new TextShaper(hb)
  try {
    for (const source of sources) {
      const bytes = await (await fetch(source.file)).arrayBuffer(), blob = new hb.Blob(bytes), face = new hb.Face(blob, 0), font = new hb.Font(face)
      const session = new TextFontSession('win32', async request => ['sans-serif', source.id].includes(request.family) ? { bytes } : undefined)
      try {
        const tables = Object.fromEntries(source.tables.map(table => [table, face.referenceTable(table)?.byteLength ?? 0]))
        if (Object.values(tables).some(size => !size)) throw new Error(`${source.id} 缺少目标字体表`)
        const shaped = shaper.shape({ hash: source.hash, bytes }, source.text, { size: face.upem, ligatures: true })
        const advances = shaped.glyphs.map(g => g.advance)
        const outlines = shaped.glyphs.map(g => font.glyphToPath(g.id).length)
        const matchesUpstream = source.expectedAdvances ? JSON.stringify(advances) === JSON.stringify(source.expectedAdvances) : undefined
        await session.prepare({ faces: [{ family: 'sans-serif' }, { family: source.id }], text: [source.text] })
        const plan = withTextFontSession(session, () => layoutText(source.text, { fontFamily: source.id, fontSize: 64 }, { autospace: false, ligatures: true }))
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 160
        const ctx = canvas.getContext('2d')!; drawText(ctx as unknown as OffscreenCanvasRenderingContext2D, plan)
        const ink = ctx.getImageData(0, 0, 640, 160).data.reduce((sum, value, index) => sum + Number(index % 4 === 3 && value > 0), 0)
        if (!ink && !source.expectedAdvances) failures.push(`${source.id}: 彩色字体回退未产生墨迹`)
        captures.push({ name: `format-${source.id}`, dataUrl: canvas.toDataURL() })
        rows.push({ ...source, hb: hb.versionString(), tables, advances, outlines, matchesUpstream, ink, diagnostics: plan.diagnostics,
          support: source.expectedAdvances ? matchesUpstream ? '与上游 AAT 用例匹配' : '此精简构建未实现该 AAT 行为，记录为不支持' : outlines.every(length => length === 0) ? '无轮廓，使用系统 emoji Canvas 绘制；不保证自定义彩色字体像素' : '存在轮廓；颜色不由轮廓路径保证' })
      } finally { session.close(); font.dispose(); face.dispose(); blob.dispose() }
    }
    return { rows, captures, failures }
  } finally { shaper.dispose() }
}
