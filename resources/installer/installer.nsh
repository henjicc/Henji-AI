; 外部智能体连接的接线员：安装目录里的痕迹AI 程序以 Node 模式常驻运行，不持有用户数据。
; 安装、卸载前先结束它，免得安装程序把它当成正在运行的痕迹AI 弹窗要求关闭；只认命令行里的接线员脚本，不碰痕迹AI 本身。
!macro henjiStopMcpRelay
  Push $0
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "Get-CimInstance -ClassName Win32_Process | ? { $$_.Path -and $$_.Path.StartsWith('$INSTDIR', 'CurrentCultureIgnoreCase') -and $$_.CommandLine -like '*mcp-relay.cjs*' } | % { Stop-Process -Id $$_.ProcessId -Force }"`
  Pop $0
  Pop $0
!macroend

!macro customInit
  !insertmacro henjiStopMcpRelay
!macroend

!macro customUnInit
  !insertmacro henjiStopMcpRelay
!macroend
