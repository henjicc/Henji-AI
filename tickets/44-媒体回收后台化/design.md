# 44 媒体回收后台化：设计

范围与顺序见同目录 plan.md。本文只写决定与事实。数字取自 2026-11-10 07:35 对真实资料目录 `henji.db` 的只读查询（`mode=ro`）与 11-08、11-09 两天日志。

目录：

1. 现状事实
2. 缓存搬出设置表（S1）
3. 触发器入队条件（S2）
4. 清存量迁移与压缩（S2）
5. 后台回收（S3，核心）
6. 仍被引用的候选：不做出口
7. D5 实现要点（S4）
8. D4 实现要点（S5）
9. 实现拆分
10. 测试
11. 与审查文档不一致的地方

---

## 1. 现状事实

### 1.1 回收为什么删不掉文件

- 两天里回收启动 22 次，全部是启动时那一次（每次都跟在 `crash_reporter.start.completed` 之后）。`media_recycle.references.completed` 出现 0 次：没有一次走到“逐个检查候选”这一步。17 次停在数据库各表的引用读取中（`media_recycle.sweep.deferred`），5 次停在文档扫描中（`media_recycle.references.deferred`）。
- 退出回收在两天日志里 0 次记录（`media_recycle.exit.completed` 与 `application.shutdown.*` 都没有）。
- 启动回收在 [index.ts:257-273](../../electron/main/index.ts) 的 `beforeRendererLoad` 里 `await`，[lifecycle.ts:25-36](../../electron/main/services/media-recycle/lifecycle.ts) 固定 3 秒后放行。文档扫描约 2.3 秒，剩下不到 1 秒读不完十张表（`application_invocations` 一张就有 33 MB 的 JSON 要解析）。

### 1.2 候选从哪来

[schema.ts:79-87](../../electron/main/services/media-recycle/schema.ts) 给十张登记表各建 `AFTER DELETE` 与 `AFTER UPDATE OF <列>` 触发器，无条件把旧行写进 `media_recycle_candidates`。`settings` 的写入是 `INSERT … ON CONFLICT DO UPDATE SET value = …`（[settings/store.ts:72-76](../../electron/main/services/settings/store.ts)），值不变也会触发。

| 来源 | 候选行数 | 载荷字节 | 旧行里确有路径样字符串的行 |
|---|---|---|---|
| `settings` | 1,394 | 70.6 MB | 296（其中 292 条是 `media_cache_last_root` 被原值重写） |
| `application_invocations` | 6,569 | 16.1 MB | 253 |
| `application_observations` | 5,791 | 16.2 MB | 0 |
| `generation_submissions` | 477 | 0.96 MB | 139 |
| `audio_edit_tasks` | 417 | 0.61 MB | 32 |
| `assets` | 886 | 0.12 MB | 886 |
| `history` | 56 | 0.05 MB | 37（另有编辑状态文件，全部保留） |
| `paths`（显式入队） | 65 | 0.03 MB | 65 |
| 合计 | 15,655 | 104.6 MB | 保留 1,727 行 / 5.2 MB |

### 1.3 位置在库里的实际写法

以 [locationCodec.ts](../../src/core/storage/locationCodec.ts) 与真实数据为准：

- 经位置换算写入的记录：作品目录内写成 `henji://user/<相对路径>`（正斜杠，如 `henji://user/上传素材/ab….png`），项目内写成 `henji://project/<项目ID>/…`。
- 程序目录内的路径（`Thumbnails`、`EditStates`）不换算，原样是绝对路径。
- 不经换算的写入方原样存绝对路径：显式入队的 `paths` 候选全部是 `E:\文档\痕迹AI\上传素材\…`；`application_invocations.record_json` 里有 `D:/…`、`D:\\…`，也有作品目录内未换算的 `E:\\文档\\痕迹AI\\项目\\…`。
- 回收端读取候选与引用时，凡是以盘符、斜杠、`file:`、`henji:`、`henji-media:` 开头的字符串值或对象键都算引用（[mediaReferences.ts:17](../../src/core/media/mediaReferences.ts)），再经 `realpath` 归一后与受管根比较。

受管根有五个（[queue.ts:8-11](../../electron/main/services/media-recycle/queue.ts)）：作品目录下的 `录音`、生成结果、上传素材，程序目录下的 `Thumbnails`、`EditStates`。

### 1.4 现有“不会错删”靠什么

- 引用只取持久状态：十张表、磁盘上的文档与文档包、已保存的会话状态、图片编辑工作副本、最近删除的副本、主进程租约。渲染层内存不参与（[lifecycle.ts:6-7](../../electron/main/services/media-recycle/lifecycle.ts)）。
- 启动回收发生在界面加载之前（[window.ts:221-235](../../electron/main/window.ts)），此时没有任何渲染层内存，持久状态就是全部引用。退出回收要求所有窗口经保存确认后关闭。
- 普查与删除之间数据库有任何写入就整轮作废（`revision()` 取 `total_changes()`，[store.ts:63](../../electron/main/services/media-recycle/store.ts)）。
- 删除有后路：作品目录内的文件走 `trashUserFile`（[recycle/runtime.ts:65-68](../../electron/main/services/recycle/runtime.ts)），先在“最近删除”留副本（保留 30 天），再进系统回收站；`Thumbnails` 与 `EditStates` 直接删除。

---

## 2. 缓存搬出设置表（S1）

### 2.1 决定

两类缓存都改成文件，不新建数据表。理由：留在库里会跟着每日快照与迁移备份复制；性能记录播放时每 5 秒整份改写（127 KB），会不断写进 WAL；项目里已有“可重建缓存的唯一位置与管理入口”（[media-cache.ts](../../electron/main/services/media/media-cache.ts) 的 `MediaCacheManager`），总量上限、按最久未用清理、保留天数和设置里的“清理缓存”都现成。

