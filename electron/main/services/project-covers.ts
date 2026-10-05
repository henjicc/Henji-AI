import fsp from 'node:fs/promises'
import path from 'node:path'
import { renderCoverImage } from './covers/cover-render'
import { getDb, getHenjiDataDir } from './db'
import { createMainLogger } from './logging'
import {
  selectProjectCoverSources,
  type ProjectCoverSourceDto,
} from './project-cover-layout'

export type { ProjectCoverSourceDto, ProjectCoverSourceKind } from './project-cover-layout'

/**
 * 工程封面：画布工程与 3D 镜头参考工程共用同一套落盘、清理与登记逻辑。
 *
 * 封面来源由渲染层决定（生成结果 / 视口截图）；转码与拼图在 covers/cover-render.ts（与通用文档封面共用），
 * 这里只负责写进程序目录、把路径登记回各自的工程表。画布与镜头参考接入文档底座（3.x）后改用通用封面。
 */

export type ProjectCoverScope = 'canvas' | 'camera-stage'

export interface SaveProjectCoverPayloadDto {
  scope: ProjectCoverScope
  projectId: string
  sources: ProjectCoverSourceDto[]
}

export interface ProjectCoverResultDto {
  projectId: string
  coverPath: string | null
}

const COVER_DIR_NAME = 'ProjectCovers'
const SCOPE_TABLES: Record<ProjectCoverScope, string> = {
  canvas: 'storyboard_projects',
  'camera-stage': 'camera_stage_projects',
}

const logger = createMainLogger('main.project-covers')
const coverSaveQueues = new Map<string, Promise<void>>()

function coverDir(): string {
  return path.join(getHenjiDataDir(), COVER_DIR_NAME)
}

function readCoverPath(scope: ProjectCoverScope, projectId: string): string | null {
  const row = getDb()
    .prepare(`SELECT cover_path FROM ${SCOPE_TABLES[scope]} WHERE id = ? LIMIT 1`)
    .get(projectId) as { cover_path: string | null } | undefined
  return row?.cover_path ?? null
}

function writeCoverPath(scope: ProjectCoverScope, projectId: string, coverPath: string | null): void {
  getDb()
    .prepare(`UPDATE ${SCOPE_TABLES[scope]} SET cover_path = ? WHERE id = ?`)
    .run(coverPath, projectId)
}

async function removeFileQuietly(target: string | null): Promise<void> {
  if (!target) return
  try {
    await fsp.unlink(target)
  } catch {
    // 封面文件可能已被用户或上一次清理删掉，缺失不是错误
  }
}

/**
 * 落盘一张工程封面并登记到工程表。
 *
 * 文件名带时间戳且落盘后删除上一张：`<img>` 与协议层都会按 URL 缓存，
 * 同名覆盖会让卡片继续显示旧封面。
 */
async function persistProjectCover(payload: SaveProjectCoverPayloadDto): Promise<ProjectCoverResultDto> {
  const { scope, projectId, sources } = payload
  const { bytes } = await renderCoverImage(sources)

  const directory = coverDir()
  await fsp.mkdir(directory, { recursive: true })
  const previousPath = readCoverPath(scope, projectId)
  const target = path.join(directory, `${scope}-${projectId}-${Date.now()}.webp`)
  await fsp.writeFile(target, bytes)
  writeCoverPath(scope, projectId, target)
  await removeFileQuietly(previousPath)

  return { projectId, coverPath: target }
}

/** 同一工程的自动更新与退出补刷新串行执行，避免并发覆盖留下孤儿封面文件。 */
export async function saveProjectCover(payload: SaveProjectCoverPayloadDto): Promise<ProjectCoverResultDto> {
  const { scope, projectId, sources } = payload
  const selectedSources = selectProjectCoverSources(sources)
  const queueKey = `${scope}:${projectId}`
  const previous = coverSaveQueues.get(queueKey) ?? Promise.resolve()
  logger.info('开始更新工程封面', {
    event: 'project_cover.save.start',
    context: { scope, projectId, requestedSourceCount: sources.length },
  })

  const task = previous.catch(() => undefined).then(async () => await persistProjectCover(payload))
  const completion = task.then(() => undefined, () => undefined)
  coverSaveQueues.set(queueKey, completion)
  try {
    const result = await task
    logger.info('工程封面已更新', {
      event: 'project_cover.save.completed',
      context: {
        scope,
        projectId,
        sourceCount: selectedSources.length,
        sourceKinds: selectedSources.map((item) => item.sourceKind),
      },
    })
    return result
  } catch (error) {
    logger.error('工程封面更新失败', {
      event: 'project_cover.save.failed',
      context: { scope, projectId, error: String(error) },
    })
    throw error
  } finally {
    if (coverSaveQueues.get(queueKey) === completion) coverSaveQueues.delete(queueKey)
  }
}

/** 删除工程时清掉封面文件；工程行本身由各自的 delete 语句带走。 */
export async function clearProjectCover(scope: ProjectCoverScope, projectId: string): Promise<void> {
  const previousPath = readCoverPath(scope, projectId)
  writeCoverPath(scope, projectId, null)
  await removeFileQuietly(previousPath)
}
