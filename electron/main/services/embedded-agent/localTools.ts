import type { ToolDefinition } from '@earendil-works/pi-coding-agent'

type PiSdk = typeof import('@earendil-works/pi-coding-agent')

/**
 * 每条命令前加的定义。
 * 删除命令改为移进系统回收站：这是“删除用户数据先进回收区”在本机命令上的落点。PowerShell 里 rm、del、ri、rd、rmdir、erase
 * 都是 Remove-Item 的别名，别名按名字解析到同名函数，一个函数全部接住；参数与管道绑定照系统原版（管道来的文件按字面路径），
 * 非文件系统的路径（注册表、环境变量）照原样交给系统命令。
 * 系统在进不了回收站时会静默永久删除（网络盘与移动盘、回收站关掉、超出回收站容量），所以先查，进不了就报错不删。
 * 只加载系统自带程序集，不现场编译代码：安全软件把隐藏窗口里的编译与系统接口调用当成可疑行为。
 * henji-node 用应用自带的 Node 运行脚本，用户没装 Node 也能跑扩展；应用程序是图形界面程序，经管道才会等它结束并拿到输出与退出码。
 */
const POWERSHELL_PREFIX = String.raw`$global:HenjiRecycleBins = @{}
function global:Get-HenjiRecycleBin($root) {
  if ($global:HenjiRecycleBins.ContainsKey($root)) { return $global:HenjiRecycleBins[$root] }
  $drive = try { [System.IO.DriveInfo]::new($root) } catch { $null }
  $bin = if (-not $drive -or $drive.DriveType -ne 'Fixed') { @{ Refusal = "$root 不是本机硬盘，没有回收站" } } else {
    $volume = Get-CimInstance Win32_Volume -Filter ("DriveLetter='" + $root.Substring(0, 2) + "'") -ErrorAction SilentlyContinue
    $guid = if ($volume) { [regex]::Match($volume.DeviceID, '\{[^}]+\}').Value } else { '' }
    $policy = if ($guid) { Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\$guid" -ErrorAction SilentlyContinue } else { $null }
    if ($policy -and $policy.NukeOnDelete -eq 1) { @{ Refusal = "$root 的回收站已关闭" } }
    else { @{ Capacity = $(if ($policy -and $policy.MaxCapacity) { [int64]$policy.MaxCapacity * 1MB } else { [int64]($drive.TotalSize * 0.05) }) } }
  }
  $global:HenjiRecycleBins[$root] = $bin
  return $bin
}
function global:Move-HenjiToRecycleBin($item) {
  $bin = Get-HenjiRecycleBin ([System.IO.Path]::GetPathRoot($item.FullName))
  if ($bin.Refusal) { return $bin.Refusal }
  $files = if ($item.PSIsContainer) { @(Get-ChildItem -LiteralPath $item.FullName -Recurse -Force -File -ErrorAction SilentlyContinue) } else { @($item) }
  $size = [int64]($files | Measure-Object Length -Sum).Sum
  if ($size -gt $bin.Capacity) { return ("大小 {0:N0} MB 超过回收站容量 {1:N0} MB" -f ($size / 1MB), ($bin.Capacity / 1MB)) }
  # 有文件被别的程序占着时系统会弹对话框等人点，命令在后台就一直卡住；先查出来，逐项报错
  foreach ($file in $files) {
    try { [System.IO.File]::Open($file.FullName, 'Open', 'ReadWrite', 'None').Dispose() }
    catch [System.IO.IOException] { if (($_.Exception.HResult -band 0xFFFF) -in 32, 33) { return "$($file.FullName) 正被别的程序打开" } }
    catch { }
  }
  Add-Type -AssemblyName Microsoft.VisualBasic
  if ($item.PSIsContainer) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($item.FullName, 'OnlyErrorDialogs', 'SendToRecycleBin') }
  else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($item.FullName, 'OnlyErrorDialogs', 'SendToRecycleBin') }
}
function global:Remove-Item {
  [CmdletBinding(SupportsShouldProcess, DefaultParameterSetName = 'Path')]
  param([Parameter(ParameterSetName = 'Path', Position = 0, Mandatory, ValueFromPipeline)][string[]]$Path,
    [Parameter(ParameterSetName = 'Literal', Mandatory, ValueFromPipelineByPropertyName)][Alias('PSPath', 'LP')][string[]]$LiteralPath,
    [switch]$Recurse, [switch]$Force, [string]$Filter, [string[]]$Include, [string[]]$Exclude)
  process {
    $items = if ($PSCmdlet.ParameterSetName -eq 'Literal') { Get-Item -LiteralPath $LiteralPath -Force } else { Get-Item -Path $Path -Force -Filter $Filter -Include $Include -Exclude $Exclude }
    foreach ($item in $items) {
      if ($item.PSProvider.Name -ne 'FileSystem') { Microsoft.PowerShell.Management\Remove-Item -LiteralPath $item.PSPath -Recurse:$Recurse -Force:$Force; continue }
      if (-not $PSCmdlet.ShouldProcess($item.FullName, '移进回收站')) { continue }
      # 进不了回收站的那一项单独报错、不删，其余照常处理，和系统原版逐项报错一致
      $refusal = Move-HenjiToRecycleBin $item
      if ($refusal) { $PSCmdlet.WriteError([System.Management.Automation.ErrorRecord]::new([System.IO.IOException]::new("没有删除 $($item.FullName)：$refusal。确实要永久删除时用 Microsoft.PowerShell.Management\Remove-Item。"), 'HenjiRecycleBinUnavailable', 'WriteError', $item.FullName)) }
    }
  }
}
function global:henji-node { $env:ELECTRON_RUN_AS_NODE = '1'; try { & $env:HENJI_NODE @args 2>&1 | ForEach-Object { "$_" } } finally { $env:ELECTRON_RUN_AS_NODE = $null } }`

