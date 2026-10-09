import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { generatePersistenceFixtures } from './generate-persistence-fixtures'
import { generateImagePersistencePackages } from './generate-persistence-packages'
import { IMAGE_PACKAGE_VERSION, IMAGE_WORKING_VERSION, CANVAS_LAYER_PACKAGE_VERSION } from '../src/core/persistence/schemaVersions'

// Only explicitly abandoned current development samples may be regenerated in place.
async function main(): Promise<void> {
  if (!process.argv.includes('--dev-break')) throw new Error('需要 --dev-break 明确更新开发期样本')
  const root = process.cwd()
  const fixtures = path.join(root, 'tests/fixtures/persistence')
  const baseline = JSON.parse(await fs.readFile(path.join(root, 'src/core/persistence/schemaBaseline.json'), 'utf8')) as {
    releasedCompatibility: boolean
    devBreaks: Array<{ format: string; version: number; reason: string }>
  }
  if (baseline.releasedCompatibility) throw new Error('正式发布样本不可覆盖')
  const formats = [
    ['image-working-copy', IMAGE_WORKING_VERSION],
    ['image-package', IMAGE_PACKAGE_VERSION],
    ['canvas-layer-package', CANVAS_LAYER_PACKAGE_VERSION],
  ] as const
  for (const [id, version] of formats) {
    if (!baseline.devBreaks.some(item => item.format === id && item.version === version && item.reason.trim())) {
      throw new Error(`当前开发期样本尚未登记 dev-break：${id}`)
    }
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-image-goldens-'))
  try {
    for (const [id, version] of formats) {
      generatePersistenceFixtures(temporary, id)
      const file = `v${version}.json`
      await fs.copyFile(path.join(temporary, 'tests/fixtures/persistence', id, file), path.join(fixtures, id, file))
    }
    // Exclusive archive publication preserves historical and already authored ZIP goldens.
    await generateImagePersistencePackages(root)
  } finally { await fs.rm(temporary, { recursive: true, force: true }) }

  process.exit(0) // Host caches outlive the explicit authoring command.
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
