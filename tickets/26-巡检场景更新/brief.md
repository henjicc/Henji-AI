# ticket 26：Reality 界面巡检场景跟上现有界面（剪辑相关场景）

工作目录：D:/VibeCode/Henji-AI-t26（分支 task/26-巡检场景更新，基于 main）。只在这个目录改并提交到该分支；不 push、不合并、不切分支、不改依赖。

**联接点警告**：这个工作目录里 node_modules、native/video-decoder/ffmpeg、native/*/target、native/audio-capture/vendor 是指向主仓库的联接点，绝对不要删除、重建或往里写（不要运行 build:video-decoder / build:audio-* / npm install）。不占用 9334 端口、不碰 D:/视频制作；Reality 一律用隔离临时数据（默认就是，不要加 --profile real）。注释与提交说明用中文，提交说明末尾加一行：Co-Authored-By: Codex <noreply@openai.com>。先读 AGENTS.md、docs/rules/testing.md 的 Reality 部分。

## 背景

`scripts/lib/uiInspectionScenes.cjs` 登记了约 111 个 Reality 界面巡检场景，很多场景的断言是旧界面的写法，已经跑不通。2026-11-02 已修好其中一个场景 `video-edit-code-ai`（提交 81a1a0d05，看它的 diff 学修法），常见过时原因：

- 场景通过 MCP（外部 Agent）写入后，标题栏出现“外部助手正在编辑…接管”，之后人的点击会先被接管确认拦下：在点击界面前调用场景里的 `takeOver()` 或同等做法（点标题栏 role=status 里的“接管”）。
- 停靠面板改到“窗口”菜单开关：已开但收在标签溢出里时，点菜单项会把它关掉；要关掉再打开才能到前台。
- 文字与状态改成同一行混排：`getByText(..., { exact: true })` 匹配不上，改为包含匹配或更稳的定位。
- 默认筛选不列某些状态；浮层收起动画中再点会被当成关闭。
- 产品行为本身变了的（例如效果改名、参数显隐条件、媒体读取返回 MCP 标准图片），按现有产品行为改断言。

## 做法

1. 先 `npm run electron:bundle`（在本工作目录，生成本目录自己的 out/）。
2. 逐个跑剪辑相关场景：`npm run test:reality -- --suite ui --only <场景 id>`（场景 id 在各 `uiInspectionScene*.cjs` 的 `id:` 字段）。从 `video-edit-*` 开始，每个场景跑一遍；耗时超过约一分钟的命令后台跑。
3. 失败时打开 `.ui-tour/` 里的失败截图与 index.md 看原因：
   - 断言/定位过时 → 修场景脚本（只改 `scripts/lib/uiInspection*.cjs`），重跑到通过。
   - 产品真缺陷（界面坏了、功能不工作、报错）→ **不改产品代码**，在结果里记下场景、步骤、现象、截图路径与你的判断，继续下一个场景。
   - 需要外网、付费、真实账号或本机缺少的硬件才能跑的 → 记“跳过”及原因。
4. 每修通一批（几个场景）就提交一次，不要攒到最后。

## 回报

结果写到 D:/VibeCode/Henji-AI/tickets/26-巡检场景更新/result.md，并且**每跑完一个场景就追加一行**（这样额度中途用完也能接着做）：`场景 id | 结果（通过/已修通/产品缺陷/跳过）| 说明 | 提交哈希`。最后写总结：跑了多少、修通多少、产品缺陷清单、没跑到的场景。

## 补充（Claude 答复构建问题）

不要运行 `npm run electron:bundle`（它会编译原生模块、写进联接点）。在本工作目录按顺序手动运行下面这些步骤代替它，原生程序直接用联接点里已经编好的：

```
node scripts/generate-third-party-licenses.cjs
node scripts/build-author-libraries.ts
node scripts/generate-progress-seeds.cjs
node scripts/generate-catalog-index.cjs
node scripts/build-sdk-if-needed.cjs
node node_modules/electron-vite/bin/electron-vite.js build
```

之后改的只是 `scripts/lib/uiInspection*.cjs`，不需要重新构建；如果因为别的原因需要重建，就再按这个顺序跑一遍。Reality 的锁文件、测试缓存放在本目录没问题。主仓库里 Claude 也会跑构建与测量，两边共用 node_modules 里的构建锁，碰上锁就等一会儿再试。result.md 已有的内容保留，继续往下追加。
