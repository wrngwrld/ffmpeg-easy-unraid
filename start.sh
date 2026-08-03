#!/bin/sh
set -eu

python3 /opt/ffmpeg-easy/admin_server.py &
exec /usr/local/bin/transcode.sh
