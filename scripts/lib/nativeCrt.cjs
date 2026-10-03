/**
 * Windows 随包原生程序（henji-video-decoder.exe、henji-audio-worker.exe）静态链接 MSVC C 运行时（任务 3.3）。
 *
 * Rust 的 x86_64-pc-windows-msvc 默认动态链接 VCRUNTIME140.dll；它不随 Windows 自带，没装 VC++ 运行库的干净机器上
 * 两个程序会直接无法启动（3.3 在打包产物上检查导入表发现）。UCRT（api-ms-win-crt-*）是 Windows 10 起的系统组件，不受影响；
 * FFmpeg DLL 由 mingw 构建、只依赖 UCRT。用 Rust 官方的 `+crt-static` 目标特性把 VC 运行时编进程序，
 * 不再需要随包或要求安装 VC++ 运行库。经环境变量传给 cargo（构建与测试同一入口，开发与 CI 一致），不改用户的 cargo 配置。
 */

const WINDOWS_MSVC_RUSTFLAGS_ENV = 'CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS'
const STATIC_CRT_FLAG = '-C target-feature=+crt-static'

/** 在 env 上追加静态 CRT 标志（保留已有 rustflags）；非 Windows 原样返回。 */
function withStaticMsvcCrt(env, platform = process.platform) {
  if (platform !== 'win32') return env
  const existing = env[WINDOWS_MSVC_RUSTFLAGS_ENV]?.trim() ?? ''
  if (existing.includes('+crt-static')) return env
  return { ...env, [WINDOWS_MSVC_RUSTFLAGS_ENV]: existing ? `${existing} ${STATIC_CRT_FLAG}` : STATIC_CRT_FLAG }
}

/** 打包核对用：可执行文件导入表里出现这些名字说明仍动态依赖 VC++ 运行库。 */
const DYNAMIC_MSVC_RUNTIME = /(vcruntime\d+(_\d)?|msvcp\d+(_\w+)?)\.dll/i

function dynamicMsvcRuntimeOf(buffer) {
  return buffer.toString('latin1').match(DYNAMIC_MSVC_RUNTIME)?.[0] ?? null
}

module.exports = { STATIC_CRT_FLAG, WINDOWS_MSVC_RUSTFLAGS_ENV, dynamicMsvcRuntimeOf, withStaticMsvcCrt }
