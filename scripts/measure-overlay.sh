#!/usr/bin/env bash
set -euo pipefail

DURATION=${1:-120}
APP_DIR="/tmp/tokenpal-electron-benchmark"

echo "=== TokenPal Overlay Resource Measurement ==="
echo "Target duration: ${DURATION} seconds"

mkdir -p "$APP_DIR"

cat << 'EOF' > "$APP_DIR/package.json"
{
  "name": "tokenpal-electron-benchmark",
  "version": "1.0.0",
  "main": "main.js"
}
EOF

cat << 'EOF' > "$APP_DIR/main.js"
const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 320,
    height: 180,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setAlwaysOnTop(true, 'floating');
  }

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body {
            margin: 0;
            background: rgba(30, 41, 59, 0.85);
            backdrop-filter: blur(8px);
            color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.15);
            padding: 16px;
            box-sizing: border-box;
            user-select: none;
          }
          .title { font-weight: 600; font-size: 14px; margin-bottom: 6px; }
          .desc { font-size: 12px; opacity: 0.8; }
        </style>
      </head>
      <body>
        <div class="title">TokenPal Overlay Benchmark</div>
        <div class="desc">Sampling CPU and Memory...</div>
      </body>
    </html>
  `)}`);
});

app.on('window-all-closed', () => {
  app.quit();
});
EOF

echo "Starting Electron test app..."
npx --yes electron "$APP_DIR" &
MAIN_PID=$!

cleanup() {
  echo "Terminating Electron process tree..."
  kill -9 "$MAIN_PID" 2>/dev/null || true
  pkill -P "$MAIN_PID" 2>/dev/null || true
  rm -rf "$APP_DIR"
}
trap cleanup EXIT INT TERM

sleep 3

if ! kill -0 "$MAIN_PID" 2>/dev/null; then
  echo "Error: Electron failed to start."
  exit 1
fi

LOG_FILE="/tmp/tokenpal-overlay-metrics.csv"
echo "timestamp,cpu_pct,rss_kb" > "$LOG_FILE"

echo "Collecting metrics every 5 seconds for ${DURATION}s..."
START_TIME=$(date +%s)
END_TIME=$((START_TIME + DURATION))

while [ $(date +%s) -lt $END_TIME ]; do
  # Get all PIDs in the process group/tree (main + renderer + GPU processes)
  CHILD_PIDS=$(pgrep -P "$MAIN_PID" || true)
  ALL_PIDS="$MAIN_PID $CHILD_PIDS"
  
  TOTAL_CPU=0
  TOTAL_RSS=0
  
  for pid in $ALL_PIDS; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      STATS=$(ps -o %cpu,rss -p "$pid" | tail -n 1)
      CPU=$(echo "$STATS" | awk '{print $1}')
      RSS=$(echo "$STATS" | awk '{print $2}')
      if [ -n "$CPU" ] && [ -n "$RSS" ]; then
        TOTAL_CPU=$(echo "$TOTAL_CPU + $CPU" | bc -l 2>/dev/null || awk "BEGIN {print $TOTAL_CPU + $CPU}")
        TOTAL_RSS=$((TOTAL_RSS + RSS))
      fi
    fi
  done
  
  NOW=$(date +%s)
  echo "$NOW,$TOTAL_CPU,$TOTAL_RSS" >> "$LOG_FILE"
  sleep 5
done

echo ""
echo "=== Measurement Complete ==="
python3 - << 'PYEOF'
import csv

cpus = []
rss_mb = []

with open('/tmp/tokenpal-overlay-metrics.csv') as f:
    r = csv.DictReader(f)
    for row in r:
        try:
            cpus.append(float(row['cpu_pct']))
            rss_mb.append(float(row['rss_kb']) / 1024.0)
        except (ValueError, KeyError):
            pass

if cpus:
    print(f"Samples recorded: {len(cpus)}")
    print(f"Total CPU (%): Min={min(cpus):.1f}%, Avg={sum(cpus)/len(cpus):.1f}%, Max={max(cpus):.1f}%")
    print(f"Total RSS (MB): Min={min(rss_mb):.1f} MB, Avg={sum(rss_mb)/len(rss_mb):.1f} MB, Max={max(rss_mb):.1f} MB")
else:
    print("No samples collected.")
PYEOF