| 缓存 | 现在 | 改为 | 键 | 上限与淘汰 |
|---|---|---|---|---|
| 代码素材参数缓存 | `settings` 的 `cache.video-edit.code-metadata.v1:<sha256>`，1,291 行，共 6.6 MB，单条平均 5.1 KB、最大 19.5 KB | `MediaCacheManager.createCache('analysis', 'code-metadata', { extension: '.json', budgetBytes: 32 MB, pruneIntervalMs: 60_000 })`，位于作品目录的缓存文件夹 | 沿用现有 64 位十六进制摘要（去掉前缀） | 本类 32 MB 封顶、读命中刷新使用时间、超出按最久未用删除；同时受缓存总上限与保留天数约束；用户可在设置里清理 |
| 渲染性能提示记录 | `settings` 的 `cache.video-edit.render-performance.shown`，1 行 127 KB | 程序目录下单个文件 `video-edit-render-performance.json`，用现有 `fs/json-file.ts` 原子读写 | 无（整份） | 沿用渲染层现有的 256 段、30 天上限；它是本机观测，不跟作品目录走 |

### 2.2 接口

- 主进程：新增 `electron/main/services/media/derived-records.ts`，导出 `readCodeMetadata(key)`、`writeCodeMetadata(key, text)`、`readRenderPerformance()`、`writeRenderPerformance(text)`。键不匹配 `^[0-9a-f]{64}$` 直接拒绝。缓存停用（读不到作品目录）时读返回空、写不做事。
- IPC：在现有 [ipc/media-cache.ts](../../electron/main/ipc/media-cache.ts) 与 [contracts/mediaCache.ts](../../src/platform/contracts/mediaCache.ts) 增加四个通道，preload 与 `src/platform/adapters/electron` 照现有 `mediaCache` 的写法补齐。
- 渲染层：[videoEditCodeMetadataCache.ts](../../src/features/videoEdit/application/videoEditCodeMetadataCache.ts) 与 [videoEditRenderPerformance.ts](../../src/features/videoEdit/application/videoEditRenderPerformance.ts) 把 `getPlatform().settings.get/set` 换成 `getPlatform().mediaCache.*`；内容校验（`{ json, hash }` 信封、zod 校验）不变。`videoEditRenderPerformance.ts` 里清理旧键的 `LEGACY_KEYS` 逻辑删除，由 S2 的迁移一次清掉。

### 2.3 旧条目

不搬内容。S1 之后旧行不再被读写；S2 的迁移删除它们。代价是每个代码素材首次用到时重新读一次源码算参数。

### 2.4 登记

[formats.ts](../../src/core/persistence/formats.ts) 的 `PERSISTENCE_EXCLUSIONS` 里 `video-edit-render-cache` 一项的读入口补上新文件；代码素材参数缓存新增一条排除说明（可由源码重算）。两者都不是持久格式，不升版本。

---

## 3. 触发器入队条件（S2）

### 3.1 判断什么

不按“受管根前缀”判断，按“旧行里是否有任何路径样字符串”判断。原因：

1. 库里的路径有四种写法并存（1.3），作品目录还可能被用户更换，触发器是静态 SQL，写不进一个随设置变化的前缀。
2. 受管根的归属要经 `realpath` 才能确定（目录联接别名），文本前缀会漏。
3. 这个条件与回收端提取引用的规则是同一组起始前缀，是它的超集；在 15,655 条真实候选上逐条比对，回收端能提取出引用而条件判否的为 0 条。
4. 它已经挡掉 89% 的行、95% 的字节；放进来但其实都是外部路径的候选，第一轮跑完就被 `forget` 删掉。

漏判的后果是漏回收（文件留在磁盘上），不会造成错删：第 5 节的保护不依赖触发器。

### 3.2 条件怎么写

在 `schema.ts` 新增一个生成函数，触发器与清存量迁移都调用它，只是列的取法不同（触发器传 `OLD.<列>`，迁移传 `json_extract(payload, '$.<列>')`）。

```
B = char(92)   -- 反斜杠，避免在 TS 与 SQL 里各转义一遍

J(x)  JSON 文本列里有以路径开头的字符串（值或键）：
  x LIKE '%"henji:%' OR x LIKE '%"henji-media:%' OR x LIKE '%"file:%'
  OR x LIKE '%"/%' OR x LIKE '%"' || B || B || '%'
  OR x GLOB '*"[A-Za-z]:[/' || B || ']*'

P(x)  整列本身就是一个路径：
  x LIKE 'henji:%' OR x LIKE 'henji-media:%' OR x LIKE 'file:%'
  OR x LIKE '/%' OR x LIKE B || '%'
  OR x GLOB '[A-Za-z]:[/' || B || ']*'
```

`LIKE` 对 ASCII 不分大小写，与回收端正则的 `/i` 一致；列为 `NULL` 时结果为 `NULL`，触发器不触发。`J` 匹配的是 `JSON.stringify` 的输出形态：字符串以 `"` 开头，反斜杠写成两个。

### 3.3 各登记表

“持有”是一行旧数据可能持有引用的条件，用于 `DELETE` 触发器和清存量；“释放”是 `UPDATE` 触发器的条件：某个承载引用的列既变了、旧值又可能含路径。`UPDATE OF` 的列清单不变。

| 表 | 持有（DELETE 与清存量） | 释放（UPDATE） |
|---|---|---|
| `history` | 恒真（`id` 对应 `EditStates/<id>.json`） | `(OLD.params IS NOT NEW.params AND J(OLD.params)) OR (OLD.result_paths IS NOT NEW.result_paths AND J(OLD.result_paths)) OR OLD.id IS NOT NEW.id` |
| `presets` | `J(params)` | `OLD.params IS NOT NEW.params AND J(OLD.params)` |
| `assets` | `P(file_path) OR thumbnail_name IS NOT NULL` | `(OLD.file_path IS NOT NEW.file_path AND P(OLD.file_path)) OR (OLD.thumbnail_name IS NOT NEW.thumbnail_name AND OLD.thumbnail_name IS NOT NULL)` |
| `generation_submissions` | `NOT (media_released = 1 AND phase = 'completed') AND J(response_json)` | 旧行满足“持有”，且（`response_json` 变了，或新行是 `media_released = 1 AND phase = 'completed'`） |
| `pending_task_results` | `J(result_json)` | 该列变了且 `J(OLD.result_json)` |
| `camera_stage_render_tasks` | `J(record_json)` | 同上，列为 `record_json` |
| `audio_edit_tasks` | `J(result_json)` | 同上 |
| `settings` | `P(value) OR J(value)`（不看 `type`，取超集） | `(OLD.value IS NOT NEW.value OR OLD.type IS NOT NEW.type) AND (P(OLD.value) OR J(OLD.value))` |
| `application_invocations` | `J(record_json)` | 该列变了且 `J(OLD.record_json)` |
| `application_observations` | `J(record_json)` | 同上 |

