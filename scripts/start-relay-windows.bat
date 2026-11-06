@echo off
REM ==============================================================================
REM EDENS AI — Windows 1-Click ESP32-CAM Local Relay Bridge
REM Double-click to start relaying private greenhouse ESP32-CAM images to EDENS AI
REM ==============================================================================

title EDENS AI Camera Relay Bridge
color 0A

echo ==============================================================================
echo  EDENS AI - ESP32-CAM Local LAN to Cloud Relay Gateway
echo ==============================================================================
echo.

IF "%CAMERA_PHOTO_URL%"=="" (
    SET CAMERA_PHOTO_URL=http://10.87.237.36/photo
)

IF "%CAMERA_STATUS_URL%"=="" (
    SET CAMERA_STATUS_URL=http://10.87.237.36/status
)

IF "%EDENS_BACKEND_URL%"=="" (
    SET EDENS_BACKEND_URL=https://edens-ai.onrender.com
)

echo Camera Photo URL : %CAMERA_PHOTO_URL%
echo Camera Status URL: %CAMERA_STATUS_URL%
echo Cloud Backend    : %EDENS_BACKEND_URL%
echo.

IF "%CAMERA_UPLOAD_KEY%"=="" (
    echo [ATTENTION] Enter your Camera Device Key (starts with edcam_...):
    set /p CAMERA_UPLOAD_KEY="> "
)

echo.
echo Starting relay bridge... Press Ctrl+C at any time to stop.
echo.

node scripts/camera-lan-relay.mjs

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Camera relay exited with an error.
    echo Please verify:
    echo 1. Your computer is connected to the same Wi-Fi as the camera.
    echo 2. The camera IP 10.87.237.36 is reachable (ping 10.87.237.36).
    echo 3. The camera has power (5V 2A).
    echo.
    pause
)
