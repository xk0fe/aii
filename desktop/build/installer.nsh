; Crew's additions to the Windows installer (electron-builder's NSIS; electron-builder.config.mjs includes this file).
; The installer is per user: it runs without admin rights and installs to %LOCALAPPDATA%\Programs\Crew.
; Uninstalling leaves your crew alone: agents, chats and settings live in %USERPROFILE%\.crew (CREW_HOME).

!macro customInstall
  ; HOOK, Windows Firewall (Crew Link between computers, phones; see core/link.js and core/remote.js):
  ; the rule for Crew's listening ports goes here once its exact form is settled. Adding a firewall rule needs admin
  ; rights, which this per-user installer doesn't have, so either elevate just for it, e.g.
  ;   ExecShellWait "runas" "netsh" 'advfirewall firewall add rule name="Crew" dir=in action=allow program="$INSTDIR\Crew.exe" profile=private'
  ; or leave it to Windows' own "allow access" prompt the first time Crew listens on the network.
!macroend

!macro customUnInstall
  ; HOOK, Windows Firewall: remove the rule customInstall added, e.g.
  ;   ExecShellWait "runas" "netsh" 'advfirewall firewall delete rule name="Crew"'
!macroend
