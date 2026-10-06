import type { SceneDetectionPlatform } from '../../contracts/sceneDetection'
function native(): SceneDetectionPlatform {
  const api = window.henjiNative?.sceneDetection as SceneDetectionPlatform | undefined
  if (!api) throw new Error('场景检测不可用，请重新启动应用。')
  return api
}
export function createElectronSceneDetection(): SceneDetectionPlatform {
  return { detect: request => native().detect(request), cancel: id => native().cancel(id), validate: (source, identity) => native().validate(source, identity), onProgress: listener => native().onProgress(listener) }
}
