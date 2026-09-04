/// <reference lib="webworker" />

import type {
  ImageEditorGpuSceneWorkerEventV3,
  ImageEditorGpuSceneWorkerRequestV3,
} from './imageEditorGpuSceneProtocolV3'
import { ImageEditorGpuSceneRuntimeV3 } from './imageEditorGpuSceneRuntimeV3'

const workerScope = self as DedicatedWorkerGlobalScope
const runtime = new ImageEditorGpuSceneRuntimeV3(postEvent)

workerScope.onmessage = (event: MessageEvent<ImageEditorGpuSceneWorkerRequestV3>): void => {
  runtime.handle(event.data)
  if (event.data.type === 'dispose') workerScope.close()
}

function postEvent(event: ImageEditorGpuSceneWorkerEventV3, transfer: Transferable[] = []): void {
  workerScope.postMessage(event, transfer)
}
