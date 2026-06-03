@echo off
chcp 65001

powershell.exe -ExecutionPolicy Bypass -File "%~dp0\silent-uninstall.ps1"
