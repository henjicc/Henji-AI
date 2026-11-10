# 44 媒体回收后台化：设计（第二版）

范围与顺序见同目录 plan.md。本文只写决定与事实。数字取自 2026-11-10 07:35 对真实资料目录 `henji.db` 的只读查询（`mode=ro`）与 11-08、11-09 两天日志。第二版按独立审查的意见修订，调度者已定的事项直接写成决定。

目录：

1. 现状事实
2. 缓存搬出设置表（S1）
3. 触发器入队条件（S2）
4. 清存量迁移与压缩（S2）
5. 后台回收（G 与 S3，核心）
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

以 [locationCodec.ts](../../src/core/storage/locationCodec.ts) 与真实数据为准，库里并存三种写法：

1. 相对作品目录：`henji://user/<相对路径>`（正斜杠，如 `henji://user/上传素材/ab….png`）。
2. 相对项目：`henji://project/<项目ID>/…`。
3. 绝对路径：程序目录内的路径（`Thumbnails`、`EditStates`）本来就不换算；不经位置换算的写入方也原样存绝对路径，作品目录内外都有——显式入队的 `paths` 候选全部是 `E:\文档\痕迹AI\上传素材\…`，`application_invocations.record_json` 里有 `D:/…`、`D:\\…` 和未换算的 `E:\\文档\\痕迹AI\\项目\\…`。

回收端读取候选与引用时，凡是以盘符、斜杠、`file:`、`henji:`、`henji-media:` 开头的字符串值或对象键都算引用（[mediaReferences.ts:17](../../src/core/media/mediaReferences.ts)），再经 `realpath` 归一后与受管根比较。

受管根有五个（[queue.ts:8-11](../../electron/main/services/media-recycle/queue.ts)）：作品目录下的 `录音`、生成结果、上传素材，程序目录下的 `Thumbnails`、`EditStates`。

### 1.4 现有“不会错删”靠什么

- 引用只取持久状态：十张表、磁盘上的文档与文档包、已保存的会话状态、图片编辑工作副本、最近删除的副本、主进程租约。渲染层内存不参与（[lifecycle.ts:6-7](../../electron/main/services/media-recycle/lifecycle.ts)）。
- 启动回收发生在界面加载之前（[window.ts:221-235](../../electron/main/window.ts)），此时没有任何渲染层内存，持久状态就是全部引用。退出回收要求所有窗口经保存确认后关闭。
- 普查与删除之间数据库有任何写入就整轮作废（`revision()` 取 `total_changes()`，[store.ts:63](../../electron/main/services/media-recycle/store.ts)）。
- 只有登记过创建身份的文件（`media_recycle_owned`）才可能被删；身份对不上、没登记的一律保留。
- 删除有后路：作品目录内的文件走 `trashUserFile`（[recycle/runtime.ts:65-68](../../electron/main/services/recycle/runtime.ts)），先在“最近删除”留副本（保留 30 天），再进系统回收站；`Thumbnails` 与 `EditStates` 直接 `fs.rm`，没有后路。
- `trashUserFile` 不是一步完成的：进串行队列 → 把整份文件复制到“最近删除” → 写一条 `recycled_items` → `shell.trashItem`。中间有多次等待，大文件要几秒。

---

## 2. 缓存搬出设置表（S1）

### 2.1 决定

两类缓存都改成文件，不新建数据表。理由：留在库里会跟着每日快照与迁移备份复制；性能记录播放时每 5 秒整份改写（127 KB），会不断写进 WAL；项目里已有“可重建缓存的唯一位置与管理入口”（[media-cache.ts](../../electron/main/services/media/media-cache.ts) 的 `MediaCacheManager`），总量上限、按最久未用清理、保留天数和设置里的“清理缓存”都现成。

| 缓存 | 现在 | 改为 | 键 | 上限与淘汰 |
|---|---|---|---|---|
| 代码素材参数缓存 | `settings` 的 `cache.video-edit.code-metadata.v1:<sha256>`，1,291 行，共 6.6 MB，单条平均 5.1 KB、最大 19.5 KB | `getMediaCacheManager().createCache('analysis', 'code-metadata', { extension: '.json', budgetBytes: 32 MB, pruneIntervalMs: 60_000 })`，位于作品目录的缓存文件夹 | 沿用现有 64 位十六进制摘要（去掉前缀） | 本类 32 MB 封顶、读命中刷新使用时间、超出按最久未用删除；同时受缓存总上限与保留天数约束；用户可在设置里清理 |
| 渲染性能提示记录 | `settings` 的 `cache.video-edit.render-performance.shown`，1 行 127 KB | 程序目录下单个文件 `video-edit-render-performance.json`，用现有 `fs/json-file.ts` 原子读写 | 无（整份） | 沿用渲染层现有的 256 段、30 天上限；它是本机观测，不跟作品目录走 |

### 2.2 接口

- 主进程：新增 `electron/main/services/media/derived-records.ts`，导出 `readCodeMetadata(key)`、`writeCodeMetadata(key, text)`、`readRenderPerformance()`、`writeRenderPerformance(text)`。键不匹配 `^[0-9a-f]{64}$` 直接拒绝。缓存停用（读不到作品目录）时读返回空、写不做事。
- IPC：在现有 [ipc/media-cache.ts](../../electron/main/ipc/media-cache.ts) 与 [contracts/mediaCache.ts](../../src/platform/contracts/mediaCache.ts) 增加四个通道，preload 与 `src/platform/adapters/electron` 照现有 `mediaCache` 的写法补齐。
- 渲染层：[videoEditCodeMetadataCache.ts](../../src/features/videoEdit/application/videoEditCodeMetadataCache.ts) 与 [videoEditRenderPerformance.ts](../../src/features/videoEdit/application/videoEditRenderPerformance.ts) 把 `getPlatform().settings.get/set` 换成 `getPlatform().mediaCache.*`；内容校验（`{ json, hash }` 信封、zod 校验）不变。`videoEditRenderPerformance.ts` 里清理旧键的 `LEGACY_KEYS` 逻辑删除，由 S2 的迁移一次清掉。
- 现有的 `videoEditCodeMetadataCache.test.ts` 与 `videoEditRenderPerformance.test.ts` 模拟的是 `settings`，随本步一起改成模拟 `mediaCache`。

### 2.3 旧条目

不搬内容。S1 之后旧行不再被读写；S2 的迁移删除它们。代价是每个代码素材首次用到时重新读一次源码算参数。

### 2.4 登记

