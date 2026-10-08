import fs from 'node:fs/promises'
import path from 'node:path'
import { createImageEditAdjustmentLayerV3 } from '../src/core/imageEdit/v3/documentFactory'
import { HenjiImagePackageCodec } from '../electron/main/services/image-editor-v3/package-codec'
import { ContentAddressedResourceStore } from '../electron/main/services/image-editor-v3/resource-store'
import { validateImageEditDocumentEnvelope } from '../electron/main/services/image-editor-v3/document-repository'

// Only explicitly abandoned development samples may be regenerated in place.
if (!process.argv.includes('--dev-break')) throw new Error('需要 --dev-break 明确更新开发期样本')
const root = process.cwd()
const fixtures = path.join(root, 'tests/fixtures/persistence')
const baseline = JSON.parse(await fs.readFile(path.join(root, 'src/core/persistence/schemaBaseline.json'), 'utf8')) as { releasedCompatibility: boolean }
if (baseline.releasedCompatibility) throw new Error('正式发布样本不可覆盖')
const workingPath = path.join(fixtures, 'image-working-copy/v3.json')
const envelope = validateImageEditDocumentEnvelope(JSON.parse(await fs.readFile(workingPath, 'utf8')))
envelope.document.layers = envelope.document.layers.filter(layer => layer.id !== 'golden-shared-grade')
envelope.document.layers.push(createImageEditAdjustmentLayerV3('golden-shared-grade', '共享调整', 'color_grade', {
  exposure: .25, curve_red_points: [{ x: 0, y: 0 }, { x: 50, y: 60 }, { x: 100, y: 100 }], shadow_hue: 230, shadow_strength: 12, hsl_saturation: -15,
}))
await fs.writeFile(workingPath, `${JSON.stringify(validateImageEditDocumentEnvelope(envelope), null, 2)}\n`)
const temporary = await fs.mkdtemp(path.join(root, '.tmp-ie1-golden-'))
try {
  const codec = new HenjiImagePackageCodec(new ContentAddressedResourceStore(temporary))
  const header = await fs.readFile(path.join(fixtures, 'image-header/v1.json'), 'utf8')
  const manifest = await codec.export({ targetPath: path.join(fixtures, 'image-package/v1.henjiimg'), document: envelope, documentHeader: header, now: new Date('2026-10-09T00:00:00.000Z') })
  await fs.writeFile(path.join(fixtures, 'image-package/v1.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await codec.export({ targetPath: path.join(fixtures, 'canvas-layer-package/v1.henjilayer'), document: envelope, documentHeader: await fs.readFile(path.join(fixtures, 'canvas-layer-package/v1.json'), 'utf8'), now: new Date('2026-10-09T00:00:00.000Z') })
} finally { await fs.rm(temporary, { recursive: true, force: true }) }

process.exit(0) // vite-node imports host caches; the explicit authoring command must terminate.
