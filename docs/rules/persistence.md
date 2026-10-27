# 持久格式与向后兼容

本规则覆盖升级软件后仍要读取的用户项目、文档、素材记录、代码资产、设置和自建预设。格式的唯一登记来源是 `src/core/persistence/formats.ts`，基线在同目录 `schemaBaseline.json`，发布承诺在 `releasedCompatibility.json`。可重建缓存和外部标准格式的排除理由也在登记表中，不以文件扩展名决定是否保护。

**2026-10-21 起正式启用向后兼容**：当时的全部格式版本是兼容起点（基线 `compatibilityStart`），此前开发期版本、迁移与样本已按用户决定清除。从此新版本必须能打开兼容起点之后写出的任何文件；`--dev-break` 永久停用。

## 什么是格式变更

新增、删除、重命名字段，字段类型、必填性、默认值、联合分支、未知字段策略、数值范围、枚举、单位、路径编码、数组元素结构、代码作者接口（apiVersion）、效果参数含义变化，都属于持久格式变更。仅改界面、临时运行状态或可重建缓存不属于本规则。文档外壳版本和文档类型内容版本分别管理，作品修订号与组件作品版本不能充当格式版本。

## 版本与最低可读版本

每个登记格式同时有 `version`（本程序写出的格式版本）和 `minReaderVersion`（能正确理解本程序写出文件的最低程序版本，记录在基线中）。

- **只新增可选字段**（旧程序忽略它也不会误解其余内容）：升 `version`，`minReaderVersion` 不变。
- **改变已有字段含义、单位、必填性，或删除旧程序依赖的字段**：升 `version`，并把 `minReaderVersion` 提高到新版本。
- `minReaderVersion` 只能不变或提高，不能高于 `version`；门禁核对二者与基线一致。

接入了版本戳的文件同时写出两者：文档外壳写 `envelopeVersion`/`minReaderVersion` 与 `kindVersion`/`kindMinReaderVersion`；项目说明、可编辑代码资产与版本化 JSON 容器写 `version`/`minReaderVersion`。读取规则统一在 `migrations.ts::upgradePersistenceContent`：

1. 文件版本低于当前：逐版本迁移到当前，再按当前 schema 校验。
2. 文件版本等于当前：直接校验。
3. 文件版本更新、且其 `minReaderVersion` ≤ 本程序版本：按当前 schema 打开，本程序不认识的字段记录下来（`forwardCompat.ts`），保存时放回原处并保留文件原有的版本戳；文档由主进程保存时以磁盘上的当前文件为准合并。
4. 文件版本更新、且没有 `minReaderVersion` 或其值高于本程序版本：报 `newer-version`（“由更新版本创建，请升级”），不打开，因而不会被覆盖保存。

未接入版本戳的格式（图片文档包、SQLite 记录、凭据与小型内部文件等）遇到更新版本一律按第 4 条拒绝。新增文件消费方或新格式时优先接入版本戳。

代码效果的每个版本记录作者宿主接口版本 `apiVersion`（登记为格式 `code-author-api`）。宿主接口今后变化时升 `apiVersion` 并让宿主按版本保持旧版本代码的原行为，不得让旧代码静默改变画面。

## 升版本和迁移

1. 先找登记表的读入口、权威 schema、版本来源和迁移入口，沿读写、导入导出与嵌套消费方检查完整影响。
2. 版本递增，不复用已经发布的版本。文档类型在 descriptor 的 `migrations` 登记；其他格式在 `formatMigrations.ts` 登记。键 `N` 只负责 `N → N+1`，禁止按最新格式写一个吞掉所有历史的 catch-all。
3. 通用执行器先检查完整链，再逐步调用，最后通过当前 schema。步骤是纯函数，不改原输入，不做 I/O；失败使用 `PersistenceError` 留下格式、版本步骤、字段路径与备份位置。任意自定义 refine、算法或单位语义不能完整反映在 JSON Schema 中，也必须主动升版本，并用关键字段断言验证，不能依赖指纹代替语义审查。
4. 文件升级由主进程存储适配器先备份到同目录 `.henji/backups/`（原文件已在 `.henji` 则用其中的 `backups/`）。复用内容寻址与现有独占发布原语；JSON 备份使用实际解析的文本快照，大包流式复制。localStorage 备份先写独立备份键，SQLite 使用现有 `schema_migrations` 事务账本，不另建账本。
5. 读到的升级结果只存在内存，第一次明确保存时才写当前版本，读取、索引扫描、Zustand hydration 不得顺带改写原件。备份失败则禁止开始升级；无法读取的库不得在后续保存中被空库覆盖。
6. 原始文本/字节导入只有内存值、没有原文件路径时，调用方负责保留输入；接入新的文件消费方时必须同时接入原文件备份边界，不能仅调用纯迁移函数后宣称文件升级受保护。

## 黄金样本和门禁

