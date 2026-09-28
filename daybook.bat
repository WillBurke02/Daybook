@echo off
REM Starts Daybook in its own window. For the USB stick, where a Start menu
REM shortcut would lose its drive letter; on your own PC run once instead:
REM    python daybook.py install
REM Databases live in the data folder beside this file. Backups on the
REM computer rather than the stick (so losing the stick loses nothing):
set DAYBOOK_BACKUPS=%USERPROFILE%\daybook-backups
cd /d "%~dp0"
if exist "%~dp0python\pythonw.exe" ( start "" "%~dp0python\pythonw.exe" Daybook.pyw & goto :eof )
where pythonw >nul 2>&1 && ( start "" pythonw Daybook.pyw & goto :eof )
where pyw >nul 2>&1 && ( start "" pyw Daybook.pyw & goto :eof )
echo Python was not found, and there is no portable copy in a "python" folder
echo next to this file. Install it from https://www.python.org/downloads/ and
echo tick "Add python.exe to PATH", or see the README.
pause
