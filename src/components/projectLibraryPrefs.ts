/**
 * 项目页的本机视图偏好：网格 / 列表的选择与“最近打开”记录（每个页面各一份，按 `persistKey` 区分）。
 *
 * 只是这台机器上的浏览便利，不是业务数据：读写失败（隐私模式、存储被清空或被禁用）时回落到默认值，
 * 页面照常可用。助手不需要读写它们——同一批项目由作品索引提供。
 */

export type ProjectLibraryView = 'grid' | 'list';

const VIEW_KEY = (persistKey: string): string => `henji.projectLibrary.${persistKey}.view`;
const RECENT_KEY = (persistKey: string): string => `henji.projectLibrary.${persistKey}.recent`;

/** 最近打开最多记多少项；更早的自然淘汰。 */
const RECENT_LIMIT = 50;

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 存储不可用：只影响下次打开时的记忆
  }
}

export function readProjectLibraryView(persistKey: string): ProjectLibraryView {
  return readRaw(VIEW_KEY(persistKey)) === 'list' ? 'list' : 'grid';
}

export function writeProjectLibraryView(persistKey: string, view: ProjectLibraryView): void {
  writeRaw(VIEW_KEY(persistKey), view);
}

/** 最近打开：项目 id → 打开时间（毫秒）。 */
export function readRecentOpens(persistKey: string): Record<string, number> {
  const raw = readRaw(RECENT_KEY(persistKey));
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, number> = {};
    for (const [id, time] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof time === 'number' && Number.isFinite(time)) result[id] = time;
    }
    return result;
  } catch {
    return {};
  }
}

/** 记一次打开，返回更新后的记录（只保留最近 RECENT_LIMIT 项）。 */
export function recordRecentOpen(persistKey: string, id: string, now: number = Date.now()): Record<string, number> {
  const entries = Object.entries({ ...readRecentOpens(persistKey), [id]: now })
    .sort((a, b) => b[1] - a[1])
    .slice(0, RECENT_LIMIT);
  const next = Object.fromEntries(entries);
  writeRaw(RECENT_KEY(persistKey), JSON.stringify(next));
  return next;
}