每种格式在 `tests/fixtures/persistence/<id>/v<N>.*` 保存真实样本。使用当前正式构造器、序列化器或导出器生成（`scripts/generate-persistence-fixtures.ts`、`scripts/generate-persistence-packages.ts`），不手写不存在的字段。样本最小但覆盖主要结构；剪辑包括代码文件引用、效果、关键帧、字幕、转场、全能调色。已发布样本不可修改或删除：新版本添加新样本，并验证所有受支持旧样本升级后的关键内容与当前 schema。包格式同时验证真实归档读入口。

`npm run check:persistence-compat` 使用 Zod 4 原生 JSON Schema 的输入/输出结构稳定排序后生成 SHA-256 指纹，不依赖源码文本。无版本变更的 schema 变化失败；新增格式需要基线；版本升级需要从兼容起点开始的完整迁移链与样本。完成精确迁移和读写测试后：

```bash
npm run persistence:baseline            # 登记新版本、指纹与 minReaderVersion
npm run persistence:release-snapshot    # 把新版本与样本摘要追加进发布承诺
```

检查脚本不自动修基线；`--dev-break` 与 `--waive-before` 已停用，脚本直接拒绝。`--restore-support` 只用于补迁移降低支持下限。发布承诺只追加：已发布的版本指纹、样本摘要与支持下限不可改写。CI 执行同一检查。

动态 JSON 扩展字段的内部语义、任意 refine 函数以及 SQLite DDL 不由结构指纹自动证明；应把稳定结构提升为正式 schema，或在既有 SQLite 账本中登记变更，并用原生/语义样本验证。未被 Zod JSON Schema 支持的类型直接失败，不允许静默跳过。

不得降版本、删除格式登记或静默丢弃用户字段；停用功能也必须保留可理解的读取、导出或恢复路径。

## 文件后缀

自有文件后缀只登记在 `src/core/fileExtensions.ts`，代码里不写后缀字面量，一律从登记表取（`henjiExtension`、`matchHenjiExtension`、`henjiDialogExtensions`）。规则由 `fileExtensions.test.ts` 检查：

- 格式为 `.hj` + 2～4 个小写字母（`.hjvid` 剪辑、`.hjaud` 口播、`.hjimg` 图片文档、`.hjcvs` 画布、`.hjstg` 镜头参考、`.hjrec` 屏幕录制、`.hjpak` 单文件包、`.hjsty` 风格包、`.hjpre` 剪辑预设、`.hjlyr` 图层包），不用杠、数字或大写，字母取常见英文缩写。
- 按用途分作品 / 交换包 / 素材库三类；新增文件类型先在表里登记，暂未实现的只占名（`reserved`）。
- 全表不重复，也不与常见软件的后缀冲突。
- 改后缀时原后缀进 `legacyExtensions`，只用于读取（扫描、打开、导入）；新文件一律写当前后缀，不主动改名旧文件。2026-10-24 统一命名前的 `.henji-*`、`.henjiimg` 等按此登记为旧后缀。
- 已发布黄金样本的文件名（如 `v1.henjipack`）与包内的格式标识（`henjiimg`、`henji-video-project` 等）不是后缀，不随改名变动。

## 错误表达

更新版本创建、早于支持下限、迁移失败、内容 schema 不匹配与 JSON 截断/无法解析分别处理。只有最后一类使用“损坏”；更新版本创建提示“请升级后再打开”。用户提示复用现有错误通道，文案放 i18n；字段路径、内部版本和格式 ID 只写结构化日志。迁移失败提示步骤、原文件未修改与备份位置，禁止吞错或静默重建。

## 剪辑代码 Git 存储

`code-git-location` v1 的编码为 `git:<40位小写提交OID>:<encodeURIComponent(仓库位置)>:<encodeURIComponent(POSIX仓库内路径)>`。运行时仓库位置为绝对路径，文档落盘时内层位置经既有 location codec 编码为 `henji:/代码` 或跨项目引用；外层不是文件系统路径。`hash` 仍为原始 UTF-8 字节的 SHA-256，含 BOM，不使用 Git SHA-1 替代它。Git 对象、索引及引用目录采用标准 Git 格式，已在登记表列为外部标准格式；不建立自有版本账本。

剪辑内容 v34、录制会话 v37、代码版本记录 v2、代码资产 v7 支持新位置语义并提高最低可读版本。纯格式迁移保留旧路径与哈希，只做内存升级；磁盘迁移必须走 `migrate_project_code_storage` → `DocumentOperations.migrateCodeStorage` → 正式 documents IPC/服务。旧版本源码、组件校验文件及撤回标记按版本号导入，先备份文档，保存读回成功且没有已知文档仍引用时，把旧目录原子归档到现有 `.henji/backups/`。含未知文件、被其他文档引用或无法安全检查的目录留在原处。失败保留已导入对象和旧文件，重跑复用相同标签并核验全部原文；导入早于当前最新版本的历史时，可追加恢复最新工作区的维护提交。

收集、跨容器复制及单文档包按固定版本重建目标仓库并改写引用；整项目包还保留完整历史和工作区。提交 OID 可随目标历史变化，内容 SHA-256 与版本号不变。可编辑代码资产仍携带自己的源码表，由正式导入操作在目标仓库发布，不能把源项目绝对位置当成可移植资产。
