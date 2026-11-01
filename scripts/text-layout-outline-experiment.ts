import * as THREE from 'three'
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js'
import * as hb from '../resources/video-edit-author/vendor/harfbuzzjs/1.6.4/index.mjs'
import { TextShaper } from '../src/core/imaging/vectorContent/shaping/harfbuzz'
import { TextFontSession } from '../src/core/imaging/vectorContent/shaping/fontPolicy'
import { createShapedTextPlan } from '../src/core/imaging/vectorContent/shaping/textPlan'
import { textStyleSchema } from '../src/core/imaging/vectorContent/text'

const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return { p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) }
}
async function run(): Promise<unknown> {
  const fonts: Array<{ family: string; file: string; weight: number; hash: string }> = await (await fetch('fonts.json')).json()
  const session = new TextFontSession('win32', async request => {
    const family = request.family === 'sans-serif' ? 'Arial' : request.family
    const font = fonts.find(font => font.family === family && font.weight === (request.weight ?? 400)) ?? fonts.find(font => font.family === family)
    return font && { bytes: await (await fetch(font.file)).arrayBuffer() }
  })
  const family = 'Noto Sans SC', weight = fonts.find(font => font.family === family)!.weight
  await session.prepare({ faces: [{ family: 'sans-serif' }, { family, weight }], text: ['OB8国文字排版'] })
  const shaper = new TextShaper(hb), rows = [], captures = [], failures: string[] = []
  const width = 1920, height = 1080
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(width, height); renderer.setClearColor(0x000000, 1)
  const gl = renderer.getContext(), loader = new SVGLoader()
  const capture = (canvas: HTMLCanvasElement, name: string) => {
    const copy = document.createElement('canvas'); copy.width = width; copy.height = height
    const ctx = copy.getContext('2d')!; ctx.drawImage(canvas, 0, 0)
    const data = ctx.getImageData(0, 0, width, height).data
    const ink = data.reduce((sum, value, index) => sum + Number(index % 4 !== 3 && value > 0), 0)
    captures.push({ name, dataUrl: copy.toDataURL() })
    return { ink, data }
  }
  try {
    for (const count of [20, 200]) {
      const text = 'OB8国文字排版'.repeat(Math.ceil(count / 8)).slice(0, count)
      const start = performance.now()
      const plan = createShapedTextPlan(shaper, session, text, textStyleSchema.parse({ fontFamily: family, fontWeight: weight, fontSize: 48, align: 'left' }), { wrapWidth: 1800, autospace: false, anchor: { x: 40, y: 40, horizontal: 0, vertical: 0 } })
      const layoutMs = performance.now() - start
      const cache = new Map<string, { path: Path2D; length: number; geometry: THREE.ExtrudeGeometry; shapes: number; holes: number }>()
      const scene = new THREE.Scene(), material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
      const camera = new THREE.OrthographicCamera(0, width, 0, height, .1, 2000); camera.position.z = 1000
      const geometryStart = performance.now()
      const placed = plan.clusters.flatMap(cluster => cluster.glyphs.map(glyph => {
        let entry = cache.get(glyph.outline.identity)
        if (!entry) {
          const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${glyph.outline.svg}"/></svg>`
          const parsed = loader.parse(svg), shapes = parsed.paths.flatMap(path => SVGLoader.createShapes(path))
          const element = new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('path')!
          const geometry = new THREE.ExtrudeGeometry(shapes, { depth: 80, bevelEnabled: false, curveSegments: 12 })
          entry = { path: new Path2D(glyph.outline.svg), length: element.getTotalLength(), geometry, shapes: shapes.length, holes: shapes.reduce((sum, shape) => sum + shape.holes.length, 0) }
          cache.set(glyph.outline.identity, entry)
        }
        const mesh = new THREE.Mesh(entry.geometry, material)
        mesh.position.set(cluster.x + glyph.x, cluster.baseline + glyph.y, 0); mesh.scale.set(glyph.scale, -glyph.scale, glyph.scale); scene.add(mesh)
        return { entry, x: mesh.position.x, y: mesh.position.y, scale: glyph.scale }
      }))
      const geometryMs = performance.now() - geometryStart
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
      const ctx = canvas.getContext('2d')!
      const stroke = (progress: number) => {
        ctx.clearRect(0, 0, width, height); ctx.strokeStyle = '#ffffff'
        for (const glyph of placed) {
          ctx.save(); ctx.translate(glyph.x, glyph.y); ctx.scale(glyph.scale, -glyph.scale)
          ctx.lineWidth = 1.5 / glyph.scale; ctx.setLineDash([glyph.entry.length, glyph.entry.length]); ctx.lineDashOffset = glyph.entry.length * (1 - progress)
          ctx.stroke(glyph.entry.path); ctx.restore()
        }
      }
      const strokeTimes = [], renderTimes = []
      const firstStart = performance.now(); renderer.render(scene, camera); gl.finish(); const firstRenderMs = performance.now() - firstStart
      const front = capture(renderer.domElement, `outline-${count}-extrude-front`)
      ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#ffffff'
      for (const glyph of placed) { ctx.save(); ctx.translate(glyph.x, glyph.y); ctx.scale(glyph.scale, -glyph.scale); ctx.fill(glyph.entry.path); ctx.restore() }
      const flat = capture(canvas, `outline-${count}-path-fill`)
      // 只比较离轮廓边缘至少两像素的内外区域，三角化洞填错仍会被检出，AA 边缘单列。
      let interiorMismatch = 0
      for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
        const at = (y * width + x) * 4, expected = flat.data[at] > 127
        if (front.data[at] > 127 === expected) continue
        let interior = true
        for (let dy = -2; dy <= 2 && interior; dy++) for (let dx = -2; dx <= 2; dx++) if ((flat.data[((y + dy) * width + x + dx) * 4] > 127) !== expected) { interior = false; break }
        if (interior) interiorMismatch++
      }
      const revealInk = []
      for (const progress of [.25, .5, 1]) { stroke(progress); revealInk.push(capture(canvas, `outline-${count}-stroke-${progress}`).ink) }
      const geometriesBefore = renderer.info.memory.geometries
      for (let index = 0; index < 35; index++) {
        const begin = performance.now(); stroke((index + 1) / 35); const strokeMs = performance.now() - begin
        const renderStart = performance.now(); renderer.render(scene, camera); gl.finish(); const renderMs = performance.now() - renderStart
        if (index >= 5) { strokeTimes.push(strokeMs); renderTimes.push(renderMs) }
      }
      const geometriesAfter = renderer.info.memory.geometries
      const bytes = [...cache.values()].reduce((sum, entry) => sum + Object.values(entry.geometry.attributes).reduce((n, attribute) => n + attribute.array.byteLength, 0), 0)
      const finite = [...cache.values()].every(entry => [...entry.geometry.getAttribute('position').array].every(Number.isFinite))
      const holes = [...cache.values()].map(entry => entry.holes)
      rows.push({ count, layoutMs, geometryMs, firstRenderMs, stroke: stats(strokeTimes), render: stats(renderTimes), cachedGlyphs: cache.size, geometriesBefore, geometriesAfter, geometryBytes: bytes, holes, finite, interiorMismatch, frontInk: front.ink, revealInk })
      if (!front.ink || !finite || interiorMismatch || !holes.some(n => n >= 2) || geometriesBefore !== geometriesAfter || revealInk.some(n => !n) || revealInk[2] <= revealInk[0]) failures.push(`${count}字：轮廓/洞/揭示或缓存检查失败`)
      for (const entry of cache.values()) entry.geometry.dispose()
      material.dispose()
      if (failures.length) break
    }
    return { cases: [], experiment6: { rows, warmup: 5, samples: 30, renderer: renderer.info.render, pipeline: '独立 Electron 正式 HB 轮廓 + 已内置 three SVGLoader/ExtrudeGeometry；CPU提交与 gl.finish 分开；不代表完整播放器帧率' }, captures, gate: { passed: !failures.length, failures } }
  } finally { renderer.dispose(); shaper.dispose(); session.close() }
}
run().then(result => { Object.assign(globalThis, { textLayoutExperimentResult: result }) }).catch(error => { Object.assign(globalThis, { textLayoutExperimentResult: { cases: [], fatal: String(error) } }) })
