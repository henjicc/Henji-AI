import { useEffect, useMemo, useRef, useState } from 'react'
import { loadVideoEditSceneDeclarations, type VideoEditSceneDeclarationState } from '../application/videoEditScenes'
import { videoEditCommittedDocument, type VideoEditInstance } from '../application/videoEditService'

/**
 * 引用这些片子数据的代码声明（片子数据面板与时间线子轨道共用）。按已提交的剪辑读：拖动中的草稿不改代码引用，
 * 每一下都重读没有意义；每次提交后重读一次（代码元数据已缓存，很快），重读期间保留上一次的结果，界面不闪成“正在读取”。
 */
export function useVideoEditSceneDeclarations(instance: VideoEditInstance, sceneIds: readonly string[], enabled: boolean, onError: (reason: unknown) => void): ReadonlyMap<string, VideoEditSceneDeclarationState> {
  const committed = videoEditCommittedDocument(instance)
  const key = [...new Set(sceneIds)].join('\n')
  const [loaded, setLoaded] = useState<ReadonlyMap<string, VideoEditSceneDeclarationState>>(new Map())
  const report = useRef(onError); report.current = onError
  useEffect(() => {
    if (!enabled || !key) return undefined
    let live = true
    for (const sceneId of key.split('\n')) {
      if (!committed.scenes?.some(scene => scene.id === sceneId)) continue
      loadVideoEditSceneDeclarations(instance, committed, sceneId).then(
        state => { if (live) setLoaded(previous => new Map(previous).set(sceneId, state)) },
        reason => { if (live) report.current(reason) },
      )
    }
    return () => { live = false }
  }, [enabled, instance, committed, key])
  return useMemo(() => {
    const wanted = new Set(key ? key.split('\n') : [])
    return new Map([...loaded].filter(([sceneId]) => wanted.has(sceneId)))
  }, [loaded, key])
}
/** 一份片子数据的代码声明；还没读到时 undefined。 */
export function useVideoEditSceneDeclaration(instance: VideoEditInstance, sceneId: string | undefined, enabled: boolean, onError: (reason: unknown) => void): VideoEditSceneDeclarationState | undefined {
  const ids = useMemo(() => sceneId ? [sceneId] : [], [sceneId])
  return useVideoEditSceneDeclarations(instance, ids, enabled, onError).get(sceneId ?? '')
}
