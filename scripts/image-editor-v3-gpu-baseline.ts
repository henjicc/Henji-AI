import { performance } from 'node:perf_hooks'

import {
  compileImageEditRenderPlanV3,
  createBuiltInImageEditRenderNodeRegistry,
} from '../src/core/imageEdit/v3'
import {
  createImageEditorGpuBaselineFixturesV3,
  fingerprintImageEditorGoldenV3,
  renderImageEditorCpuGoldenV3,
} from '../src/features/imageEdit/v3/testing/imageEditorGpuBaselineV3'

function percentile(samples: readonly number[], quantile: number): number {
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? 0
}

function round(value: number): number {
  return Number(value.toFixed(3))
}

async function main(): Promise<void> {
  const registry = createBuiltInImageEditRenderNodeRegistry()
  const results = []
  for (const fixture of createImageEditorGpuBaselineFixturesV3()) {
    const compileSamples: number[] = []
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const startedAt = performance.now()
      compileImageEditRenderPlanV3(fixture.document, registry, 'stable')
      compileSamples.push(performance.now() - startedAt)
    }
    const renderSamples: number[] = []
    let fingerprint = 'compile-only'
    if (fixture.id !== 'large-8192') {
      for (let iteration = 0; iteration < 8; iteration += 1) {
        const startedAt = performance.now()
        const output = await renderImageEditorCpuGoldenV3(fixture)
        renderSamples.push(performance.now() - startedAt)
        fingerprint = fingerprintImageEditorGoldenV3(output.data)
      }
    }
    results.push({
      fixture: fixture.id,
      documentSize: fixture.document.geometry,
      renderSize: fixture.renderSize,
      layerCount: fixture.document.layers.length,
      compile: { p50Ms: round(percentile(compileSamples, 0.5)), p95Ms: round(percentile(compileSamples, 0.95)) },
      cpuRender: renderSamples.length
        ? { p50Ms: round(percentile(renderSamples, 0.5)), p95Ms: round(percentile(renderSamples, 0.95)) }
        : null,
      fingerprint,
    })
  }
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, results }, null, 2)}\n`)
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