`UPDATE` 触发器的载荷只写被释放的列：`json_object('<列>', CASE WHEN OLD.<列> IS NOT NEW.<列> THEN OLD.<列> END, …)`，没变的列写 `NULL`。没变的列里的路径仍被这一行引用，写进候选只会让它永远“仍被引用”。例外：`generation_submissions` 的 `phase`、`media_released` 与 `settings.type` 是判定用的列，始终写旧值；`generation_submissions.response_json` 在交接（新行变为已释放）时即使没变也写入。回收端的 `recordReferences` 对 `NULL` 列已经是跳过，不用改。

`DELETE` 触发器的载荷与现在相同（整行登记列）。

### 3.4 效果

当前各表“现存行满足持有条件”的比例，也就是今后一次改写或删除会入队的比例：`application_invocations` 326 / 2,922，`application_observations` 0 / 25，`settings` 4 / 1,302（`user_data_root`、`media_cache_last_root`、两条音效文件夹），`audio_edit_tasks` 86 / 380，`pending_task_results` 104 / 104，`generation_submissions` 121 / 126，`camera_stage_render_tasks` 7 / 7。

---

## 4. 清存量迁移与压缩（S2）

### 4.1 迁移

账本第 27 项，名称 `media_recycle_guarded_outbox`，默认事务内执行，函数 `guardMediaRecycleOutboxV27` 放在 `media-recycle/schema.ts`。`createMediaRecycleTablesV21` 与 `MEDIA_REFERENCE_TABLES` 不改。步骤：

1. 删除十张表的 `media_recycle_<表>_update` 与 `media_recycle_<表>_delete` 触发器。表名在函数里写成固定清单（第 27 项只认当时这十张；以后新增登记表由新增它的迁移用同一个生成函数建触发器）。
2. 删除设置表里的缓存旧行：`key GLOB 'cache.video-edit.code-metadata.v1:*'`、`cache.video-edit.render-performance.shown`，以及 `cache.video-edit.render-performance.v1` 到 `v6`（带与不带 `.shown`）。此时没有触发器，不会产生候选。
3. 清候选：对每个来源执行 `DELETE FROM media_recycle_candidates WHERE source = '<表>' AND NOT coalesce(<持有条件>, 0)`，条件由 3.2 的同一个函数生成。`source = 'paths'` 与不认识的来源不动。
4. 按 3.3 重建带条件的触发器。

不声明 `backupWhen`。删掉的是不含任何路径的回收意图和可重建缓存，不是用户数据；整库备份一次 160 MB，`backups/` 没有保留策略。每日快照仍在。

版本登记：`SQLITE_SCHEMA_VERSION` 26 → 27（`SCHEMA_MIGRATIONS` 里原来用常量的第 26 项改写成字面量 26，新项用常量）；`SETTING_RECORD_VERSION` 等独立内容版本不动（设置记录的结构没变）。按 [persistence.md](../../docs/rules/persistence.md) 生成 `tests/fixtures/persistence/sqlite/v27.json`，跑 `npm run persistence:baseline` 与 `npm run persistence:release-snapshot`。

在真实库上的预期：候选 15,655 → 约 1,727 行，104.6 MB → 约 5.2 MB。条件求值加删除约 10 秒（只读实测条件求值约 8 秒，`settings` 来源占 5 秒），只发生一次，在窗口出现之前。

### 4.2 压缩

迁移只把页面还给空闲链表，文件大小不变。`VACUUM` 不能在事务里跑，所以不放进迁移：在 [db.ts](../../electron/main/services/db.ts) 的 `openDatabase` 里、`initializeSchema` 之后加一步通用的“浪费多了就压缩”：

- 条件：`freelist_count * page_size ≥ 32 MB` 且占文件 25% 以上。
- 动作：`VACUUM`，然后 `wal_checkpoint(TRUNCATE)`。日志 `db.compact.start` / `db.compact.completed`（带前后字节数与耗时）/ `db.compact.failed`。
- 失败（另一个进程占着库时会报忙）只记警告，下次启动条件仍成立会再试。

真实库预期从 166 MB 降到约 55 MB（其中调用记录 33 MB、音频任务 9.9 MB）。压缩在每日快照之前执行，快照随之变小。

---

## 5. 后台回收（S3）

### 5.1 选定方案

**启动静止点快照**：在界面加载前只做一件毫秒级的事——记下这一刻（下称 P0）并固定住数据库在这一刻的读视图；界面加载完成后，后台用 P0 的视图做引用普查并分片删除。后台这一轮只处理 P0 之前已经入队的候选，只删“P0 那一刻没有任何持久引用”的文件。

它保留了现有设计的前提，只是换了取证方式：现有设计在 P0 当场把普查做完；新设计在 P0 当场把证据固定下来，稍后再读。

### 5.2 P0 的证据怎么固定

| 持久状态 | 固定方式 | 不成立时 |
|---|---|---|
| 数据库（十张登记表、候选表、`media_recycle_owned`、`media_recycle_retained`、作品索引、外部位置、最近删除记录） | P0 时另开一个只读连接，`BEGIN` 后执行一次查询。WAL 模式下这个读事务看到的一直是 P0 的内容，主连接照常写。普查的全部 SQL 读取都走它 | 连接打不开：本次运行不做后台轮 |
| 磁盘上的引用文件（文档、文档包、会话状态、有历史记录的编辑状态、图片编辑工作副本、最近删除副本） | 扫描线程对每个解析过的文件取修改时间，返回其中最新的一个。最新修改时间早于 `P0 − 2 秒`，说明读到的都是 P0 时的内容 | 有文件在 P0 之后写过：本次运行整轮放弃 |
| 最近删除的副本集合 | 扫描结束后用主连接再读一次 `recycled_items` 的文件类条目，与 P0 快照里的集合比较 | 不一致（期间有人恢复或清理了副本）：整轮放弃 |
| 扫描根 | 任一扫描根是 Windows 网络路径（`isWindowsNetworkPath`）时，修改时间来自服务器时钟，不可比 | 整轮放弃 |

