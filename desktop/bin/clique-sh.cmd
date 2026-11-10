@echo off
rem Claude Code starts MCP servers through CLAUDE_CODE_SHELL_PREFIX without a shell, so on Windows it finds this
rem next to clique-sh, which Git Bash runs for it here, as it does for the commands Claude Code runs itself. CLIQUE_BASH
rem is the Git Bash CLIque found (core/procs.js gitBash).
setlocal
set "bash=%CLIQUE_BASH%"
if not defined bash set "bash=%CREW_BASH%"
if not defined bash set "bash=%CLAUDE_CODE_GIT_BASH_PATH%"
if not defined bash set "bash=%ProgramFiles%\Git\bin\bash.exe"
"%bash%" "%~dp0clique-sh" %*
exit /b %errorlevel%
