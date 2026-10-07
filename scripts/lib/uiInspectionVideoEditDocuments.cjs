const fs = require('node:fs')
const path = require('node:path')

/*
 * 剪辑巡检场景的数据与入口（3.1 剪辑接入）：剪辑是项目里的文档文件（`.henji-video`，统一文档外壳），
 * 不再有“打开项目文件 / 另存为”。场景经正式文档接口（preload `henjiNative.documents`）造数据，
 * 在剪辑页（项目列表）点项目卡片打开，读文件核对保存结果。
 */

const button = (page, name) => page.getByRole('button', { name, exact: true })

/** 工具栏“导入”只展开菜单；选择“导入文件”才经过正式文件选择与导入链路。 */
async function chooseVideoEditImportFiles(page) {
  await button(page, '导入').click()
  await button(page, '导入文件').click()
}

/*
 * 旧场景之间靠缓存目录里的 `.henji-video` 夹具串联（上游场景保存的结果是下游场景的夹具）。
 * 现在剪辑存在作品目录的项目里：openVideoEditFile 第一次打开某个夹具文件时经正式接口造一个项目，
 * 记下“夹具文件 → 实际剪辑文件”；之后按夹具路径读取都读实际剪辑文件，并把结果按旧形状写回夹具文件，
 * 下游场景（同一进程或之后单独运行）照旧从夹具文件取上游保存的状态。
 */
const linked = new Map()

function linkKey(file) {
  return path.resolve(file).toLowerCase()
}

/** 读剪辑文件：文档外壳按旧剪辑工程的形状返回（内容平铺，项目内相对写法换回绝对路径）。夹具路径读它对应的实际剪辑。 */
function readVideoEditFile(file) {
  const link = linked.get(linkKey(file))
  if (link) {
    const current = readVideoEditFile(link.file)
    const text = JSON.stringify(current)
    if (text !== link.mirrored) { fs.writeFileSync(file, text); link.mirrored = text }
    return current
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (raw?.format !== 'henji-document') return raw
  const projectRoot = path.dirname(file)
  // 作品目录 = 项目所在的“项目”文件夹的上一级（只对作品目录里的项目有意义）
  const workRoot = path.dirname(path.dirname(projectRoot))
  const decode = (value) => {
    if (typeof value === 'string') {
      if (value.startsWith('henji:/') && !value.startsWith('henji://')) return path.join(projectRoot, ...value.slice('henji:/'.length).split('/'))
      if (value.startsWith('henji://user/')) return path.join(workRoot, ...value.slice('henji://user/'.length).split('/'))
      return value
    }
    if (Array.isArray(value)) return value.map(decode)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]))
    return value
  }
  return { format: 'henji-video-project', version: 2, id: raw.id, name: raw.name, revision: raw.revision, ...decode(raw.content) }
}

/**
 * 经正式文档接口建一个项目并放进一份剪辑（已命名、非草稿，登记为主剪辑），沿用夹具的剪辑 ID。
 * fixture 是旧剪辑工程形状（format / version / name / revision 由文档外壳表达，这里只取内容）。
 * 同名项目已存在时（同一隔离资料目录里重复运行）自动加时间后缀。返回文档 ID、剪辑文件与项目位置。
 */
async function seedVideoEditProject(page, fixture, options = {}) {
  const { format: _format, version: _version, id, name, revision: _revision, _root, ...content } = fixture
  const projectName = options.projectName ?? name
  return await page.evaluate(async ({ id, projectName, content }) => {
    const documents = window.henjiNative?.documents
    if (!documents) throw new Error('documents preload 不可用')
    const describe = async (meta) => {
      const project = (await documents.listProjects({ includeDrafts: true })).find((item) => meta.container.kind === 'project' && item.id === meta.container.projectId)
      return { projectId: project.id, projectPath: project.path, documentId: meta.id, file: meta.path, name: meta.name }
    }
    // 沿用夹具的剪辑 ID（场景用它组装引用）；同一资料目录里已有这份剪辑时用正式保存接口整份覆盖内容
    if (id) {
      const existing = (await documents.listDocuments({ kind: 'video_edit', includeDrafts: true, includeMissing: false })).find((item) => item.id === id)
      if (existing) {
        await documents.saveDocument({ target: { id }, expectedRevision: existing.revision, content, force: true })
        return await describe((await documents.readDocument({ id })).meta)
      }
    }
    const create = async (candidate) => {
      const project = await documents.createProject({ name: candidate })
      const created = await documents.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: project.id }, name: candidate, content, ...(id ? { id } : {}) })
      await documents.setProjectMainDocument({ projectId: project.id, documentId: created.meta.id })
      return { projectId: project.id, projectPath: project.path, documentId: created.meta.id, file: created.meta.path, name: candidate }
    }
    try {
      return await create(projectName)
    } catch (error) {
      if (!String(error?.message ?? error).includes('同名')) throw error
      return await create(`${projectName} ${Date.now()}`)
    }
  }, { id: typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null, projectName, content })
}

/** 回到剪辑页的项目列表（编辑器开着时先关闭，离开提示选 choice，默认“不保存”）。 */
async function showVideoEditProjects(page, choice = '不保存') {
  await button(page, '剪辑').first().click()
  if (await button(page, '关闭项目').isVisible().catch(() => false)) await leaveVideoEditProject(page, choice)
}

