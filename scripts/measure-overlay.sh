#!/usr/bin/env bash
set -euo pipefail

DURATION=${1:-120}
APP_DIR="/tmp/tokenpal-electron-benchmark"

echo "=== TokenPal Overlay Resource Measurement (18 fps Animation & top -l Sampling) ==="
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
            overflow: hidden;
          }
          .title { font-weight: 600; font-size: 13px; margin-bottom: 4px; }
          .fps-box { font-size: 11px; opacity: 0.85; margin-bottom: 8px; }
          .stage {
            position: relative;
            width: 100%;
            height: 60px;
            background: rgba(15, 23, 42, 0.5);
            border-radius: 8px;
            overflow: hidden;
          }
          #mascot {
            position: absolute;
            top: 15px;
            left: 10px;
            width: 30px;
            height: 30px;
            background: #10b981;
            border-radius: 50%;
            box-shadow: 0 0 10px rgba(16, 185, 129, 0.6);
          }
        </style>
      </head>
      <body>
        <div class="title">TokenPal Overlay Benchmark (Active 18 FPS)</div>
        <div class="fps-box" id="stats">FPS: calculating...</div>
        <div class="stage">
          <div id="mascot"></div>
        </div>
        <script>
          const mascot = document.getElementById('mascot');
          const stats = document.getElementById('stats');
          const TARGET_FPS = 18;
          const FRAME_INTERVAL = 1000 / TARGET_FPS;
          let lastFrameTime = performance.now();
          let frameCount = 0;
          let lastFpsUpdate = performance.now();
          let currentFps = 0;
          let angle = 0;

          function tick(now) {
            requestAnimationFrame(tick);
            const delta = now - lastFrameTime;
            if (delta < FRAME_INTERVAL) return;

            lastFrameTime = now - (delta % FRAME_INTERVAL);
            frameCount++;

            // Animate mascot position and scale
            angle += 0.08;
            const x = 10 + (Math.sin(angle) * 0.5 + 0.5) * 230;
            const y = 15 + Math.cos(angle * 2) * 5;
            const scale = 1 + Math.sin(angle * 3) * 0.15;
            mascot.style.transform = \`translate3d(\${x}px, \${y}px, 0) scale(\${scale})\`;

            if (now - lastFpsUpdate >= 1000) {
              currentFps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
              stats.textContent = \`FPS: \${currentFps} (Target: \${TARGET_FPS}) | Frames: \${frameCount}\`;
              frameCount = 0;
              lastFpsUpdate = now;
            }
          }
          requestAnimationFrame(tick);
        </script>
      </body>
    </html>
  `)}`);
});

app.on('window-all-closed', () => {
  app.quit();
});
EOF

echo "Starting Electron benchmark app with 18 fps animation..."
npx --yes electron "$APP_DIR" &
MAIN_PID=$!

cleanup() {
  echo "Terminating Electron process tree..."
  kill -9 "$MAIN_PID" 2>/dev/null || true
  pkill -P "$MAIN_PID" 2>/dev/null || true
  rm -rf "$APP_DIR"
}
trap cleanup EXIT INT TERM

sleep 4

if ! kill -0 "$MAIN_PID" 2>/dev/null; then
  echo "Error: Electron failed to start."
  exit 1
fi

LOG_FILE="/tmp/tokenpal-overlay-metrics.csv"
echo "timestamp,cpu_pct,rss_mb" > "$LOG_FILE"

echo "Collecting instantaneous metrics using 'top -l 2' every 5 seconds for ${DURATION}s..."
START_TIME=$(date +%s)
END_TIME=$((START_TIME + DURATION))

while [ $(date +%s) -lt $END_TIME ]; do
  CHILD_PIDS=$(pgrep -P "$MAIN_PID" || true)
  ALL_PIDS="$MAIN_PID $CHILD_PIDS"

  PID_ARGS=()
  for p in $ALL_PIDS; do
    if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then
      PID_ARGS+=("-pid" "$p")
    fi
  done

  if [ ${#PID_ARGS[@]} -gt 0 ]; then
    # top -l 2 gives 2 samples; second sample provides instantaneous delta CPU
    TOP_OUT=$(top -l 2 -stats pid,cpu,rsize "${PID_ARGS[@]}" 2>/dev/null || true)
    
    # Process with python to parse second sample
    python3 - << PYPARSE >> "$LOG_FILE"
import sys, re

top_text = """$TOP_OUT"""
blocks = top_text.split("Processes:")
if len(blocks) >= 3:
    target_block = blocks[-1]
else:
    target_block = top_text

total_cpu = 0.0
total_rss_mb = 0.0

for line in target_block.strip().split("\n"):
    line = line.strip()
    # Match lines like "12345  2.1  85M"
    m = re.match(r"^(\d+)\s+([\d\.]+)\s+([\d\.]+)([KMGkmg]?)\+?", line)
    if m:
        try:
            cpu = float(m.group(2))
            mem_val = float(m.group(3))
            unit = m.group(4).upper()
            if unit == 'K':
                mem_mb = mem_val / 1024.0
            elif unit == 'G':
                mem_mb = mem_val * 1024.0
            elif unit == 'M':
                mem_mb = mem_val
            else:
                mem_mb = mem_val / (1024.0 * 1024.0)
            total_cpu += cpu
            total_rss_mb += mem_mb
        except Exception:
            pass

import time
print(f"{int(time.time())},{total_cpu:.2f},{total_rss_mb:.2f}")
PYPARSE
  fi

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
            rss_mb.append(float(row['rss_mb']))
        except (ValueError, KeyError):
            pass

if cpus:
    print(f"Samples recorded: {len(cpus)}")
    print(f"Total CPU (% instantaneous): Min={min(cpus):.1f}%, Avg={sum(cpus)/len(cpus):.1f}%, Max={max(cpus):.1f}%")
    print(f"Total RSS (MB): Min={min(rss_mb):.1f} MB, Avg={sum(rss_mb)/len(rss_mb):.1f} MB, Max={max(rss_mb):.1f} MB")
else:
    print("No samples collected.")
PYEOF