[formats.ts](../../src/core/persistence/formats.ts) 的 `PERSISTENCE_EXCLUSIONS` 里 `video-edit-render-cache` 一项的读入口补上新文件；代码素材参数缓存新增一条排除说明（可由源码重算）。两者都不是持久格式，不升版本。

---

## 3. 触发器入队条件（S2）

### 3.1 判断什么

不按“受管根前缀”判断，按“旧行里是否有任何路径样字符串”判断。原因：

1. 库里三种写法并存（1.3），作品目录还可能被用户更换，触发器是静态 SQL，写不进一个随设置变化的前缀。
2. 受管根的归属要经 `realpath` 才能确定（目录联接别名），文本前缀会漏。
3. 这个条件与回收端提取引用的规则是同一组起始前缀，是它的超集；在 15,655 条真实候选上逐条比对，回收端能提取出引用而条件判否的为 0 条。
4. 它已经挡掉 89% 的行、95% 的字节；放进来但其实都是外部路径的候选，第一轮跑完就被 `forget` 删掉。

漏判的后果是漏回收（文件留在磁盘上），不会造成错删：第 5 节的保护不依赖触发器。

### 3.2 条件怎么写

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

账本第 27 项，名称 `media_recycle_guarded_outbox`，默认事务内执行，函数 `guardMediaRecycleOutboxV27` 放在 `media-recycle/schema.ts`。

第 27 项自带一份冻结的条件生成函数与表清单（`…V27`，做法同 `createMediaRecycleTablesV21`）：同一次迁移里的“清存量”与“建触发器”调用这一份，保证两者同源；以后的迁移不得复用或修改它，需要改条件时在新迁移里另写一份。`createMediaRecycleTablesV21` 与 `MEDIA_REFERENCE_TABLES` 不改。步骤：

1. 删除十张表的 `media_recycle_<表>_update` 与 `media_recycle_<表>_delete` 触发器。
2. 删除设置表里的缓存旧行：`key GLOB 'cache.video-edit.code-metadata.v1:*'`、`cache.video-edit.render-performance.shown`，以及 `cache.video-edit.render-performance.v1` 到 `v6`（带与不带 `.shown`）。此时没有触发器，不会产生候选。
3. 清候选：对每个来源执行 `DELETE FROM media_recycle_candidates WHERE source = '<表>' AND NOT coalesce(<持有条件>, 0)`，列取 `json_extract(payload, '$.<列>')`。`source = 'paths'` 与不认识的来源不动。
4. 按 3.3 重建带条件的触发器，列取 `OLD.<列>`。

不声明 `backupWhen`。删掉的是不含任何路径的回收意图和可重建缓存，不是用户数据；整库备份一次 160 MB，`backups/` 没有保留策略。每日快照仍在。

版本登记：`SQLITE_SCHEMA_VERSION` 26 → 27（`SCHEMA_MIGRATIONS` 里原来用常量的第 26 项改写成字面量 26，新项用常量）；`SETTING_RECORD_VERSION` 等独立内容版本不动（设置记录的结构没变）。按 [persistence.md](../../docs/rules/persistence.md) 生成 `tests/fixtures/persistence/sqlite/v27.json`，跑 `npm run persistence:baseline` 与 `npm run persistence:release-snapshot`。

在真实库上的预期：候选 15,655 → 约 1,727 行，104.6 MB → 约 5.2 MB。条件求值加删除约 10 秒（只读实测条件求值约 8 秒，`settings` 来源占 5 秒），只发生一次，在窗口出现之前。这 10 秒接受。

### 4.2 压缩

迁移只把页面还给空闲链表，文件大小不变。压缩不放进迁移、也不在打开数据库时同步做，放到界面加载完成之后的后台任务里（顺序见 5.9）：

- 条件：`freelist_count * page_size ≥ 32 MB` 且占文件 25% 以上；没有其他进程占用标记（5.5）。
- 动作：`VACUUM` → `INSERT INTO history_fts(history_fts) VALUES('rebuild')` → `wal_checkpoint(TRUNCATE)`。`history` 的主键是文本 `id`，`VACUUM` 可能重排它的行号，全文索引按行号对应，所以要重建。
- `VACUUM` 是同步调用，真实库上预计让界面停顿约 1 秒，只在首次升级后发生一次。
- 日志 `db.compact.start` / `db.compact.completed`（带前后字节数与耗时）/ `db.compact.failed`。失败（报忙）只记警告，下次启动条件仍成立会再试。

真实库预期从 166 MB 降到约 55 MB（其中调用记录 33 MB、音频任务 9.9 MB）。压缩排在每日快照之前，快照随之变小。

---

## 5. 后台回收（G 与 S3）

### 5.1 选定方案

**启动静止点快照**：在界面加载前只做一件毫秒级的事——记下这一刻（下称 P0）并固定住数据库在这一刻的读视图；界面加载完成后，后台用 P0 的视图做引用普查并逐个删除。后台这一轮只处理 P0 之前已经入队的候选，只删“P0 那一刻没有任何持久引用”的文件；删除的最后一步之前再过一道同步守卫。

它保留了现有设计的前提，只是换了取证方式：现有设计在 P0 当场把普查做完；新设计在 P0 当场把证据固定下来，稍后再读。

### 5.2 P0 的证据怎么固定

| 持久状态 | 固定方式 | 不成立时 |
|---|---|---|
| 数据库（十张登记表、候选表、`media_recycle_owned`、`media_recycle_retained`、作品索引、外部位置） | P0 时另开一个只读连接，`BEGIN` 后执行一次查询。WAL 模式下这个读事务看到的一直是 P0 的内容，主连接照常写。普查的引用读取都走它 | 连接打不开：本次运行不做后台轮 |
| 磁盘上的引用文件（文档、文档包、会话状态、有历史记录的编辑状态、图片编辑工作副本、最近删除副本） | 扫描线程对每个解析过的文件，**在同一个句柄上读完内容之后**再取 `fstat` 的修改时间。文档包现在是另用路径打开的（`yauzl.open`），改为 `yauzl.fromFd(句柄, { autoClose: false })`，条目读完后在同一句柄上 `fstat`。任何一个修改时间落在 `[P0 − 2 秒, 取值时刻 + 2 秒]` 内，就说明它在本次运行里被写过 | 整轮放弃 |
| 程序目录里三类可缺失的扫描根：会话状态目录树、图片编辑工作副本目录树、`EditStates` 目录 | 这三类里的文件被删除后修改时间无从检测。扫描线程对遍历到的每一级目录（含 `EditStates` 目录本身）也取修改时间，按同一区间判断。目录的修改时间在其中有文件新建、删除、改名时变化 | 整轮放弃 |
| 脱离索引的位置（`detached-documents` 提供者对每个登记位置各扫一次） | 与主扫描共用同一个证据累加器：修改时间、目录修改时间、网络根都计入 | 整轮放弃 |
| 最近删除的副本集合 | 扫描开始时用主连接读一次 `recycled_items` 的文件类条目作基线（启动清理和用户打开列表都会在 P0 之后删过期条目，所以不以 P0 为基线），扫描结束后再读一次比较 | 不一致：整轮放弃 |
| 扫描根的位置 | 任一扫描根的 `realpath` 是网络路径时，修改时间来自服务器时钟，不可比。映射盘符与 UNC 同样对待：以 `realpath` 的结果判断（实现时用一条映射盘实测能否还原成 UNC，不能就另取盘符类型） | 整轮放弃 |