“整轮放弃”= 不删任何文件、候选原样保留、记 `media_recycle.background.skipped` 与原因。本次运行不重试，等下次启动或退出回收。

### 5.3 一轮的流程

1. **界面加载前**（`beforeRendererLoad`，同步，不 `await`）：`quietAt = Date.now()`；开只读连接并 `BEGIN`；读 `max(id)`、`count(*)` 得到 `horizon` 与候选数。候选数为 0 就关连接、结束。之后照常注册服务、加载界面。
2. **界面加载完成后**（主窗口 `did-finish-load`，且启动时那次 `purgeRecycledItems` 已结束）：开始后台轮，全程一个 `AbortController`。
3. 文档扫描（Worker 线程，现有 `scanReferenceFiles`）：扫描根清单取自快照。得到引用集合、最新修改时间。按 5.2 检查，不成立则放弃。
4. 数据库引用读取：现有各提供者改为从快照连接读，每页 32 行让出一次事件循环。
5. 关闭快照连接。
6. 逐个候选检查并删除：只读 `id ≤ horizon` 的候选。每个文件在发起删除前同步核对一次“当前保护集”（5.4 第 3 条）。
7. 记 `media_recycle.background.completed`。本次运行不再有第二轮。

快照连接的寿命有界：后台轮开始前等待超过 120 秒（界面一直没加载完）就关闭并放弃；应用退出时先关它再执行 `closeDb()`（否则退出时的 `wal_checkpoint(TRUNCATE)` 会被这个读事务挡住）。

### 5.4 后台轮删除一个文件的全部条件

1. 它所在的候选在 P0 之前入队（`id ≤ horizon`）。本次运行新入队的候选一律留给下次。
2. 它不在 P0 引用集合里（5.2 的证据全部成立）。这一条沿用现有判定：路径本身、`media_recycle_owned.source_path`、派生来源、候选的 `protectedBy`，任何一个被引用都保留。
3. 它不在“当前保护集”里：主进程此刻的租约（`listManagedMediaFileLeases`、`listUploadImageLeases`）加上本次运行的**占用声明**。同样作用于路径本身、来源、派生来源、`protectedBy`。
4. 文件身份（设备、inode、大小、修改时间、创建时间）与 P0 快照里 `media_recycle_owned` 记录的一致，且在受管根内、不是链接。

第 3 条的占用声明是新增的：`queue.ts` 增加同步的 `claimManagedMedia(path)` 与进程内集合。调用点：

- `registerOwnedMedia` 入口（覆盖所有新建与覆盖写入）。
- 内容寻址命中已有文件、不走 `registerOwnedMedia` 的返回分支：[media-import/index.ts](../../electron/main/services/media-import/index.ts) 的三处 `cacheHit`、[image/path-utils.ts](../../electron/main/services/image/path-utils.ts) `persistContentAddressedImage` 的“文件已存在”分支、[ai-runtime/media-store.ts](../../electron/main/services/ai-runtime/media-store.ts) 的 `EEXIST` 分支。
- 媒体协议：[protocol.ts:221](../../electron/main/protocol.ts) `handleMediaRequest` 解析出本地路径后。

声明用本次运行缓存的受管根做前缀判断，不调用 `getUserFolderDir`（它每次同步建目录，媒体协议是热路径）。集合只增不减，进程退出即清空。

第 3 条的核对与发起删除之间不能有让出事件循环的等待：先把还没归一化的声明解析完，再 `lstat` 取身份，然后在同一个同步段里确认声明集合的版本号没变、判定、调用删除；版本号变了就对这个文件重来一遍。

### 5.5 为什么不会错删

要证明：满足 5.4 的文件 F，在删除时既不被持久状态引用，也不在任何内存里。

- 渲染层内存里的受管路径只有三个来源：读到的持久状态、主进程写入方返回的路径、应用外部给的路径（资源管理器拖入、文件对话框、助手从目录列表里读到）。
- F 不在 P0 的持久状态里（条件 2）。本次运行的界面是 P0 之后才加载的，所以它从持久状态里读不到 F。P0 之后持久状态里新增的引用，也只能来自上面三个来源。
- 主进程写入方返回 F（包括相同内容再次上传、命中已有文件）会留下声明（条件 3）。
- 剩下的只有“应用外部给的路径”，见 5.8 的残余风险 R1；媒体协议上的声明把这个窗口缩到“拿到路径之后、第一次显示之前”。
- P0 之后持久状态被改写、删除的那些引用：它们在 P0 时还在，所以在 P0 引用集合里，F 不可能是它们指向的文件。这就是不再需要 `total_changes()` 整轮作废的原因——后台轮的 `revision` 传常量。

### 5.6 可能错删的时序，逐一排除

