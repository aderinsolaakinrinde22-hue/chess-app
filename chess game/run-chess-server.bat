@echo off
cd /d "%~dp0"
java --add-modules jdk.httpserver chessgame.java 8000
pause