关于区间：只看 `[P0 − 2 秒, 取值时刻 + 2 秒]`。时间戳远在未来的文件不可能是本次运行按本机时钟写出来的，不算变化，只记一条调试日志，避免一份时间戳错误的文件让回收永久停摆。

关于第三行的取舍：会话状态只在文档进回收站、删空草稿、从列表移除时整夹删除，那时会话已经结束；`EditStates` 在受管根内，通用文件接口对它只入队不删（[system.ts:152-157](../../electron/main/services/system.ts)）。这两类能论证“被删时界面内存里不会再留着引用”。图片编辑工作副本论证不了，所以三类统一按目录修改时间判断，不逐类开例外。

判断时机：所有提供者（含 `detached-documents`）读完之后、检查第一个候选之前统一判一次。“整轮放弃”= 不删任何文件、候选原样保留、记 `media_recycle.background.skipped` 与原因。本次运行不重试，等下次启动或退出回收。

### 5.3 一轮的流程

1. **界面加载前**（`beforeRendererLoad`，同步，不 `await`）：`quietAt = Date.now()`；开只读连接并 `BEGIN`；读 `max(id)`、`count(*)` 得到 `horizon` 与候选数。候选数为 0 就关连接、结束。之后照常注册服务、加载界面。
2. **界面加载完成后**（主窗口 `did-finish-load`，且启动时那次 `purgeRecycledItems` 已结束）：开始后台轮，全程一个 `AbortController`。先查其他进程的占用标记（5.5），有就放弃。
3. 文档扫描（Worker 线程，现有 `scanReferenceFiles`）：扫描根清单取自快照。得到引用集合与 5.2 的证据。
4. 交接：`releaseDocumentSubmissionReferences` 维持现状，读写都在主连接上，不改成读快照。
5. 数据库引用读取：十张表与 `media_recycle_retained` 从快照连接读，每页 32 行让出一次事件循环。
6. 关闭快照连接。按 5.2 统一判断，不成立则放弃。
7. 逐个候选检查并删除：只读 `id ≤ horizon` 的候选。条件见 5.4。
8. 记 `media_recycle.background.completed`。本次运行不再有第二轮。

时限：

- 后台轮开始前等待超过 120 秒（界面一直没加载完）就关快照连接并放弃。
- 整轮总时限 10 分钟，从第 2 步算起。超时即中止、释放读事务、记 `media_recycle.background.skipped`（`reason: 'time-limit'`，带当时 `henji.db-wal` 的字节数）。`media_recycle.background.completed` 也带 WAL 字节数。
- 应用退出：先发中止并同步关闭快照连接，最多等后台轮 3 秒；没结束也继续退出，不拖住。后台轮在退出时仍在运行的，这次不再做退出回收。中止后守卫（5.4）一律判否，正在复制的那一份副本被丢弃，不再有文件被移走，也不再访问数据库。
- 更换作品目录：`ipc/work-root.ts` 的 `change` 处理在调用移动之前先 `await mediaRecycleLifecycle.stopBackground()`（同样是中止加最多 3 秒等待）。不用忙碌探针：探针会让用户在最长 10 分钟里一直被拒绝。

### 5.4 后台轮删除一个文件的全部条件

普查阶段：

1. 它所在的候选在 P0 之前入队（`id ≤ horizon`）。本次运行新入队的候选一律留给下次。
2. 它不在 P0 引用集合里（5.2 的证据全部成立）。沿用现有判定：路径本身、`media_recycle_owned.source_path`、派生来源、候选的 `protectedBy`，任何一个被引用都保留。
3. 文件身份（设备、inode、大小、修改时间、创建时间）与 P0 快照里 `media_recycle_owned` 记录的一致，且在受管根内、不是链接。

删除的最后一步之前，**同步守卫**：

4. 守卫是一个不含等待的函数，返回“可以删”才继续。它依次检查：后台轮没有被中止；没有其他进程的占用标记（5.5）；没有尚未完成路径归一的占用声明（有就判否）；这个文件的路径、来源、派生来源、`protectedBy` 都不在主进程当前的租约与占用声明里（5.6）。

守卫放在哪：

- 作品目录内的文件：`trashUserFile` 增加一个可选的守卫参数并返回是否真的删了。它内部改成：复制副本（可能几秒）→ **守卫 → 写 `recycled_items` → 调用 `shell.trashItem`**，后三步在同一个函数体里连续执行，中间没有 `await`。守卫判否时只删掉刚复制的副本，不写库、不移走原件。
- `Thumbnails` 与 `EditStates`：守卫之后紧接着调用 `fs.rm`，同样没有 `await`。这两类没有后路，守卫是它们唯一的最后一道检查。

守卫判否的文件记为保留原因 `claimed`，候选挪到队尾，下次运行再看。第一版里的“声明版本号加重来一遍”不再需要，已删去。

退出回收也传守卫（只查占用标记与租约；那时没有界面，不看声明）。

### 5.5 跨进程守卫（G）

单实例锁（D2）只管带窗口的主应用。助手命令行（`assistant:cli`）与 `--verify-model` 走 [index.ts](../../electron/main/index.ts) 的独立分支，有意与主应用并存；命令行还自带隐藏界面，它的未保存引用和占用声明只在自己进程里，主应用看不见。

机制：

