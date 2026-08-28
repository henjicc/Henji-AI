import {
  MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three'

import {
  CANVAS_GRID_ALT_HEX,
  CANVAS_TEXT_HEX,
} from '@/core/theme/colorTokens'

export interface MultiAngleEditorResources {
  horizontalOrbit: TorusGeometry
  verticalOrbit: TorusGeometry
  marker: SphereGeometry
  orbitMaterial: MeshBasicMaterial
  markerMaterial: MeshBasicMaterial
}

export function createMultiAngleEditorResources(): MultiAngleEditorResources {
  return {
    horizontalOrbit: new TorusGeometry(1.55, 0.012, 8, 96),
    verticalOrbit: new TorusGeometry(1.2, 0.009, 8, 72),
    marker: new SphereGeometry(0.075, 18, 12),
    orbitMaterial: new MeshBasicMaterial({ color: CANVAS_GRID_ALT_HEX, transparent: true, opacity: 0.9 }),
    markerMaterial: new MeshBasicMaterial({ color: CANVAS_TEXT_HEX }),
  }
}

export function disposeMultiAngleEditorResources(resources: MultiAngleEditorResources): void {
  resources.horizontalOrbit.dispose()
  resources.verticalOrbit.dispose()
  resources.marker.dispose()
  resources.orbitMaterial.dispose()
  resources.markerMaterial.dispose()
}
