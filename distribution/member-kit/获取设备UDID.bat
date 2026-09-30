@echo off
chcp 65001 >nul
title KeyBox - Get Device UDID
echo ============================================
echo   KeyBox - step 1: get your device UDID
echo ============================================
echo.
echo 1. Connect your HarmonyOS phone/tablet to this PC with a USB cable.
echo 2. On the device: Settings - System - Developer options - enable USB debugging.
echo 3. Tap "Allow" when the device asks for USB debugging permission.
echo.
echo Your device UDID is:
echo.
hdc.exe shell bm get -u
echo.
echo Copy the long 64-character string above and send it to the admin (Wei Zhizhi).
echo.
pause
