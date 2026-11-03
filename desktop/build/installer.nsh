; The app's additions to the Windows installer (electron-builder's NSIS; electron-builder.config.mjs includes this file).
; The installer is per user: it runs without admin rights and installs to %LOCALAPPDATA%\Programs\crew (named after
; package.json's name, so the same folder as before the rename to CLIque; the program in it is CLIque.exe).
; Uninstalling leaves your crew alone: agents, chats and settings live in %USERPROFILE%\.crew (CREW_HOME).

!macro customInstall
  ; TODO, Windows Firewall (linked computers, phones; core/link.js, core/remote.js): to be decided. The
  ; rule needs admin rights, which this per-user installer doesn't have, so it would have to elevate just for this:
  ;   ExecShellWait "runas" "netsh" 'advfirewall firewall add rule name="CLIque" dir=in action=allow program="$INSTDIR\CLIque.exe" protocol=TCP profile=private,domain enable=yes'
  ; Until then Windows asks the first time the app listens on the network, and the app says what to do if it's blocked.
!macroend

!macro customUnInstall
  ; TODO, Windows Firewall: remove the rule customInstall would add, elevated too:
  ;   ExecShellWait "runas" "netsh" 'advfirewall firewall delete rule name="CLIque"'

  ; Uninstalling, not updating (an update runs this uninstaller too): the terminal host runs from a copy of the app's
  ; runtime in CREW_HOME\run\runtime (core/ptyclient.js stage), out of reach of the installer's own "stop what runs
  ; from $INSTDIR", so that agents survive updates. With the app gone it goes too, and its copies with it (about 300 MB
  ; each). Everything else in CREW_HOME is yours and stays.
  ${ifNot} ${isUpdated}
    ReadEnvStr $R0 CREW_HOME
    ${if} $R0 == ""
      StrCpy $R0 "$PROFILE\.crew"
    ${endIf}
    StrCpy $R0 "$R0\run\runtime"
    ; the folder goes to PowerShell through the environment, so no quote in a name can break the command
    System::Call 'Kernel32::SetEnvironmentVariable(t "CREW_RUNTIME", t "$R0")i'
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$dir = $$env:CREW_RUNTIME.TrimEnd('\') + '\'; Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.Name -eq 'crew-host.exe' -and $$_.Path -and $$_.Path.StartsWith($$dir, 'CurrentCultureIgnoreCase') } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"`
    Pop $R1
    ; Windows lets go of a program's files a moment after it ends
    StrCpy $R2 0
    ${Do}
      RMDir /r "$R0"
      ${ifNot} ${FileExists} "$R0\*.*"
        ${Break}
      ${endIf}
      IntOp $R2 $R2 + 1
      Sleep 500
    ${LoopUntil} $R2 >= 10
  ${endIf}
!macroend
