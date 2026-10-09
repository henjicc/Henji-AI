import type { CameraStageControlExecutorDependencies } from './cameraStageControlExecutors'

export let dependencies: CameraStageControlExecutorDependencies = { readRevision: () => 0, bumpRevision: () => undefined }
export function configureCameraStageControlDependencies(value: CameraStageControlExecutorDependencies): void { dependencies = value }
