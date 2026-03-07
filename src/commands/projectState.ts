import Database from '@tauri-apps/plugin-sql';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { exists, mkdir } from '@tauri-apps/plugin-fs';

export interface ProjectSummaryRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
}

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
  nodesJson: string;
  edgesJson: string;
  viewportJson: string;
  historyJson: string;
}

interface ProjectRow {
  id: string;
  name: string;
  created_at: number | string;
  updated_at: number | string;
  node_count: number | null;
  nodes_json: string;
  edges_json: string;
  viewport_json: string;
  history_json: string;
}

let db: Database | null = null;
let initTask: Promise<void> | null = null;

function normalizeTimestamp(value: number | string | null | undefined): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return Date.now();
}

function toSummary(record: ProjectRow): ProjectSummaryRecord {
  return {
    id: record.id,
    name: record.name,
    createdAt: normalizeTimestamp(record.created_at),
    updatedAt: normalizeTimestamp(record.updated_at),
    nodeCount: Math.max(0, Number(record.node_count ?? 0)),
  };
}

function toProjectRecord(record: ProjectRow): ProjectRecord {
  return {
    ...toSummary(record),
    nodesJson: record.nodes_json,
    edgesJson: record.edges_json,
    viewportJson: record.viewport_json,
    historyJson: record.history_json,
  };
}

async function ensureDb(): Promise<Database> {
  if (db) {
    return db;
  }

  if (!initTask) {
    initTask = (async () => {
      const appDataDir = await appLocalDataDir();
      const appDir = await join(appDataDir, 'Henji-AI');
      if (!(await exists(appDir))) {
        await mkdir(appDir, { recursive: true });
      }

      const dbPath = await join(appDir, 'henji.db');
      db = await Database.load(`sqlite:${dbPath}`);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS storyboard_projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          node_count INTEGER NOT NULL DEFAULT 0,
          nodes_json TEXT NOT NULL,
          edges_json TEXT NOT NULL,
          viewport_json TEXT NOT NULL,
          history_json TEXT NOT NULL
        )
      `);
      await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_storyboard_projects_updated_at ON storyboard_projects(updated_at DESC)'
      );
    })().finally(() => {
      initTask = null;
    });
  }

  await initTask;
  if (!db) {
    throw new Error('Storyboard project database init failed');
  }
  return db;
}

export async function listProjectSummaries(): Promise<ProjectSummaryRecord[]> {
  const conn = await ensureDb();
  const rows = await conn.select<ProjectRow[]>(
    `SELECT id, name, created_at, updated_at, node_count, nodes_json, edges_json, viewport_json, history_json
     FROM storyboard_projects
     ORDER BY updated_at DESC`
  );
  return rows.map(toSummary);
}

export async function getProjectRecord(projectId: string): Promise<ProjectRecord | null> {
  const conn = await ensureDb();
  const rows = await conn.select<ProjectRow[]>(
    `SELECT id, name, created_at, updated_at, node_count, nodes_json, edges_json, viewport_json, history_json
     FROM storyboard_projects
     WHERE id = ?
     LIMIT 1`,
    [projectId]
  );
  if (rows.length === 0) {
    return null;
  }
  return toProjectRecord(rows[0]);
}

export async function upsertProjectRecord(record: ProjectRecord): Promise<void> {
  const conn = await ensureDb();
  await conn.execute(
    `INSERT INTO storyboard_projects (
      id, name, created_at, updated_at, node_count, nodes_json, edges_json, viewport_json, history_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      node_count = excluded.node_count,
      nodes_json = excluded.nodes_json,
      edges_json = excluded.edges_json,
      viewport_json = excluded.viewport_json,
      history_json = excluded.history_json`,
    [
      record.id,
      record.name,
      normalizeTimestamp(record.createdAt),
      normalizeTimestamp(record.updatedAt),
      Math.max(0, Number(record.nodeCount || 0)),
      record.nodesJson,
      record.edgesJson,
      record.viewportJson,
      record.historyJson,
    ]
  );
}

export async function updateProjectViewportRecord(
  projectId: string,
  viewportJson: string
): Promise<void> {
  const conn = await ensureDb();
  await conn.execute(
    `UPDATE storyboard_projects
     SET viewport_json = ?, updated_at = ?
     WHERE id = ?`,
    [viewportJson, Date.now(), projectId]
  );
}

export async function renameProjectRecord(
  projectId: string,
  name: string,
  updatedAt: number
): Promise<void> {
  const conn = await ensureDb();
  await conn.execute(
    `UPDATE storyboard_projects
     SET name = ?, updated_at = ?
     WHERE id = ?`,
    [name, normalizeTimestamp(updatedAt), projectId]
  );
}

export async function deleteProjectRecord(projectId: string): Promise<void> {
  const conn = await ensureDb();
  await conn.execute('DELETE FROM storyboard_projects WHERE id = ?', [projectId]);
}
