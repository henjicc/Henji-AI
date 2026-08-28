/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

import {
  createMultiAngleEditorResources,
  disposeMultiAngleEditorResources,
} from './multiAngleEditorResources'

describe('多角度编辑器三维资源', () => {
  it('关闭编辑器时释放全部几何体和材质', () => {
    const resources = createMultiAngleEditorResources()
    const disposed = vi.fn()
    for (const resource of [
      resources.horizontalOrbit,
      resources.verticalOrbit,
      resources.marker,
      resources.orbitMaterial,
      resources.markerMaterial,
    ]) {
      resource.addEventListener('dispose', disposed)
    }

    disposeMultiAngleEditorResources(resources)

    expect(disposed).toHaveBeenCalledTimes(5)
  })
})
