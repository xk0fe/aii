@echo off
rem The name this had before the app's rename: it runs clique-sh.cmd beside it.
"%~dp0clique-sh.cmd" %*
exit /b %errorlevel%
