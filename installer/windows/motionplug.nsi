; Motion Plug Windows installer (NSIS 3 + Modern UI 2).
; Everything installs per-user: no UAC elevation or privileged service.

Unicode true
SetCompressor /SOLID lzma

!define PRODUCT "Motion Plug"
!define PUBLISHER "MotionPlug"
!define WEBSITE "https://motionplug.com"
!define ARP "Software\Microsoft\Windows\CurrentVersion\Uninstall\MotionPlug"

Name "${PRODUCT} ${VERSION}"
OutFile "${OUT_FILE}"
RequestExecutionLevel user
BrandingText "motionplug.com"

InstallDir "$APPDATA\Adobe\CEP\extensions\MotionPlug"
InstallDirRegKey HKCU "Software\MotionPlug" "InstallDir"

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define MUI_ICON "${INSTALLER_ICON}"
!define MUI_UNICON "${INSTALLER_ICON}"

!define MUI_WELCOMEPAGE_TITLE "Install ${PRODUCT}"
!define MUI_WELCOMEPAGE_TEXT "This installs the complete ${PRODUCT} motion-graphics panel for Adobe Premiere Pro.$\r$\n$\r$\nIt installs for your user only, so no administrator rights are needed. Premiere Pro should be closed.$\r$\n$\r$\nClick Next to continue."
!insertmacro MUI_PAGE_WELCOME

!define MUI_DIRECTORYPAGE_TEXT_TOP "Setup installs ${PRODUCT} into Premiere Pro's per-user extensions folder. The default is correct for virtually everyone; only change it if you know Premiere scans another CEP extensions folder."
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_TITLE "${PRODUCT} is installed"
!define MUI_FINISHPAGE_TEXT "Next steps:$\r$\n$\r$\n1. Open Premiere Pro (restart it if it was running).$\r$\n2. Go to Window > Extensions > Motion Plug.$\r$\n3. Choose a preset and add it at the playhead.$\r$\n$\r$\nMotion Plug works offline and does not require an account."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Launch Adobe Premiere Pro now"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchPremiere
!define MUI_FINISHPAGE_LINK "Open motionplug.com"
!define MUI_FINISHPAGE_LINK_LOCATION "${WEBSITE}"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${PRODUCT}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "${PRODUCT} for Adobe Premiere Pro - Installer"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "LegalCopyright" "© ${PUBLISHER}"

Section "Motion Plug" SecMain
  SectionIn RO

  ; Only clear a directory that already looks like an installed CEP panel.
  IfFileExists "$INSTDIR\CSXS\manifest.xml" 0 +2
    RMDir /r "$INSTDIR"

  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD_DIR}\*"

  WriteRegStr HKCU "Software\Adobe\CSXS.9"  "PlayerDebugMode" "1"
  WriteRegStr HKCU "Software\Adobe\CSXS.10" "PlayerDebugMode" "1"
  WriteRegStr HKCU "Software\Adobe\CSXS.11" "PlayerDebugMode" "1"
  WriteRegStr HKCU "Software\Adobe\CSXS.12" "PlayerDebugMode" "1"
  WriteRegStr HKCU "Software\Adobe\CSXS.13" "PlayerDebugMode" "1"
  WriteRegStr HKCU "Software\Adobe\CSXS.14" "PlayerDebugMode" "1"
  WriteRegStr HKCU "Software\Adobe\CSXS.15" "PlayerDebugMode" "1"

  WriteRegStr HKCU "Software\MotionPlug" "InstallDir" "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall Motion Plug.exe"
  WriteRegStr HKCU "${ARP}" "DisplayName" "${PRODUCT} for Premiere Pro"
  WriteRegStr HKCU "${ARP}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${ARP}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${ARP}" "URLInfoAbout" "${WEBSITE}"
  WriteRegStr HKCU "${ARP}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${ARP}" "DisplayIcon" "$INSTDIR\Uninstall Motion Plug.exe"
  WriteRegStr HKCU "${ARP}" "UninstallString" '"$INSTDIR\Uninstall Motion Plug.exe"'
  WriteRegDWORD HKCU "${ARP}" "NoModify" 1
  WriteRegDWORD HKCU "${ARP}" "NoRepair" 1
  WriteRegDWORD HKCU "${ARP}" "EstimatedSize" ${ESTSIZE_KB}
SectionEnd

Function LaunchPremiere
  StrCpy $R0 ""
  FindFirst $0 $1 "$PROGRAMFILES64\Adobe\Adobe Premiere Pro *"
  premiere_loop:
    StrCmp $1 "" premiere_done
    StrCmp $1 "." premiere_next
    StrCmp $1 ".." premiere_next
    IfFileExists "$PROGRAMFILES64\Adobe\$1\Adobe Premiere Pro.exe" 0 premiere_next
      StrCpy $R0 "$PROGRAMFILES64\Adobe\$1"
  premiere_next:
    FindNext $0 $1
    Goto premiere_loop
  premiere_done:
  FindClose $0
  ${If} $R0 != ""
    Exec '"$R0\Adobe Premiere Pro.exe"'
  ${EndIf}
FunctionEnd

Section "Uninstall"
  IfFileExists "$INSTDIR\CSXS\manifest.xml" 0 +2
    RMDir /r "$INSTDIR"
  ; PlayerDebugMode stays because other self-installed CEP panels may use it.
  ; Motion Plug preferences live outside this folder and survive reinstalling.
  DeleteRegKey HKCU "${ARP}"
  DeleteRegKey HKCU "Software\MotionPlug"
SectionEnd