/** 关闭剪辑回到项目列表；草稿项目会询问“保存 / 不保存 / 取消”，按 choice 回答（null 表示不应询问）。 */
async function leaveVideoEditProject(page, choice = '不保存') {
  await button(page, '关闭项目').click()
  const prompt = page.getByRole('alertdialog')
  const appeared = await prompt.waitFor({ state: 'visible', timeout: 1500 }).then(() => true, () => false)
  if (appeared) {
    if (choice === null) throw new Error('已保存的项目离开时不应询问')
    await prompt.getByRole('button', { name: choice, exact: true }).click()
  }
  if (choice !== '取消') await button(page, '关闭项目').waitFor({ state: 'detached', timeout: 30000 })
}

/** 在剪辑页点开项目卡片（刚经接口建的项目不在已挂载的列表里时，切走再切回让页面重读）。 */
async function openVideoEditProjectCard(page, projectId) {
  await showVideoEditProjects(page)
  const card = page.locator(`[data-project-id="${projectId}"]:visible`).first()
  if (!await card.waitFor({ state: 'visible', timeout: 1500 }).then(() => true, () => false)) {
    await button(page, '生成').first().click()
    await button(page, '剪辑').first().click()
    await card.waitFor({ state: 'visible', timeout: 15000 })
  }
  await card.click()
  await button(page, '关闭项目').waitFor({ state: 'visible', timeout: 30000 })
}

/** 造数据并打开：等同“在剪辑页打开这个项目”。 */
async function openVideoEditFixture(page, fixture, options = {}) {
  const seeded = await seedVideoEditProject(page, fixture, options)
  await openVideoEditProjectCard(page, seeded.projectId)
  return seeded
}

/**
 * 打开缓存目录里的剪辑夹具（旧工程形状的 JSON）：第一次（或夹具文件被场景重写过）时经正式接口造项目，
 * 之后复用同一个项目。返回 { projectId, documentId, file, projectPath }；场景用 documentId 组装引用。
 */
async function openVideoEditFile(page, fixtureFile) {
  const key = linkKey(fixtureFile)
  const text = fs.readFileSync(fixtureFile, 'utf8')
  let link = linked.get(key)
  if (!link || text !== link.mirrored) {
    const seeded = await seedVideoEditProject(page, JSON.parse(text))
    link = { ...seeded, mirrored: text }
    linked.set(key, link)
  }
  await openVideoEditProjectCard(page, link.projectId)
  return link
}

/** 刚“新建项目”后打开的那份主剪辑（最新建的剪辑）。 */
async function latestVideoEditDocument(page) {
  return await page.evaluate(async () => {
    const documents = await window.henjiNative.documents.listDocuments({ kind: 'video_edit', includeDrafts: true, includeMissing: false })
    const latest = [...documents].sort((left, right) => right.createdAt - left.createdAt)[0]
    if (!latest) throw new Error('没有剪辑文档')
    const projectId = latest.container.kind === 'project' ? latest.container.projectId : null
    const project = (await window.henjiNative.documents.listProjects({ includeDrafts: true })).find((item) => item.id === projectId)
    return { documentId: latest.id, file: latest.path, projectId, projectPath: project?.path ?? null }
  })
}

/**
 * 场景点了“新建项目”之后：把新建的草稿项目当作用户已保存（经正式接口原名转正，离开时不再询问），
 * 并把旧场景的夹具路径接到这份剪辑上（之后按夹具路径读写、重新打开都是它）。
 */
async function adoptNewVideoEditProject(page, fixtureFile) {
  await button(page, '关闭项目').waitFor({ state: 'visible', timeout: 30000 })
  // 这些既有剪辑场景需要时间线；通过正式界面显式建立，并维持夹具约定的30帧。
  await button(page, '新建序列').click()
  await page.getByRole('dialog').waitFor({ state: 'visible' })
  await page.getByLabel('帧率', { exact: true }).selectOption('30/1')
  await button(page, '确定').click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  const latest = await latestVideoEditDocument(page)
  await page.evaluate(async ({ projectId }) => {
    const documents = window.henjiNative.documents
    const project = (await documents.listProjects({ includeDrafts: true })).find((item) => item.id === projectId)
    if (project?.draft) await documents.finalizeProject({ projectId, name: project.name })
  }, { projectId: latest.projectId })
  const link = { ...latest, mirrored: '' }
  linked.set(linkKey(fixtureFile), link)
  readVideoEditFile(fixtureFile)
  return link
}

/** 等剪辑文件里出现满足条件的内容（自动保存有防抖）。 */
async function savedVideoEdit(page, file, matches, message = '剪辑没有保存') {
  let current
  for (let attempt = 0; attempt < 300; attempt++) {
    current = fs.existsSync(file) ? readVideoEditFile(file) : null
    if (current && matches(current)) return current
    await page.waitForTimeout(100)
  }
  throw new Error(message)
}

module.exports = {
  adoptNewVideoEditProject,
  chooseVideoEditImportFiles,
  latestVideoEditDocument,
  leaveVideoEditProject,
  openVideoEditFile,
  openVideoEditFixture,
  openVideoEditProjectCard,
  readVideoEditFile,
  savedVideoEdit,
  seedVideoEditProject,
  showVideoEditProjects,
}
