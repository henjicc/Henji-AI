/** 按 URL 标准解码本地媒体路径；保留 UNC 主机名供宿主读取。 */
export function decodeMediaFileUrl(source: string): string {
  if (!/^file:\/\//i.test(source)) return source;
  try {
    const parsed = new URL(source);
    const pathname = decodeURIComponent(parsed.pathname);
    return parsed.hostname
      ? `//${parsed.hostname}${pathname}`
      : pathname.replace(/^\/([A-Za-z]:[\\/])/, '$1');
  } catch {
    return source;
  }
}