| # | 时序 | 排除方式 |
|---|---|---|
| 1 | 文档里有素材 U（已保存）。用户打开文档、删掉节点、自动保存；撤销栈在内存里仍有 U。U 有一条以前留下的候选 | U 在 P0 的文档内容里。若文档在扫描前被保存，它的修改时间晚于 P0，整轮放弃；若扫描在保存之前读到它，U 在引用集合里 |
| 2 | 用户把一条历史记录的结果图拖进画布（未保存），随即删除这条历史 | 历史行在 P0 快照里，结果图在引用集合里。删除历史产生的新候选 `id > horizon`，本轮不处理 |
| 3 | 生成完成，结果只在未保存的文档里，租约已释放并入队 | 文件是本次运行新建的：候选 `id > horizon`；`registerOwnedMedia` 留有声明；提交回执行不在 P0 快照里也无妨 |
| 4 | 用户昨天移除了一张上传图（有候选，文件还在），今天启动后马上再次上传同一张图，内容寻址命中同一路径 | 命中分支留下声明，条件 3 保护。若文件先被外部删掉再重建，身份与 P0 记录不符，条件 4 保护 |
| 5 | 用户在扫描进行中重命名或移动文档、改项目名 | 已入索引的文档各自是一个扫描根且不可缺失：旧路径不在了扫描报错，整轮失败不删。这个行为现在就有，后台轮的根清单取自 P0 快照，必须保持“不可缺失” |
| 6 | 用户在扫描进行中从“最近删除”恢复一份文档（副本被移走、目标是新文件） | 副本集合前后比较不一致，整轮放弃 |
| 7 | 启动时清理过期的“最近删除”副本与扫描并发 | 后台轮等启动时那次 `purgeRecycledItems` 结束后才开始；运行中再发生的清理由第 6 条的比较拦住 |
| 8 | 上次未完成的生成任务在启动时恢复：回执行被标记已交接、同时插入历史行，两张表先后被读到 | 两张表都读自同一个 P0 快照，交接发生在 P0 之后，快照里回执仍持有 |
| 9 | 缩略图的主文件被重新上传（命中已有文件），缩略图本身有候选 | 主文件有声明；条件 3 对派生来源同样生效，缩略图保留 |
| 10 | 判定通过后、删除执行前，写入方返回了这个文件 | 判定与发起删除在同一个同步段内（5.4 末段）。已经交给系统的那一次删除无法撤回，文件在“最近删除”与系统回收站里可恢复 |
| 11 | 后台轮进行中用户退出应用 | 退出流程先中止后台轮并等它结束（中止后不再发起新的删除），再走原有退出回收或直接关库 |
| 12 | 界面崩溃后自动重载 | 重载只会让内存里的引用更少；一次运行仍只有一轮 |
| 13 | macOS 关掉最后一个窗口后再打开 | P0 只在进程的第一个窗口加载前取一次；之后新开窗口不再触发后台轮 |
| 14 | 用户更换作品目录 | 现有流程是重启应用；后台轮被第 11 条中止 |
| 15 | 文档所在磁盘离线、外部位置不可读、链接无法解析 | 现有行为不变：扫描失败整轮不删，或保护全部已登记文件 |

### 5.7 被否的方案

| 方案 | 否决理由 |
|---|---|
| 渲染层上报打开中文档的实时引用 | t192 做过又删掉。每一个持有方（各类文档、撤销栈、参数面板、助手附件、剪贴板）都得完整、同步地上报，漏一个就是错删；快照与删除之间还有先后问题。主进程无法验证上报是否完整 |
| 只在没有文档会话打开时推进 | 文档会话登记表只在渲染层，主进程要新增一条“用于放行删除”的上报通道并信任它；参数面板等非文档持有方不在会话里；每次打开关闭都要重做普查；相同内容再上传的问题仍要另外解决 |
| 沿用 `total_changes()` 整轮作废，直接搬到后台 | 运行中的应用一直在写库（设置、调用记录），永远跑不完；而且它管不到文档文件的改写 |
| 缩短或加长启动时限 | 加长就继续挡界面；缩短则普查本身（2.3 秒起）都做不完 |
| 只靠退出回收并放宽时限 | 两天日志里退出回收 0 次；放宽会拖住进程退出，接上单实例锁后用户马上重开会没反应 |
| 用主进程钩子标记“本次运行写过文档”来代替修改时间 | 写引用文件的入口分散（文档仓库、会话状态、图片编辑工作副本、渲染层经通用文件接口写编辑状态），漏挂一个钩子就是错删，且看不到并行的命令行进程。修改时间是对被扫描文件的直接观察 |

### 5.8 残余风险

- **R1 外部路径复用**：某个文件已有候选、P0 时无人引用，用户或助手在启动后的头几秒从应用外部拿到它的路径并原地引用（不复制），且在后台轮判定它之前主进程还没经手过这个路径。改动前这个文件在界面出现之前就被删了，用户选不到；改动后有几秒窗口。缓解：媒体协议与导入入口的声明；文件 30 天内可从“最近删除”恢复。
- **R2 时钟**：修改时间规则依赖本机时钟。运行中系统时间被往回调、或文件系统不更新修改时间时，可能把本次运行的改写看成旧内容。已留 2 秒余量；网络路径直接放弃。反方向（文件的修改时间在未来）只会导致一直放弃，日志里有原因。
- **R3 并行进程**：助手命令行进程、以及单实例锁（D2）落地前的第二个窗口实例，内存里可能有未保存的引用。这是原有边界，但以前回收从未跑完，等于没暴露过。S3b 排在 D2 之后。
- **R4 提供者之外的持有方**：不在引用提供者清单里的持久存储（例如渲染层本地存储里记的路径）现有设计同样不保护。回收第一次真正删除文件时才会暴露。缓解：S3b 先用演练模式在真实资料目录跑一轮，人工过一遍清单。

### 5.9 代码改动

- `lifecycle.ts`：删除 `startup()` 与 `'starting'` 阶段。新增 `prepareBackground(capture)`（界面加载前同步调用一次，保存静止点）、`runBackground(pass)`（界面加载完成后调用，一次运行只生效一次，内部持有 `AbortController`）。`exit()` 开头先中止后台轮并等待它结束、释放快照，再按原条件执行。`opened()` 在 `'exiting'` 阶段仍抛错。
- `runtime.ts`：新增 `captureMediaRecycleQuietPoint()`（返回 `{ at, horizon, snapshot, release }` 或空）与 `runBackgroundMediaRecycle(quiet, signal)`。现有 `runMediaRecycle` 只给退出用，行为不变。删除适配器读 `HENJI_MEDIA_RECYCLE_DRY_RUN`：为 `1` 时不删文件、不 `forget`，只记 `media_recycle.sweep.would_delete`（带路径与字节数）。
- `collector.ts`：`MediaCollectorOptions` 增加可选的 `liveProtection: { version(): number; list(): string[] }`；按 5.4 末段在删除前核对。不传时行为与现在相同。
- `store.ts`：`createRecycleStore` 增加可选的 `horizon` 与 `owned` 来源（后台轮传 P0 的值）。
- `providers.ts`：`collectSqlReferences`、`collectDocumentReferences`、`releaseDocumentSubmissionReferences` 增加可选的数据库参数（默认 `getDb()`）；`collectDocumentReferences` 返回值增加 `latestModifiedMs`，并在扫描后比较最近删除副本集合。`releaseDocumentSubmissionReferences` 的写入仍走主连接。
- `file-scanner.ts`：Worker 对每个解析的文件取 `stat().mtimeMs`，在完成消息里返回最大值。
- `queue.ts`：`claimManagedMedia`、`listClaimedManagedMedia`、声明版本号；`registerOwnedMedia` 入口调用声明。
- `index.ts`：`beforeRendererLoad` 里把 `await mediaRecycleLifecycle.startup(runMediaRecycle)` 换成同步的 `prepareBackground`（失败只记日志）；保存 `purgeRecycledItems()` 的 Promise；主窗口 `did-finish-load` 后调用 `runBackground`。助手命令行与 `--verify-model` 模式不调用。
- `window.ts`：`beforeRendererLoad` 上方的注释改写为现在的含义（界面加载前只取静止点）。
- `scripts/check-media-recycle.cjs`：启动接线检查增加一条——`index.ts` 必须在 `beforeRendererLoad` 里调用 `prepareBackground`，且不得再出现 `mediaRecycleLifecycle.startup(`。

