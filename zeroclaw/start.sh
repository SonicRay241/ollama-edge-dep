#!/bin/bash
set -e

VNC_DISPLAY=:99
VNC_PORT=5900
NOVNC_PORT=6080
VNC_PASSFILE=/zeroclaw-data/vnc_passfile

# Generate VNC password if not exists
if [ ! -f "$VNC_PASSFILE" ]; then
    mkdir -p /zeroclaw-data
    x11vnc -storepasswd "$(openssl rand -base64 16)" "$VNC_PASSFILE"
    chmod 600 "$VNC_PASSFILE"
fi

# Start Xvfb
Xvfb $VNC_DISPLAY -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
sleep 2

# Start fluxbox
fluxbox -display $VNC_DISPLAY &
sleep 1

# Start x11vnc - ONLY listen on loopback (Traefik on same host forwards to it)
# -rfbauth enables password protection
x11vnc -display $VNC_DISPLAY -rfbport $VNC_PORT -forever -shared \
    -rfbauth "$VNC_PASSFILE" \
    -localhost \
    -bg

# Start noVNC through Traefik only (no direct internet exposure)
websockify --web=/usr/share/novnc $NOVNC_PORT localhost:$VNC_PORT &

sleep 1
echo "VNC services ready (loopback-only, password-protected)"

# Start the original entrypoint
exec /start.sh "$@"