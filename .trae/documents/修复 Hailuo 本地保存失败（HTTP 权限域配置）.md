## 问题定位
- 失败原因：`@tauri-apps/plugin-http` 拒绝从 `https://faas-minimax-video-1312767721.cos.ap-shanghai.myqcloud.com/...` 拉取视频，报错 `url not allowed on the configured scope`。
- 现有权限：`src-tauri/capabilities/default.json:20-41` 仅允许 `cos-output-image.ppinfra.com`、`cos-output-video.ppinfra.com`，未包含 `*.myqcloud.com`。

## 修改方案
- 扩展 HTTP 作用域，允许从 Hailuo 视频的 COS 域名下载：
  - 在 `src-tauri/capabilities/default.json` 的三个 HTTP 权限块中新增：
    - `https://*.myqcloud.com/*`（覆盖各区域 COS 子域名）
    - 可选：更严格改为 `https://*.cos.ap-shanghai.myqcloud.com/*` 或指定 `https://faas-minimax-video-*.cos.ap-shanghai.myqcloud.com/*`（如需缩小范围）。
- 三个需同步更新的权限块：
  - `http:allow-fetch`
  - `http:allow-fetch-read-body`
  - `http:allow-fetch-send`

## 具体改动
- 文件：`src-tauri/capabilities/default.json`
- 在上述三个 `allow` 数组追加：
  - `{ "url": "https://*.myqcloud.com/*" }`
- 不改动 FS 权限及其他配置。

## 验证步骤
- 启动应用并生成 Hailuo 视频：
  - 日志应显示已下载并保存：`[save] video saved <本地路径>`（PPIOAdapter.ts:431）。
  - `checkStatus` 成功切换为本地 blob：PPIOAdapter.ts:432-435。
- 观察不再出现 `url not allowed on the configured scope`。

## 兼容与安全
- 若需收缩域，改为更窄的 COS 域匹配（见上）；目前建议使用 `*.myqcloud.com` 以避免区域变更导致再失败。
- 不改动现有 API 行为与 UI；仅扩展下载权限域。

请确认以上方案，我将进行权限文件更新并验证。