### 5.10 分片与日志

- 文档扫描在 Worker；主线程每个文件只做一次引用换算。数据库引用读取每页 32 行。候选检查每个候选让出一次（现有）。删除本身是异步的复制加系统回收站调用。
- 不设总时限，不做“用户操作时暂停”：安全性不依赖时机，分片已经把单段同步耗时压在毫秒级。
- 日志（域 `main.media_recycle`）：

| 事件 | 级别 | 内容 |
|---|---|---|
| `media_recycle.background.scheduled` | info | 候选数、`horizon` |
| `media_recycle.background.skipped` | info / warn | `reason`：`no-candidates`、`reference-files-changed`（带最新文件所在的扫描根类别）、`recycle-backups-changed`、`network-root`、`snapshot-expired`、`aborted` |
| `media_recycle.references.start` / `.completed` | info | 现有，`.completed` 带引用数与耗时 |
| `media_recycle.sweep.start` / `.completed` / `.failed` | info / warn | 现有 |
| `media_recycle.background.completed` | info | 删除数、回收字节、剩余候选、各保留原因计数、总耗时、最长单段同步耗时 |
| `media_recycle.sweep.would_delete` | info | 仅演练模式 |

`media_recycle.sweep.deferred` 与 `media_recycle.references.deferred` 今后只会出现在退出回收超时。

---

## 6. 仍被引用的候选：不做出口

不删除“仍被引用”的候选，保持现在的“挪到队尾”。

原因：文档不再引用某个文件时，不会产生新的候选。渲染层只有四处会主动入队（上传清理、编辑状态、缩略图、观察素材），画布删节点、剪辑删片段都不入队。文档持有的生成结果，唯一的回收意图就是回执交接时触发器留下的那一条；把它当成“已确认被长期引用”删掉，这个文件以后就永远没人回收。

前四步足以让队列收敛到“与真实媒体操作成比例”：

- 入队只剩确实带路径的改写和删除，约每月一千多条、一两 MB。
- 全是外部路径的候选（调用记录里的工程路径、音频任务里的缓存路径）第一轮跑完即删。
- `UPDATE` 载荷只含被释放的列（3.3），素材行改缩略图名这类改写不再留下“因为主文件仍在用而永远保留”的候选。
- 留下来的是“文件确实还有人用”的候选，上限是受管文件数（现在 `media_recycle_owned` 1,333 行），每条几百字节到 2 KB，每轮检查是一次集合查找。

如果以后日志里 `remaining` 持续上涨，再考虑把保留的候选压缩成只含仍被引用路径的 `paths` 候选；本次不做。

---

## 7. D5 实现要点（S4）

**缓存淘汰**：见第 2 节，不再另写。

**助手调用记录保留期**：在 [operationStore.ts](../../electron/main/services/application-runtime/operationStore.ts) 的 `pruneUiPaidReceipts` 旁新增 `pruneTerminalInvocations`，沿用同一个“每个自然日只跑一次”的闸门，并在 `recoverInterrupted` 里调用。删除条件全部满足才删：

- `state IN ('completed', 'not_executed', 'rolled_back')`。`unknown`、`partial` 与等待确认的记录属于待核对事实，不删。
- `updated_at < 现在 − 30 天`。
- 没有付费预留：`coalesce(json_array_length(record_json, '$.paidReservations'), 0) = 0`。带预留的记录（现在共 18 条）永久保留，每日额度统计（`generationSpendSince`）和跨天任务预留（`generationTaskReservations`）因此完全不受影响，“不碰当天付费记录”自然成立。
- 不是某条未决记录的 `recoveryOf` 指向的记录。

每次 256 行分批删，直到删不动。带路径的行会经触发器入队，外部路径的候选下一轮即被清掉。日志 `application.operations.pruned`（删除行数）。

**过期后的返回**：撤销引用不查这张表。`undo_application_changes` 用的是渲染层执行引擎内存里的撤销记录（[engine.ts:302-318](../../src/core/application-control/execution/engine.ts)），找不到时已经返回 `NOT_FOUND`“撤销引用不存在或已使用”，清理调用记录不影响它。受影响的是 `get_application_operation`：记录被清理后走 [applicationToolDispatcher.ts:171](../../electron/main/services/application-runtime/applicationToolDispatcher.ts) 的 `not_found` 分支，把文案改成“未找到已登记操作；超过 30 天的已完成记录会被清理。这不是业务未执行的证明。”同一 `operationId` 在 30 天后重放会被当成新操作，可接受。

**现状提醒**：表里最老的记录是 26 天前的，30 天保留期当前删除 0 行（7 天以上的有 2,323 行、30.7 MB）。是否缩短见 plan.md 的拍板点。

---

## 8. D4 实现要点（S5）

**每日快照**：从 `getDb()` 里拿掉。[db-recovery.ts](../../electron/main/services/db-recovery.ts) 的 `snapshotDatabase` 改为异步，用 better-sqlite3 的 `connection.backup(临时文件, { progress })`（分页拷贝，每个事件循环 100 页，期间库照常可写），完成后改名。它排在界面加载完成后的后台任务里、媒体回收之后执行。退出时如果备份还在进行：`progress` 回调里检查中止标记并抛错来终止，等 Promise 结束再 `closeDb()`；留下的 `.partial` 下次开始前会被删掉（现有逻辑）。在线备份不压缩空闲页，所以体积靠 4.2 的压缩保证。迁移前的 `backupDatabase`（`VACUUM INTO`）不动。日志 `db.snapshot.start` / `.completed` / `.failed`。