- **标记文件**：`<程序目录>/process-holders/<pid>-<uuid>.lock`，内容是 `pid uuid`。这两种模式在 `app.whenReady` 一开始、打开数据库之前取得，进程存活期间每 10 秒更新一次修改时间，正常退出时删除。实现直接复用 [fs/file-lock.ts](../../electron/main/services/fs/file-lock.ts) 的 `withFileLock`（独占创建、心跳、退出清理都现成），每个进程用自己的文件名，所以互不争抢。
- **检查**：主应用用一个同步函数列出该目录（文件很少），除去自己的，逐个判断是否仍被占用。
- **陈旧标记怎么识别**（异常退出不会删标记）：心跳在 30 秒内，算占用；否则看进程号——进程还在且心跳在 24 小时内，算占用；其余算陈旧，顺手删掉。读目录或读文件出错（目录不存在除外）一律算占用。这条规则偏向“不删”：进程号被别的程序复用时回收最多多停 24 小时；机器休眠醒来时心跳虽然旧但进程还在，仍算占用。
- **在哪里查**：后台轮开始前、普查结束后、每个文件的同步守卫里；压缩（4.2）之前；退出回收的守卫里。发现占用就整轮放弃，记 `reason: 'other-process'`。

### 5.6 占用声明

`queue.ts` 增加同步的 `claimManagedMedia(path)` 与进程内集合。声明用本次运行缓存的受管根做前缀判断，不调用 `getUserFolderDir`（它每次同步建目录，媒体协议是热路径）；原始路径立即入集合，`realpath` 归一后的键异步补上，补完之前守卫判否。集合只增不减，进程退出即清空。

原则：主进程把受管根内的一个路径交给调用方、或替调用方读写它，就要声明。全仓核对后的调用点：

| # | 位置 | 说明 |
|---|---|---|
| 1 | `queue.ts` `registerOwnedMedia` 入口 | 覆盖所有新建与覆盖写入 |
| 2 | [media-import/index.ts](../../electron/main/services/media-import/index.ts) 约 357-359 行 | “以引用方式导入”直接把源路径当命中返回。从资源管理器把受管目录里的文件拖进来、助手用 `import_local_media` 传受管路径都走这里 |
| 3 | 同文件三处内容寻址命中（约 153、165、177 行） | 命中已有文件、不走 `registerOwnedMedia` |
| 4 | [asset-library/thumbnailService.ts](../../electron/main/services/asset-library/thumbnailService.ts) `writeThumbnail`（约 86-104 行） | 缩略图已存在时直接返回、不登记；缩略图是 `fs.rm` 直接删的 |
| 5 | [image/path-utils.ts](../../electron/main/services/image/path-utils.ts) `persistContentAddressedImage` 的“文件已存在”分支 | 相同内容再次上传 |
| 6 | [ai-runtime/media-store.ts](../../electron/main/services/ai-runtime/media-store.ts) 的 `EEXIST` 分支 | 相同结果再次下载 |
| 7 | [system.ts](../../electron/main/services/system.ts) `ensureValidPath` | 通用文件接口的每个入口都先调它，一处覆盖全部读写。其中按位置写入的分支（约 96-106 行）在 `registerOwnedMedia` 之前就返回，这是自查找到的第三处 |
| 8 | [protocol.ts:221](../../electron/main/protocol.ts) `handleMediaRequest` 解析出本地路径后 | 界面显示任何受管文件 |
| 9 | 文档保存时位置换算报告里的引用（`encodeDocumentContent` 的 `report.references`） | 文档带着某个路径存盘 |

不需要声明的（文件里写 `media-recycle-claim: <理由>` 注释）：`ai-runtime/media-conform.ts`、`video/ops.ts`、`video/frame-export.ts`、`screen-recording/capture/service.ts`、`web-replay/store.ts` 的产物虽在上传素材目录里，但从不登记创建身份，回收器删不了；`asset-library/index.ts` 的 `thumbnailPathFor` 只是把库里已有的行拼成路径，来源是持久状态；`media-import/probe.ts` 的封面走 `writeOwnedMediaPreview`，命中时也会 `registerOwnedMedia`。

门禁（`scripts/check-media-recycle.cjs` 新增）：

- `electron/main` 下凡是提到受管根的文件（现有 `owners` 正则，补上 `getUserFolderDir('uploads' | 'generated')` 与 `录音`），必须出现 `claimManagedMedia(` 或 `registerOwnedMedia(`，否则要有一条不少于 16 个字的 `media-recycle-claim:` 注释说明为什么不需要。
- 固定检查：`protocol.ts`、`system.ts` 的 `ensureValidPath`、`media-import/index.ts` 的引用导入分支里有声明调用。

### 5.7 为什么不会错删

要证明：满足 5.4 的文件 F，在删除时既不被持久状态引用，也不在任何内存里。

- 界面内存里的受管路径只有三个来源：读到的持久状态、主进程写入方返回的路径、应用外部给的路径（资源管理器拖入、文件对话框、助手从目录列表里读到）。
- F 不在 P0 的持久状态里（条件 2）。本次运行的界面是 P0 之后才加载的，所以它从持久状态里读不到 F。P0 之后持久状态里新增的引用，也只能来自上面三个来源。
- 主进程写入方返回 F、界面把 F 交给主进程读写或显示、文档带着 F 存盘，都会留下声明；守卫在移走文件前的最后一刻检查（条件 4）。
- 其他进程的内存：带窗口的第二个实例由 D2 挡住；命令行与模型验证进程由占用标记挡住。
- P0 之后持久状态被改写、删除的那些引用：它们在 P0 时还在，所以在 P0 引用集合里，F 不可能是它们指向的文件。这就是不再需要 `total_changes()` 整轮作废的原因——后台轮的 `revision` 传常量。

### 5.8 可能错删的时序，逐一排除

