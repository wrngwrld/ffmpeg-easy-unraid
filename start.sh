#!/bin/sh
set -eu

mkdir -p /tmp/ffmpeg-easy-admin
python3 /opt/ffmpeg-easy/admin_server.py >> /tmp/ffmpeg-easy-admin/server.log 2>&1 &
exec /usr/local/bin/transcode.sh
