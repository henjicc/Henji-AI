# 包含标准NSIS库
!include "MUI2.nsh"
!include "FileFunc.nsh"

# 自定义变量设置
!define PRODUCT_NAME "痕迹AI"
!define PRODUCT_VERSION "0.1.0"
!define PRODUCT_PUBLISHER "痕迹AI开发团队"
!define PRODUCT_URL "https://henji.ai"
!define PRODUCT_DESCRIPTION "使用AI技术生成图片、视频和音频的桌面应用"

# 安装程序信息
Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "bundle\nsis\${PRODUCT_NAME}-${PRODUCT_VERSION}-x64-setup.exe"
InstallDir "$PROGRAMFILES64\${PRODUCT_NAME}"
InstallDirRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.henji.ai" ""
RequestExecutionLevel admin

# 界面设置
!define MUI_ABORTWARNING
!define MUI_ICON "..\icons\icon.ico"
!define MUI_UNICON "..\icons\icon.ico"

# 欢迎页面
!insertmacro MUI_PAGE_WELCOME

# 许可协议页面
!insertmacro MUI_PAGE_LICENSE "..\wix\license.rtf"

# 组件选择页面
!insertmacro MUI_PAGE_COMPONENTS

# 安装目录选择页面
!insertmacro MUI_PAGE_DIRECTORY

# 安装页面
!insertmacro MUI_PAGE_INSTFILES

# 完成页面
!insertmacro MUI_PAGE_FINISH

# 卸载页面
!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

# 语言设置
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

# 安装节定义
Section "痕迹AI主程序" SecMain
  SectionIn RO
  
  SetOutPath "$INSTDIR\app"
  File "..\target\release\henji-ai.exe"
  
  # 创建卸载程序
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  
  # 注册表项
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.henji.ai" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.henji.ai" "DisplayIcon" "$INSTDIR\app\henji-ai.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.henji.ai" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.henji.ai" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.henji.ai" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.henji.ai" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.henji.ai" "NoModify" "1"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.henji.ai" "NoRepair" "1"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.henji.ai" "EstimatedSize" "50000"
  
SectionEnd

# 桌面快捷方式节
Section "Desktop Shortcut" SecDesktop
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\app\henji-ai.exe"
SectionEnd

# 开始菜单节
Section "Start Menu Shortcuts" SecStartMenu
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\app\henji-ai.exe"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

# 卸载节
Section "Uninstall"
  # 删除程序文件
  RMDir /r "$INSTDIR\app"
  Delete "$INSTDIR\Uninstall.exe"
  
  # 删除注册表项
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.henji.ai"
  
  # 删除快捷方式
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${PRODUCT_NAME}"
  
  # 删除安装目录（如果为空）
  RMDir "$INSTDIR"
SectionEnd

# 函数定义
Function .onInit
  # 检查管理员权限
  UserInfo::GetAccountType
  pop $0
  ${If} $0 != "admin"
    MessageBox MB_OK "您需要管理员权限来安装此程序。" IDOK +2
    Abort
  ${EndIf}
  
  # 设置语言
  ${If} ${LANG_ENGLISH} == 1
    StrCmp $LANGUAGE ${LANG_ENGLISH} 0 +2
    SetShellVarContext current
  ${EndIf}
FunctionEnd