| # | 时序 | 排除方式 |
|---|---|---|
| 1 | 文档里有素材 U（已保存）。用户打开文档、删掉节点、自动保存；撤销栈在内存里仍有 U。U 有一条以前留下的候选 | U 在 P0 的文档内容里。若文档在扫描前被保存，它的修改时间落在区间内，整轮放弃；若扫描在保存之前读到它，U 在引用集合里 |
| 2 | 用户把一条历史记录的结果图拖进画布（未保存），随即删除这条历史 | 历史行在 P0 快照里，结果图在引用集合里。删除历史产生的新候选 `id > horizon`，本轮不处理 |
| 3 | 生成完成，结果只在未保存的文档里，租约已释放并入队 | 文件是本次运行新建的：候选 `id > horizon`；`registerOwnedMedia` 留有声明 |
| 4 | 用户昨天移除了一张上传图（有候选，文件还在），今天启动后马上再次上传同一张图，内容寻址命中同一路径 | 命中分支留下声明（调用点 3、5）。若文件先被外部删掉再重建，身份与 P0 记录不符 |
| 5 | 用户从资源管理器把“生成结果”里一个待回收的文件拖进画布，或助手用 `import_local_media` 传它的路径 | 引用导入分支留下声明（调用点 2）；随后显示、存盘还会再声明 |
| 6 | 素材库的缩略图有候选，主文件重新入库后直接复用已有缩略图 | `writeThumbnail` 的已存在分支留下声明（调用点 4） |
| 7 | 判定通过后、文件复制到“最近删除”的几秒里，界面拿到并用上了这个文件 | 守卫在复制完成之后、移走之前执行，命中就丢弃副本不删 |
| 8 | 助手命令行进程正在运行，它的隐藏界面里有未保存的引用 | 占用标记：后台轮开始前、普查后、每次守卫都查，存在就放弃 |
| 9 | 用户在扫描进行中重命名或移动文档、改项目名 | 已入索引的文档各自是一个不可缺失的扫描根：旧路径不在了扫描报错，整轮失败不删。根清单取自 P0 快照，必须保持“不可缺失” |
| 10 | 用户在扫描进行中从“最近删除”恢复一份文档（副本被移走、目标是新文件） | 副本集合在扫描前后不一致，整轮放弃。恢复发生在扫描开始之前则无妨：恢复出的文档在作品目录里，会被扫到 |
| 11 | 会话状态、编辑状态、图片编辑工作副本在 P0 之后被删除，界面内存里仍留着它们带来的引用 | 这三类目录的修改时间落在区间内，整轮放弃 |
| 12 | 脱离索引位置里的文档在 P0 之后被改写 | 这些扫描与主扫描共用证据累加器，同样触发放弃 |
| 13 | 上次未完成的生成任务在启动时恢复：回执行被标记已交接、同时插入历史行，两张表先后被读到 | 两张表都读自同一个 P0 快照，交接发生在 P0 之后，快照里回执仍持有 |
| 14 | 文件正在被读，读到一半被就地改写 | 修改时间在同一句柄上、读完之后才取 |
| 15 | 后台轮进行中用户退出应用或更换作品目录 | 先中止；中止后守卫判否，不再有文件被移走 |
| 16 | 界面崩溃后自动重载；macOS 关掉最后一个窗口后再开 | 重载只会让内存里的引用更少；P0 只在进程的第一个窗口加载前取一次，一次运行只有一轮 |
| 17 | 文档所在磁盘离线、外部位置不可读、链接无法解析 | 现有行为不变：扫描失败整轮不删，或保护全部已登记文件 |
| 18 | 后台轮跑得很久，读事务一直挡着 WAL 截断 | 10 分钟总时限，超时放弃并释放 |

### 5.9 被否的方案

| 方案 | 否决理由 |
|---|---|
| 渲染层上报打开中文档的实时引用 | t192 做过又删掉。每一个持有方（各类文档、撤销栈、参数面板、助手附件、剪贴板）都得完整、同步地上报，漏一个就是错删；快照与删除之间还有先后问题。主进程无法验证上报是否完整 |
| 只在没有文档会话打开时推进 | 文档会话登记表只在渲染层，主进程要新增一条“用于放行删除”的上报通道并信任它；参数面板等非文档持有方不在会话里；每次打开关闭都要重做普查；相同内容再上传的问题仍要另外解决 |
| 沿用 `total_changes()` 整轮作废，直接搬到后台 | 运行中的应用一直在写库（设置、调用记录），永远跑不完；而且它管不到文档文件的改写 |
| 缩短或加长启动时限 | 加长就继续挡界面；缩短则普查本身（2.3 秒起）都做不完 |
| 只靠退出回收并放宽时限 | 两天日志里退出回收 0 次；放宽会拖住进程退出，接上单实例锁后用户马上重开会没反应 |
| 用主进程钩子标记“本次运行写过文档”来代替修改时间 | 写引用文件的入口分散（文档仓库、会话状态、图片编辑工作副本、渲染层经通用文件接口写编辑状态），漏挂一个钩子就是错删，且看不到并行的命令行进程。修改时间是对被扫描文件的直接观察 |
| 判定后直接调用现有 `trashUserFile` | 它在真正移走文件之前要排队、复制，判定早已过期 |

### 5.10 代码改动

跨进程守卫（G）：

- `fs/file-lock.ts`：导出同步的占用判断（规则见 5.5）。
- 新增 `media-recycle/process-holders.ts`：`holdProcessMarker()`（命令行与模型验证模式用）与 `hasOtherProcessHolders()`。
- `index.ts`：两个独立分支在 `getDb()` 之前取得标记。

后台回收（S3）：

- `lifecycle.ts`：删除 `startup()` 与 `'starting'` 阶段。新增 `prepareBackground(capture)`（界面加载前同步调用一次）、`runBackground(pass)`（一次运行只生效一次，持有 `AbortController` 与 10 分钟时限）、`stopBackground()`（中止并最多等 3 秒）。`exit()` 开头先 `stopBackground()`；后台轮当时仍在运行则返回 `'skipped'`，否则按原条件执行。
- `runtime.ts`：新增 `captureMediaRecycleQuietPoint()` 与 `runBackgroundMediaRecycle(quiet, signal)`；现有 `runMediaRecycle` 只给退出用。删除适配器把守卫传给 `trashUserFile`，缓存类文件在 `fs.rm` 前调用守卫。
- `recycle/runtime.ts`：`trashUserFile` 增加守卫参数、返回布尔值，内部顺序按 5.4；`preserveFile` 拆成“复制”与“登记”两段。其他调用方不传守卫，行为不变。
- `collector.ts`：`trashItem` 的返回值表示是否真的删了；未删记 `claimed`。`MediaCollectorOptions` 增加提供者读完后的统一校验回调，校验不过按“放弃”收口并记原因。
- `store.ts`：`createRecycleStore` 增加可选的 `horizon` 与 `owned` 来源。
- `providers.ts`：`collectSqlReferences`、`collectDocumentReferences` 增加可选的数据库参数与证据累加器；`collectDocumentReferences` 在扫描前后比较最近删除副本集合。`releaseDocumentSubmissionReferences` 不改。
- `file-scanner.ts`：按 5.2 取文件与目录的修改时间、扫描根的 `realpath`，随完成消息返回；文档包改用 `yauzl.fromFd`。
- `queue.ts`：占用声明；5.6 表中各调用点。
- `index.ts`：`beforeRendererLoad` 里把 `await mediaRecycleLifecycle.startup(runMediaRecycle)` 换成同步的 `prepareBackground`；主窗口 `did-finish-load` 后依次执行：后台回收 → 压缩（4.2）→ 每日快照（S5）。命令行与模型验证模式不调用。
- `ipc/work-root.ts`：`change` 之前 `stopBackground()`。
- `window.ts`：`beforeRendererLoad` 上方的注释改写为现在的含义。
- `scripts/check-media-recycle.cjs`：5.6 的两条门禁；启动接线检查——`index.ts` 必须调用 `prepareBackground`，不得再出现 `mediaRecycleLifecycle.startup(`。

