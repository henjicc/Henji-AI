import { SCENE_DETECTION_CHANNELS, type SceneDetectionPlatform } from '../../src/platform/contracts/sceneDetection'
export function createSceneDetectionApi(invoke: <T>(channel: string, payload?: unknown) => Promise<T>, subscribe: (channel: string, handler: (payload: unknown) => void) => () => void): SceneDetectionPlatform {
  return { detect: request => invoke(SCENE_DETECTION_CHANNELS.detect, request), cancel: id => invoke(SCENE_DETECTION_CHANNELS.cancel, id), validate: (source, contentIdentity) => invoke(SCENE_DETECTION_CHANNELS.validate, { source, contentIdentity }), onProgress: handler => subscribe(SCENE_DETECTION_CHANNELS.progress, value => handler(value as { requestId: string; progress: number })) }
}
