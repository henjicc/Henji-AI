/**
 * 项目页的本机视图偏好：网格 / 列表的选择（每个页面各一份，按 `persistKey` 区分）。
 * “最近打开”不在这里：它由作品索引按文档会话的打开统一记录（lastOpenedAt），任何入口打开都算。
 *
 * 只是这台机器上的浏览便利，不是业务数据：读写失败（隐私模式、存储被清空或被禁用）时回落到默认值，
 * 页面照常可用。助手不需要读写它。
 */

export type ProjectLibraryView = 'grid' | 'list';

const VIEW_KEY = (persistKey: string): string => `henji.projectLibrary.${persistKey}.view`;

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
