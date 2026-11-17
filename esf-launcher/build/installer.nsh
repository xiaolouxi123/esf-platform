; =====================================================================
; ESF 平台 · 自定义卸载 / 更新清理
;
; 背景：社区的分发方式是「安装好的平台 + FCX 游戏本体放在同一个目录」，
; 也就是安装时把 $INSTDIR 选在游戏根目录（hl.exe / hw.dll 就在同一层）。
;
; electron-builder 默认的更新流程会调用旧版卸载器，并把整个 $INSTDIR
; 递归删除（uninstaller.nsh:164-187，更新时还会先改名到 $PLUGINSDIR\old-install）。
; 如果 $INSTDIR 就是游戏根目录，那会把游戏本体一起删掉。
;
; 这里用 customRemoveFiles 接管删除逻辑：只删除启动器自己的 Electron 运行时文件，
; 游戏文件（hl.exe、hw.dll、valve/、esf/ 等）一个都不碰。
; =====================================================================

; ---------------------------------------------------------------------
; 0.6.5 及更早版本的卸载器是 electron-builder 默认实现：更新时会把整个 $INSTDIR
; 改名到 $PLUGINSDIR\old-install 再递归删除。用户把平台装在 FCX 游戏根目录时，
; 这一步会连游戏本体一起删掉。
;
; 新版安装器的 installSection 会先调用「旧卸载器」清场（installUtil.nsh:224）。
; 这里在 .onInit（installer.nsi:79，早于 installSection）检测到游戏文件时，
; 先删掉旧卸载器的注册信息，让 uninstallOldVersion 直接返回（installUtil.nsh:156），
; 改为把新文件直接覆盖到 $INSTDIR。游戏文件不会被移动或删除。
; ---------------------------------------------------------------------
!macro customInit
  ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${If} $0 != ""
    ${If} ${FileExists} "$INSTDIR\hw.dll"
    ${OrIf} ${FileExists} "$INSTDIR\hl.exe"
    ${OrIf} ${FileExists} "$INSTDIR\valve\liblist.gam"
    ${OrIf} ${FileExists} "$INSTDIR\esf\liblist.gam"
      DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"
      DetailPrint "Game files found in install dir - skipping legacy uninstaller"
    ${EndIf}
  ${EndIf}
!macroend

!macro customRemoveFiles
  ; 不要在安装目录里执行删除，避免占用目录导致最后 RMDir 失败
  SetOutPath $TEMP
  DetailPrint "Removing ESF launcher files (game files are kept)"

  ; 启动器主程序与卸载器
  Delete "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"

  ; Electron 运行时（Electron 45 dist 的实际文件清单，逐个列名，禁止用 *.dll 通配）
  Delete "$INSTDIR\chrome_100_percent.pak"
  Delete "$INSTDIR\chrome_200_percent.pak"
  Delete "$INSTDIR\d3dcompiler_47.dll"
  Delete "$INSTDIR\dxcompiler.dll"
  Delete "$INSTDIR\electron_wer.dll"
  Delete "$INSTDIR\ffmpeg.dll"
  Delete "$INSTDIR\icudtl.dat"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\LICENSES.chromium.html"
  Delete "$INSTDIR\resources.pak"
  Delete "$INSTDIR\snapshot_blob.bin"
  Delete "$INSTDIR\v8_context_snapshot.bin"
  Delete "$INSTDIR\version"
  Delete "$INSTDIR\vk_swiftshader.dll"
  Delete "$INSTDIR\vk_swiftshader_icd.json"
  Delete "$INSTDIR\vulkan-1.dll"

  ; 应用资源：只删已知文件名，目录非空时 RMDir 会失败并保留，不会误删
  RMDir /r "$INSTDIR\locales"
  Delete "$INSTDIR\resources\app.asar"
  Delete "$INSTDIR\resources\app-update.yml"
  RMDir /r "$INSTDIR\resources\app.asar.unpacked"
  RMDir "$INSTDIR\resources"

  ; 目录空了才删；装了游戏时这里会失败（正是我们要的结果）
  RMDir "$INSTDIR"
!macroend