**保留策略**：保留最近 3 份，再加“距今至少 7 天的快照里最新的一份”，共最多 4 份。库 55 MB 时约 220 MB，现在是 7 份 1.1 GB。

**启动自检**：库文件不超过 64 MB 时维持现状（打开时同步 `quick_check`）。超过时启动只做打开与版本检查，界面加载完成后在 Worker 线程里用独立只读连接跑 `quick_check`（写法参照 `media-recycle/file-scanner.ts` 的内联 Worker，用 `createRequire` 解析 better-sqlite3）。未通过时：记 `db.verify.failed`，在程序目录写标记文件 `henji.db.verify-failed`，弹对话框提示“数据库自检未通过，重启后会自动恢复到最近的备份”。下次启动见到标记就强制同步自检，走现有的隔离与换快照流程；自检通过后删除标记。S2 之后真实库约 55 MB，在阈值以下，这条后台路径是给以后变大的库准备的。

**忙等待**：better-sqlite3 的 `timeout` 选项默认就是 5000 毫秒，现在已经是等 5 秒而不是立即报忙。只需把 `new Database(getHenjiDbPath(), { timeout: 5000 })` 写明，行为不变。

---

## 9. 实现拆分

每步一个提交，按 plan.md 的依赖顺序。

### S1 缓存搬出设置表

- 改：新增 `electron/main/services/media/derived-records.ts`；`electron/main/ipc/media-cache.ts`、`src/platform/contracts/mediaCache.ts`、`electron/preload/index.ts`、`electron/preload/api-desktop.d.ts`、`src/platform/adapters/electron/` 下的 mediaCache 适配；`videoEditCodeMetadataCache.ts`、`videoEditRenderPerformance.ts`；`src/core/persistence/formats.ts` 的排除说明。
- 验证：`npx tsc -p tsconfig.json --noEmit`、`npx tsc -p tsconfig.electron.json --noEmit`、`npm run check:ipc-contract`、`npm run check:main-imports`；开发版打开一个含代码素材的剪辑工程后，只读查询 `SELECT count(*) FROM settings WHERE key LIKE 'cache.video-edit.%'` 不再增长，缓存文件夹 `analysis/code-metadata/` 下出现 `.json`。
- 迁移与样本：无。

### S2 触发器条件、清存量、压缩

- 改：`media-recycle/schema.ts`（条件生成函数、`guardMediaRecycleOutboxV27`）、`db-migrations.ts`（第 27 项）、`src/core/persistence/schemaVersions.ts`、`db.ts`（压缩）、`scripts/generate-persistence-fixtures.ts` 与 `tests/fixtures/persistence/sqlite/v27.json`、`schemaBaseline.json`、`releasedCompatibility.json`。
- 验证：`npm run test:assistant-persistence -- electron/main/services/media-recycle/persistence.native.test.ts`、`npm run test:assistant-persistence -- electron/main/services/db-migrations.native.test.ts`、`npm run check:persistence-compat`、`npm run check:media-recycle`、两份 `tsc`。把真实资料目录的 `henji.db` 复制到临时目录，用脚本对副本执行迁移与压缩，核对候选行数与文件大小（不启动应用、不碰真实目录）。日志事件：`db.migrations.apply.completed`（version 27）、`db.compact.completed`。
- 迁移与样本：需要。SQLite 账本 26 → 27，新增 `sqlite/v27.json`。

### S3a 后台回收实现（未接线）

- 改：`media-recycle/` 下的 `lifecycle.ts`、`runtime.ts`、`collector.ts`、`store.ts`、`providers.ts`、`file-scanner.ts`、`queue.ts` 及各自测试；`media-import/index.ts`、`image/path-utils.ts`、`ai-runtime/media-store.ts`、`protocol.ts` 的声明调用点。`index.ts` 暂时保留启动阻塞（`startup()` 留到 S3b 删）。
- 验证：`npx vitest run electron/main/services/media-recycle/collector.test.ts electron/main/services/media-recycle/lifecycle.test.ts electron/main/services/media-recycle/runtime.test.ts electron/main/services/media-recycle/store.test.ts electron/main/services/media-recycle/providers.test.ts electron/main/services/media-recycle/file-scanner.test.ts`、`npm run test:assistant-persistence -- electron/main/services/media-recycle/persistence.native.test.ts`、`npm run check:media-recycle`、`npx tsc -p tsconfig.electron.json --noEmit`。
- 迁移与样本：无。

### S3b 接线并移除启动阻塞

- 改：`electron/main/index.ts`、`electron/main/window.ts`（注释）、`media-recycle/lifecycle.ts`（删 `startup`）、`lifecycle.test.ts`、`scripts/check-media-recycle.cjs` 与 `scripts/check-media-recycle.test.cjs`；`test:reality` 的 `restart` 套件加一个回收场景。
- 验证：`node --test scripts/check-media-recycle.test.cjs`、`npm run check:media-recycle`、`npx vitest run electron/main/application-shutdown.test.ts electron/main/services/media-recycle/lifecycle.test.ts`；`npm run electron:bundle` 后 `npm run test:reality -- --suite restart --only <回收场景>`（结论依赖主进程启动生命周期，精确测试证明不了）。真实资料目录：设置 `HENJI_MEDIA_RECYCLE_DRY_RUN=1` 启动一次，`npm run logs:query` 查 `media_recycle.sweep.would_delete` 与 `media_recycle.background.completed`，清单交用户过目；确认后去掉开关再启动一次。对比改动前后 `crash_reporter.start.completed` 到 `window.renderer.load_completed` 的间隔。
- 迁移与样本：无。

### S4 调用记录保留期

- 改：`application-runtime/operationStore.ts` 及其测试、`applicationToolDispatcher.ts`（文案）。
- 验证：operationStore 的精确 vitest、`npx tsc -p tsconfig.electron.json --noEmit`；日志 `application.operations.pruned`。
- 迁移与样本：无。

### S5 快照、自检

