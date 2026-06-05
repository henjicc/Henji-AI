const { spawnSync } = require('child_process')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  })

  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

function main() {
  const extraArgs = process.argv.slice(2)

  if (process.platform === 'win32') {
    const vsDevCmd = `${process.env['ProgramFiles(x86)']}\\Microsoft Visual Studio\\2022\\BuildTools\\Common7\\Tools\\VsDevCmd.bat`
    const cargoArgs = ['run', '--manifest-path', 'src-tauri\\Cargo.toml', '--bin', 'progress_export_seeds', '--', ...extraArgs]
    const powerShellScript = [
      `$vsDevCmd = '${vsDevCmd.replace(/'/g, "''")}'`,
      `cmd.exe /c "call \`"$vsDevCmd\`" -arch=amd64 && set CC=cl.exe && set CXX=cl.exe && cargo ${cargoArgs.join(' ')}"`,
    ].join('; ')
    run('powershell.exe', ['-NoProfile', '-Command', powerShellScript], { shell: false })
    return
  }

  run('cargo', ['run', '--manifest-path', 'src-tauri/Cargo.toml', '--bin', 'progress_export_seeds', '--', ...extraArgs])
}

main()