演练模式：删除适配器读 `HENJI_MEDIA_RECYCLE_DRY_RUN`，为 `1` 时守卫照常执行，但不复制、不删、不 `forget`，只记 `media_recycle.sweep.would_delete`（路径与字节数）。它只为首轮上线前核对清单而存在：S3 实现时带着，调度者核对完清单后，在同一个任务里把这段代码和环境变量删掉，不留在正式代码里。

### 5.11 分片与日志

- 文档扫描在 Worker；主线程每个文件只做一次引用换算。数据库引用读取每页 32 行。候选检查每个候选让出一次（现有）。
- 不做“用户操作时暂停”：安全性不依赖时机。
- 日志（域 `main.media_recycle`）：

| 事件 | 级别 | 内容 |
|---|---|---|
| `media_recycle.background.scheduled` | info | 候选数、`horizon` |
| `media_recycle.background.skipped` | info / warn | `reason`：`no-candidates`、`other-process`、`reference-files-changed`（带最新文件所在的扫描根类别）、`session-files-removed`、`recycle-backups-changed`、`network-root`、`snapshot-expired`、`time-limit`（带 WAL 字节数）、`aborted` |
| `media_recycle.references.start` / `.completed` | info | 现有，`.completed` 带引用数与耗时 |
| `media_recycle.sweep.start` / `.completed` / `.failed` | info / warn | 现有 |
| `media_recycle.background.completed` | info | 删除数、回收字节、剩余候选、各保留原因计数（含 `claimed`）、总耗时、最长单段同步耗时、WAL 字节数 |
| `media_recycle.sweep.would_delete` | info | 仅演练模式 |

`media_recycle.sweep.deferred` 与 `media_recycle.references.deferred` 今后只会出现在退出回收超时。

### 5.12 残余风险

- **R1 外部路径复用**：一个待回收文件的路径从应用外部进到界面内存，在主进程第一次经手它（导入、读写、显示、存盘）之前就被判定并移走。调用点 2、7、8、9 之后，这个窗口只剩“路径在内存里、还没用过”的那一瞬。作品目录内的文件 30 天内可从“最近删除”恢复；缩略图与编辑状态没有后路，但它们可重建。
- **R2 时钟**：修改时间规则依赖本机时钟。运行中系统时间被往回调、或文件系统不更新修改时间时，可能把本次运行的改写看成旧内容。已留 2 秒余量；网络路径直接放弃。
- **R3 提供者之外的持有方**：不在引用提供者清单里的持久存储（例如渲染层本地存储里记的路径）现有设计同样不保护。回收以前从未真正删过文件，这类盲区会在第一次真实删除时才暴露。缓解：S3 先演练，人工过一遍清单。
- **R4 应用之外的改动**：别的程序在扫描过程中移动、改写文档，或另一台机器经同步盘改文件，不在保证范围内（原有边界）。
- **R5 只影响“删不删得动”**：占用标记的进程号被复用、某份文档每次启动都被别的程序改写时间戳，会让回收一直放弃。日志里有原因。

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

**助手调用记录保留期：14 天。** 在 [operationStore.ts](../../electron/main/services/application-runtime/operationStore.ts) 的 `pruneUiPaidReceipts` 旁新增 `pruneTerminalInvocations`，沿用同一个“每个自然日只跑一次”的闸门，并在 `recoverInterrupted` 里调用。删除条件全部满足才删：

- `state IN ('completed', 'not_executed', 'rolled_back')`。`unknown`、`partial` 与等待确认的记录属于待核对事实，不删。
- `updated_at < 现在 − 14 天`。
- 没有付费预留：`coalesce(json_array_length(record_json, '$.paidReservations'), 0) = 0`。带预留的记录（现在共 18 条）永久保留，每日额度统计（`generationSpendSince`）和跨天任务预留（`generationTaskReservations`）因此完全不受影响，“不碰当天付费记录”自然成立。
- 不是某条未决记录的 `recoveryOf` 指向的记录。

每次 256 行分批删，直到删不动。日志 `application.operations.pruned`（删除行数）。按当前数据，满足全部条件的有 825 行、12.8 MB（全表 2,922 行、33.2 MB；最老的 26 天），清理后这张表约 20 MB。

**对媒体回收的影响**：调用记录是引用提供者之一。记录被清理后，只被这些记录引用的受管文件（例如助手导入后从未用进历史或文档的上传副本）就不再有持有方；带路径的行删除时会经触发器入队，下一次运行的后台轮会把它们回收。这是预期行为，但上线前要知道数量：S3 的演练轮额外输出一个数——把 `application_invocations` 提供者按“全部行”和“清理后会留下的行”各读一次，统计“只在前者里、且不被其他任何提供者引用”的已登记受管文件数与字节数（`heldOnlyByPrunableInvocations`）。所以 S4 排在 S3 的演练之后合入；这段统计随演练代码一起删除。

**过期后的返回**：撤销引用不查这张表。`undo_application_changes` 用的是渲染层执行引擎内存里的撤销记录（[engine.ts:302-318](../../src/core/application-control/execution/engine.ts)），找不到时已经返回 `NOT_FOUND`“撤销引用不存在或已使用”，清理调用记录不影响它。受影响的是 `get_application_operation`：记录被清理后走 [applicationToolDispatcher.ts:171](../../electron/main/services/application-runtime/applicationToolDispatcher.ts) 的 `not_found` 分支，把文案改成“未找到已登记操作；超过 14 天的已完成记录会被清理。这不是业务未执行的证明。”同一 `operationId` 在 14 天后重放会被当成新操作，可接受。

---

## 8. D4 实现要点（S5）

**每日快照**：从 `getDb()` 里拿掉。[db-recovery.ts](../../electron/main/services/db-recovery.ts) 的 `snapshotDatabase` 改为异步，用 better-sqlite3 的 `connection.backup(临时文件, { progress })`（分页拷贝，默认每个事件循环 100 页，期间库照常可写），完成后改名。它排在界面加载完成后的后台任务里，在媒体回收与压缩之后。退出时如果备份还在进行：`progress` 回调里检查中止标记并抛错来终止，等 Promise 结束再 `closeDb()`；留下的 `.partial` 下次开始前会被删掉（现有逻辑）。在线备份不压缩空闲页，体积靠 4.2 的压缩保证。迁移前的 `backupDatabase`（`VACUUM INTO`）不动。日志 `db.snapshot.start` / `.completed` / `.failed`。

