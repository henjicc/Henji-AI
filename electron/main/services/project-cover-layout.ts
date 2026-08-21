export type ProjectCoverSourceKind = 'image' | 'video'

export interface ProjectCoverSourceDto {
  source: string
  sourceKind: ProjectCoverSourceKind
}

/** 三张图不做不对称排版：只取最早两张；四张才升级为 2×2。 */
export function selectProjectCoverSources(sources: ProjectCoverSourceDto[]): ProjectCoverSourceDto[] {
  if (sources.length >= 4) return sources.slice(0, 4)
  if (sources.length >= 2) return sources.slice(0, 2)
  return sources.slice(0, 1)
}
