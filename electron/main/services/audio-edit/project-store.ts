import { getDb } from '../db'
import type { AudioEditProjectDocument, AudioEditProjectSummary } from '../../../../src/core/audioEdit/types'

interface ProjectRow {
  id: string
  name: string
  document_json: string
  created_at: number
  updated_at: number
}

function parseProject(row: ProjectRow): AudioEditProjectDocument {
  const project = JSON.parse(row.document_json) as AudioEditProjectDocument
  return { ...project, id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at }
}

export function listAudioEditProjects(): AudioEditProjectSummary[] {
  const rows = getDb().prepare(`
    SELECT id,name,document_json,created_at,updated_at
    FROM audio_edit_projects ORDER BY updated_at DESC
  `).all() as ProjectRow[]
  return rows.map((row) => {
    const project = parseProject(row)
    return {
      id: project.id,
      name: project.name,
      mediaType: project.source.mediaType,
      durationFrames: project.source.durationFrames,
      sampleRate: project.source.sampleRate,
      updatedAt: project.updatedAt,
    }
  })
}

export function getAudioEditProject(projectId: string): AudioEditProjectDocument | null {
  const row = getDb().prepare(`
    SELECT id,name,document_json,created_at,updated_at
    FROM audio_edit_projects WHERE id = ?
  `).get(projectId) as ProjectRow | undefined
  return row ? parseProject(row) : null
}

export function requireAudioEditProject(projectId: string): AudioEditProjectDocument {
  const project = getAudioEditProject(projectId)
  if (!project) throw new Error('NOT_FOUND：口播剪辑工程不存在。')
  return project
}

export function saveAudioEditProject(project: AudioEditProjectDocument): AudioEditProjectDocument {
  const current = getAudioEditProject(project.id)
  if (current && project.revision !== current.revision) {
    throw new Error('REVISION_CONFLICT：工程已被更新，请重新载入后再试。')
  }
  const now = Date.now()
  const next: AudioEditProjectDocument = {
    ...project,
    revision: current ? current.revision + 1 : Math.max(1, project.revision),
    createdAt: current?.createdAt ?? project.createdAt ?? now,
    updatedAt: now,
  }
  getDb().prepare(`
    INSERT INTO audio_edit_projects(id,name,document_json,created_at,updated_at)
    VALUES(?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      document_json=excluded.document_json,
      updated_at=excluded.updated_at
  `).run(next.id, next.name, JSON.stringify(next), next.createdAt, next.updatedAt)
  return next
}