/** macOS 15 起自带 trash 命令；更早的系统交给访达移进废纸篓。选项（-r、-f）对移进废纸篓没有意义，忽略。 */
const BASH_PREFIX = String.raw`rm() {
  local targets=() arg item
  for arg in "$@"; do case "$arg" in --) ;; -*) ;; *) targets+=("$arg") ;; esac; done
  [ "${'$'}{#targets[@]}" -eq 0 ] && return 0
  if command -v trash >/dev/null 2>&1; then trash "${'$'}{targets[@]}"; return; fi
  for item in "${'$'}{targets[@]}"; do
    [ -e "$item" ] || [ -L "$item" ] || { echo "rm: $item: No such file or directory" >&2; continue; }
    osascript -e "tell application \"Finder\" to delete POSIX file \"$(cd "$(dirname "$item")" && pwd)/$(basename "$item")\"" >/dev/null || return 1
  done
}
henji-node() { ELECTRON_RUN_AS_NODE=1 "$HENJI_NODE" "$@"; }`

/**
 * Pi 自带工具改成带宾语的名字：read、find 这类单词会撞上供应商保留的工具名
 * （DeepSeek 开着联网搜索时 find 是保留字，整次请求被拒）。
 */
const NAMES: Readonly<Record<string, { name: string; title: string }>> = {
  powershell: { name: 'run_command', title: '运行命令' }, bash: { name: 'run_command', title: '运行命令' },
  read: { name: 'read_file', title: '读取文件' }, write: { name: 'write_file', title: '写入文件' }, edit: { name: 'edit_file', title: '修改文件' },
  grep: { name: 'search_files', title: '搜索内容' }, find: { name: 'find_files', title: '查找文件' }, ls: { name: 'list_files', title: '列出文件夹' },
}
const TITLES: Readonly<Record<string, string>> = Object.fromEntries(Object.values(NAMES).map(({ name, title }) => [name, title]))

/** 模型没写超时的命令最多跑一小时，够装依赖、下模型；要跑更久由模型显式给 timeout。 */
const DEFAULT_COMMAND_TIMEOUT_SECONDS = 3600

interface SpawnContext { command: string; cwd: string; env: NodeJS.ProcessEnv }
function prepareLocalCommand(prefix: string, context: SpawnContext): SpawnContext {
  return { ...context, command: `${prefix}\n${context.command}`, env: { ...context.env, HENJI_NODE: process.env.HENJI_NODE ?? process.execPath } }
}

/**
 * 内置助手在本机动手的工具：命令、读写改文件与搜索，权限与外部助手相同，工作文件夹是当前项目。
 * Windows 用 PowerShell（系统必带），其他系统用 bash。命令里拿不到模型密钥：密钥只在助手进程内存里，不进环境变量。
 */
export function createLocalTools(sdk: PiSdk, cwd: string): ToolDefinition[] {
  const shell = process.platform === 'win32'
    ? sdk.createPowerShellToolDefinition(cwd, { spawnHook: context => prepareLocalCommand(POWERSHELL_PREFIX, context) })
    : sdk.createBashToolDefinition(cwd, { spawnHook: context => prepareLocalCommand(BASH_PREFIX, context) })
  const tools = [shell, sdk.createReadToolDefinition(cwd), sdk.createWriteToolDefinition(cwd), sdk.createEditToolDefinition(cwd),
    sdk.createGrepToolDefinition(cwd), sdk.createFindToolDefinition(cwd), sdk.createLsToolDefinition(cwd)] as unknown as ToolDefinition[]
  // Pi 写给自带工具的使用守则按旧名字写（“Use read to…”），改名后会把模型引向不存在的工具，不带。
  return tools.map(tool => ({ ...tool, name: NAMES[tool.name]?.name ?? tool.name, label: NAMES[tool.name]?.title ?? tool.label, promptGuidelines: undefined,
    // 命令运行时宿主靠心跳认定助手仍在工作；卡住的命令（常驻服务、弹出对话框）没有默认上限就会让这一轮永远挂着。
    ...(tool === shell ? { execute: (id, args, ...rest) => tool.execute(id, { timeout: DEFAULT_COMMAND_TIMEOUT_SECONDS, ...(args as object) }, ...rest) } : {}) }))
}

/** 助手面板里本机工具那一步显示做了什么：命令的第一行，或文件、文件夹路径。 */
export function describeLocalToolCall(name: string, args: unknown): string | undefined {
  const title = TITLES[name]
  if (!title || !args || typeof args !== 'object') return undefined
  const input = args as Record<string, unknown>
  const detail = typeof input.command === 'string' ? input.command.trim().split('\n')[0]
    : typeof input.path === 'string' ? input.path : typeof input.pattern === 'string' ? input.pattern : ''
  return detail ? `${title}：${detail.length > 120 ? `${detail.slice(0, 120)}…` : detail}` : title
}