- 改：`db.ts`、`db-recovery.ts`、`db-recovery.native.test.ts`、`electron/main/index.ts`（后台任务顺序：回收 → 快照；退出时等待）。
- 验证：`npm run test:assistant-persistence -- electron/main/services/db-recovery.native.test.ts`、两份 `tsc`；启动日志里 `db.snapshot.completed` 出现在 `window.renderer.load_completed` 之后。
- 迁移与样本：无。

---

## 10. 测试

只写 [testing.md](../../docs/rules/testing.md) 第三节认可的风险（数据完整性、迁移、调度与取消、金额与配额）。

| 步骤 | 文件 | 用例 | 保护什么 |
|---|---|---|---|
| S2 | `persistence.native.test.ts`（新增 1 个） | 第 26 项的库里放入带路径与不带路径的候选、缓存设置行；迁移后只剩带路径的候选，缓存行消失；随后 1 万次不含路径的设置改写与调用记录状态改写不增加候选；改写一条带路径的历史记录的 `result_paths` 会入队且载荷只含该列 | 迁移与触发器同源、不漏不多 |
| S3a | `persistence.native.test.ts`（新增 1 个，替换现有“跨重启”用例里依赖启动阻塞的部分） | 真实 SQLite 与磁盘：静止点之前入队且无人引用的文件被删；静止点之后被删除的历史行所引用的文件保留；静止点之后入队的候选不处理；有引用文件在静止点之后被改写时整轮不删 | 5.5 的核心论证 |
| S3a | `collector.test.ts`（新增 1 个） | 判定前的等待期间来了一条占用声明，文件不被删除 | 5.4 末段的先后顺序 |
| S3a / S3b | `lifecycle.test.ts`（改写现有 3 个里的 2 个） | 后台轮一次运行只跑一次；退出先中止后台轮并等待结束，再按“窗口全部保存关闭”决定是否做退出回收 | 调度、取消 |
| S3b | `scripts/check-media-recycle.test.cjs`（补正反例） | 启动接线检查 | 门禁自身 |
| S4 | operationStore 测试（新增 1 个） | 超期终态且无预留的记录被删；当天记录、带预留记录、`unknown` / `partial` / 待确认记录保留；清理前后 `generationSpendSince` 结果相同 | 金额与配额、数据完整性 |
| S5 | `db-recovery.native.test.ts`（改写“每天最多一份快照”用例，新增 1 个） | 在线备份得到可独立打开的完整库、保留策略为“最近 3 份加一份周前”；带标记文件时打开损坏库会走恢复 | 损坏恢复 |

S1 不写新测试：纯读写路径替换，由类型检查、IPC 契约门禁和真实运行覆盖。压缩步骤不单独写测试，在 S2 的真实库副本演练里核对。

---

## 11. 与审查文档不一致的地方（以代码与数据为准）

1. **D1“22:04:23.026 才进入清扫”**：`media_recycle.sweep.start` 是数据库各表引用读取的开始，不是候选清扫的开始。`media_recycle.references.completed` 两天里 0 次，候选清扫一次都没开始过。2.3 秒只是文档扫描，数据库各表的读取在剩下的时间里也没做完。
2. **D1“启动/退出各 3 秒”**：22 次全部是启动回收。退出回收两天里没有任何日志（`media_recycle.exit.completed` 0 次）。
3. **D4“13 次带窗口启动”**：按 `media_recycle.references.start` 计，两天里带窗口启动是 22 次（11-08 七次、11-09 十五次）。
4. **D1“迁移前系统会自动备份数据库”**：只有迁移声明了 `backupWhen` 且返回真才备份（[db-migrations.ts:262-265](../../electron/main/services/db-migrations.ts)）。本设计不声明。
5. **D1“预计能去掉 99% 以上的存量”**：按不漏判的条件是去掉 89% 的行、95% 的字节（剩 1,727 行 / 5.2 MB）。剩下的多数在第一轮跑完后离开。
6. **D1“每条 19.5 KB”**：19.5 KB 是代码素材参数缓存的单条最大值，平均 5.1 KB，现存合计 6.6 MB。设置来源的 70.6 MB 候选主要来自 127 KB 的性能记录被反复改写。
7. **D1 第 2 步“旧行里出现了受管媒体根目录的位置前缀才入队”**：做不到不漏。库里同时有 `henji://user/…`、未换算的绝对路径、程序目录绝对路径三种写法，归属还要经 `realpath` 判断。本设计改用“有任何路径样字符串”。
8. **D1 第 4 步“引用普查的结果在同一次运行内可以复用”“用户开始操作文档时暂停”**：`store.ts` 的休眠集合只是跳过已判定仍被引用的候选，不是普查结果的缓存；本设计一次运行只跑一轮，不需要暂停。
9. **D1 第 5 步“文档自己的删除或改写会重新产生候选”**：不会。文档保存与删除都不入队，渲染层只有四处主动入队。所以不能删“仍被引用”的候选。
10. **D4“没有设置 busy_timeout，另一个进程持有写锁时会立即报忙”**：better-sqlite3 的 `timeout` 默认 5000 毫秒（`node_modules/better-sqlite3/lib/database.js:34`），现在就是等 5 秒。
11. **D5“撤销引用如果指向已清理的记录”**：撤销引用查的是渲染层执行引擎内存里的记录，不查 `application_invocations`，本来就返回明确的“不存在或已使用”。受清理影响的是 `get_application_operation`。
12. **D5“一个月攒下来的”与 30 天保留期**：最老的调用记录是 26 天前的，30 天保留期当前删除 0 行。
13. **t192 文档的受管范围表**列了四个根，代码里是五个（多了作品目录下的 `录音`）。
14. **`settings` 候选解不出未完成录音**：`recordReferences` 对 `audio_capture.pending_files` 的特殊处理要看 `raw.key`，但触发器载荷里没有 `key` 列，这段逻辑对候选从不生效（对引用普查生效）。录音文件由 `audio-capture/files.ts` 在完成时显式入队，所以没有漏回收，本次不改。
15. **已入索引的文档是不可缺失的扫描根**：索引里有一条指向已被外部删除的文档时，文档扫描直接报错，整轮回收失败，直到索引刷新把它清掉。这是现有行为，本设计的时序 5 依赖它；它也意味着有登记的外部位置离线时回收不会运行。