**保留策略**：保留最近 3 份，再加“距今至少 7 天的快照里最新的一份”，共最多 4 份。库 55 MB 时约 220 MB，现在是 7 份 1.1 GB。

**启动自检**：保持现在的做法——打开时同步 `quick_check`。S2 之后库约 55 MB，自检耗时回到可接受范围；不做“大库放后台自检”那一套（Worker、标记文件、对话框）。

**忙等待**：better-sqlite3 的 `timeout` 选项默认就是 5000 毫秒，现在已经是等 5 秒而不是立即报忙。只需把 `new Database(getHenjiDbPath(), { timeout: 5000 })` 写明，行为不变。

---

## 9. 实现拆分

每步一个提交。顺序：S1 → S2 → D2（单实例锁，另一任务）→ G → S3 → S4；S5 在 S2 之后任意时候做。

### S1 缓存搬出设置表

- 改：新增 `electron/main/services/media/derived-records.ts`；`electron/main/ipc/media-cache.ts`、`src/platform/contracts/mediaCache.ts`、`electron/preload/index.ts`、`electron/preload/api-desktop.d.ts`、`src/platform/adapters/electron/` 下的 mediaCache 适配；`videoEditCodeMetadataCache.ts`、`videoEditRenderPerformance.ts` 及两者现有的测试文件；`src/core/persistence/formats.ts` 的排除说明。
- 验证：`npx vitest run src/features/videoEdit/application/videoEditCodeMetadataCache.test.ts src/features/videoEdit/application/videoEditRenderPerformance.test.ts`、`npx tsc -p tsconfig.json --noEmit`、`npx tsc -p tsconfig.electron.json --noEmit`、`npm run check:ipc-contract`、`npm run check:main-imports`；开发版打开一个含代码素材的剪辑工程后，只读查询 `SELECT count(*) FROM settings WHERE key LIKE 'cache.video-edit.%'` 不再增长，缓存文件夹 `analysis/code-metadata/` 下出现 `.json`。
- 迁移与样本：无。

### S2 触发器条件、清存量、压缩

- 改：`media-recycle/schema.ts`（冻结的 `…V27` 条件函数与 `guardMediaRecycleOutboxV27`）、`db-migrations.ts`（第 27 项）、`src/core/persistence/schemaVersions.ts`、`db.ts`（导出压缩函数）、`index.ts`（界面加载完成后调用压缩）、`scripts/generate-persistence-fixtures.ts` 与 `tests/fixtures/persistence/sqlite/v27.json`、`schemaBaseline.json`、`releasedCompatibility.json`。
- 验证：`npm run test:assistant-persistence -- electron/main/services/media-recycle/persistence.native.test.ts`、`npm run test:assistant-persistence -- electron/main/services/db-migrations.native.test.ts`、`npm run check:persistence-compat`、`npm run check:media-recycle`、两份 `tsc`。把真实资料目录的 `henji.db` 复制到临时目录，用脚本对副本执行迁移与压缩，核对候选行数、文件大小、全文检索结果（不启动应用、不碰真实目录）。日志事件：`db.migrations.apply.completed`（version 27）、`db.compact.completed`。
- 迁移与样本：需要。SQLite 账本 26 → 27，新增 `sqlite/v27.json`。

### G 跨进程守卫

- 改：`fs/file-lock.ts`、新增 `media-recycle/process-holders.ts` 及测试、`index.ts`（两个独立分支）。此时还没有消费方，单独合入无行为变化。
- 验证：`process-holders` 的精确 vitest、`npx tsc -p tsconfig.electron.json --noEmit`；跑一次真实的命令行任务（`npm run assistant:cli -- --goal "列出项目"`），期间程序目录 `process-holders/` 下有标记，结束后消失。
- 迁移与样本：无。

### S3 后台回收（实现与接线一个提交）

- 前置：D2 与 G 已合入。
- 改：5.10 列出的全部文件。
- 验证：`npx vitest run electron/main/services/media-recycle/collector.test.ts electron/main/services/media-recycle/lifecycle.test.ts electron/main/services/media-recycle/runtime.test.ts electron/main/services/media-recycle/store.test.ts electron/main/services/media-recycle/providers.test.ts electron/main/services/media-recycle/file-scanner.test.ts electron/main/application-shutdown.test.ts`、`npm run test:assistant-persistence -- electron/main/services/media-recycle/persistence.native.test.ts`、`npm run test:assistant-persistence -- electron/main/services/recycle/runtime.native.test.ts`、`node --test scripts/check-media-recycle.test.cjs`、`npm run check:media-recycle`、两份 `tsc`；`npm run electron:bundle` 后 `npm run test:reality -- --suite restart --only <回收场景>`（结论依赖主进程启动生命周期，精确测试证明不了）。
- 上线：真实资料目录设置 `HENJI_MEDIA_RECYCLE_DRY_RUN=1` 启动一次，`npm run logs:query` 查 `media_recycle.sweep.would_delete` 与 `media_recycle.background.completed`（含 `heldOnlyByPrunableInvocations`），清单交调度者核对；核对完删除演练代码，再启动一次看真实结果。对比改动前后 `crash_reporter.start.completed` 到 `window.renderer.load_completed` 的间隔。
- 迁移与样本：无。

### S4 调用记录保留期

- 前置：S3 的演练已给出受影响文件数。
- 改：`application-runtime/operationStore.ts` 及其测试、`applicationToolDispatcher.ts`（文案）。
- 验证：operationStore 的精确 vitest、`npx tsc -p tsconfig.electron.json --noEmit`；日志 `application.operations.pruned`。
- 迁移与样本：无。

### S5 快照

- 改：`db.ts`、`db-recovery.ts`、`db-recovery.native.test.ts`、`electron/main/index.ts`（后台任务顺序与退出等待）。
- 验证：`npm run test:assistant-persistence -- electron/main/services/db-recovery.native.test.ts`、两份 `tsc`；启动日志里 `db.snapshot.completed` 出现在 `window.renderer.load_completed` 之后。
- 迁移与样本：无。

---

## 10. 测试

只写 [testing.md](../../docs/rules/testing.md) 第三节认可的风险（数据完整性、迁移、调度与取消、金额与配额）。

| 步骤 | 文件 | 用例 | 保护什么 |
|---|---|---|---|
| S1 | 两个现有测试文件（改写，不新增） | 读写改走 `mediaCache` 后原有断言继续成立 | 既有行为 |
| S2 | `persistence.native.test.ts`（新增 1 个） | 第 26 项的库里放入带路径与不带路径的候选、缓存设置行；迁移后只剩带路径的候选，缓存行消失；随后 1 万次不含路径的设置改写与调用记录状态改写不增加候选；改写一条带路径的历史记录的 `result_paths` 会入队且载荷只含该列 | 迁移与触发器同源、不漏不多 |
| S2 | `db-migrations.native.test.ts` 或同类原生测试（新增 1 个） | 库里有若干历史记录，压缩前后用同一组关键词检索，结果一致 | 压缩不破坏全文索引 |
| G | `process-holders` 测试（新增 1 个） | 心跳新鲜算占用；进程不在且心跳过期算陈旧并被清掉；进程在但心跳旧于 30 秒仍算占用 | 跨进程判断偏向不删 |
| S3 | `persistence.native.test.ts`（新增 1 个，替换现有“跨重启”用例里依赖启动阻塞的部分） | 真实 SQLite 与磁盘：静止点之前入队且无人引用的文件被删；静止点之后被删除的历史行所引用的文件保留；静止点之后入队的候选不处理；有引用文件或会话状态目录在静止点之后变过时整轮不删；脱离索引位置里的文件变过同样不删 | 5.7 的核心论证 |
| S3 | `recycle/runtime.native.test.ts`（新增 1 个） | 复制副本期间来了一条占用声明：原件没被移走、副本被删、没有留下 `recycled_items` 行 | 守卫的位置 |
| S3 | `lifecycle.test.ts`（改写现有 3 个里的 2 个） | 后台轮一次运行只跑一次；退出与更换作品目录先中止并最多等 3 秒；到总时限会中止并释放快照 | 调度、取消 |
| S3 | `file-scanner.test.ts`（新增 1 个） | 文档包与普通文档都返回读完后的修改时间；未来时间戳不算变化 | 证据本身 |
| S3 | `scripts/check-media-recycle.test.cjs`（补正反例） | 声明门禁与启动接线检查 | 门禁自身 |
| S4 | operationStore 测试（新增 1 个） | 超期终态且无预留的记录被删；当天记录、带预留记录、`unknown` / `partial` / 待确认记录保留；清理前后 `generationSpendSince` 结果相同 | 金额与配额、数据完整性 |
| S5 | `db-recovery.native.test.ts`（改写“每天最多一份快照”用例） | 在线备份得到可独立打开的完整库、保留策略为“最近 3 份加一份周前” | 损坏恢复 |

---

## 11. 与审查文档不一致的地方（以代码与数据为准）

1. **D1“22:04:23.026 才进入清扫”**：`media_recycle.sweep.start` 是数据库各表引用读取的开始，不是候选清扫的开始。`media_recycle.references.completed` 两天里 0 次，候选清扫一次都没开始过。2.3 秒只是文档扫描，数据库各表的读取在剩下的时间里也没做完。
2. **D1“启动/退出各 3 秒”**：22 次全部是启动回收。退出回收两天里没有任何日志（`media_recycle.exit.completed` 0 次）。
3. **D4“13 次带窗口启动”**：按 `media_recycle.references.start` 计，两天里带窗口启动是 22 次（11-08 七次、11-09 十五次）。
4. **D1“迁移前系统会自动备份数据库”**：只有迁移声明了 `backupWhen` 且返回真才备份（[db-migrations.ts:262-265](../../electron/main/services/db-migrations.ts)）。本设计不声明。
5. **D1“预计能去掉 99% 以上的存量”**：按不漏判的条件是去掉 89% 的行、95% 的字节（剩 1,727 行 / 5.2 MB）。剩下的多数在第一轮跑完后离开。
6. **D1“每条 19.5 KB”**：19.5 KB 是代码素材参数缓存的单条最大值，平均 5.1 KB，现存合计 6.6 MB。设置来源的 70.6 MB 候选主要来自 127 KB 的性能记录被反复改写。
7. **D1 第 2 步“旧行里出现了受管媒体根目录的位置前缀才入队”**：做不到不漏。库里三种写法并存（1.3），归属还要经 `realpath` 判断。本设计改用“有任何路径样字符串”。
8. **D1 第 4 步“引用普查的结果在同一次运行内可以复用”“用户开始操作文档时暂停”**：`store.ts` 的休眠集合只是跳过已判定仍被引用的候选，不是普查结果的缓存；本设计一次运行只跑一轮，不需要暂停。
9. **D1 第 5 步“文档自己的删除或改写会重新产生候选”**：不会。文档保存与删除都不入队，渲染层只有四处主动入队。所以不能删“仍被引用”的候选。
10. **D4“没有设置 busy_timeout，另一个进程持有写锁时会立即报忙”**：better-sqlite3 的 `timeout` 默认 5000 毫秒（`node_modules/better-sqlite3/lib/database.js:34`），现在就是等 5 秒。
11. **D5“撤销引用如果指向已清理的记录”**：撤销引用查的是渲染层执行引擎内存里的记录，不查 `application_invocations`，本来就返回明确的“不存在或已使用”。受清理影响的是 `get_application_operation`。
12. **D5“一个月攒下来的”**：最老的调用记录是 26 天前的。
13. **t192 文档的受管范围表**列了四个根，代码里是五个（多了作品目录下的 `录音`）。
14. **`settings` 候选解不出未完成录音**：`recordReferences` 对 `audio_capture.pending_files` 的特殊处理要看 `raw.key`，但触发器载荷里没有 `key` 列，这段逻辑对候选从不生效（对引用普查生效）。录音文件由 `audio-capture/files.ts` 在完成时显式入队，所以没有漏回收，本次不改。
15. **已入索引的文档是不可缺失的扫描根**：索引里有一条指向已被外部删除的文档时，文档扫描直接报错，整轮回收失败，直到索引刷新把它清掉。这是现有行为，本设计的时序 9 依赖它；它也意味着有登记的外部位置离线时回收不会运行。
16. **`--verify-model` 没有界面**：它在 [index.ts:219-222](../../electron/main/index.ts) 直接返回，不创建窗口，`verify-model.ts` 里也没有；自带隐藏界面的只有助手命令行。它同样会打开数据库，所以占用标记两种模式都持有，规则不分开。
