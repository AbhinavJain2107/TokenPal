import { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } from 'electron';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OverlayAlertPayload } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isLowPower = false;
let isRoaming = false;
let autoDismissTimer: NodeJS.Timeout | null = null;

// Clean tray icon (simple 16x16 geometric circle)
function createTrayIcon(): Electron.NativeImage {
  const icon = nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAFRJREFUOE9jZKAQMOLQ/x9NH4qB0Qy4yYBEh7EaQLoB+A1gGfEfm0vweQffoYw4DcCGG+E0wGAAhW4w4g2Q3QBMGv78/fvn25evXzYw4DAAnwEYAACC3T4sH/698QAAAABJRU5ErkJggg==',
      'base64'
    )
  );
  return icon;
}

function createWindow(): void {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  const winWidth = 360;
  const winHeight = 280;

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: width - winWidth - 20,
    y: height - winHeight - 20,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  if (process.platform === 'darwin') {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }

  const htmlPath = path.join(__dirname, 'mascot.html');
  mainWindow.loadFile(htmlPath);

  mainWindow.webContents.on('console-message', (_event, _level, message) => {
    if (message.includes('[TokenPal Animation]')) {
      console.log(message);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function updateTray(payload?: OverlayAlertPayload): void {
  if (!tray) return;
  const meter = payload?.meter;
  const tooltip = meter
    ? `TokenPal: ${Math.round(meter.usedPercent)}% (Resets in ${meter.timeToResetFormatted})`
    : 'TokenPal Guardian Mascot';
  tray.setToolTip(tooltip);

  const template: Electron.MenuItemConstructorOptions[] = [];
  if (meter) {
    template.push({
      label: `Quota: ${Math.round(meter.usedPercent)}% · Resets in ${meter.timeToResetFormatted} [${meter.planType || 'prolite'}]`,
      enabled: false
    });
    if (meter.earlyResetsNote) {
      template.push({ label: `⚠️ ${meter.earlyResetsNote}`, enabled: false });
    }
    if (meter.projectedExhaustionText) {
      template.push({ label: `⏳ ${meter.projectedExhaustionText}`, enabled: false });
    }
    if (meter.modelBadgeText) {
      template.push({ label: `💡 ${meter.modelBadgeText}`, enabled: false });
    }
    if (meter.requestCostDisplay) {
      template.push({ label: `📊 Last request: ${meter.requestCostDisplay}`, enabled: false });
    }
    template.push({ type: 'separator' });
  }

  template.push(
    {
      label: 'Hide Mascot',
      click: () => {
        if (mainWindow) mainWindow.hide();
      }
    },
    {
      label: 'Show Mascot',
      click: () => {
        if (mainWindow) mainWindow.showInactive();
      }
    },
    { type: 'separator' },
    {
      label: 'Snooze (30m)',
      click: () => {
        sendActionToHost('snooze', 30);
        if (mainWindow) mainWindow.hide();
      }
    },
    {
      label: 'Low-Power Mode',
      type: 'checkbox',
      checked: isLowPower,
      click: (item) => {
        isLowPower = item.checked;
        if (mainWindow) mainWindow.webContents.send('overlay:low-power', isLowPower);
      }
    },
    {
      label: 'Roaming Mode',
      type: 'checkbox',
      checked: isRoaming,
      click: (item) => {
        isRoaming = item.checked;
      }
    },
    { type: 'separator' },
    {
      label: 'Quit TokenPal Mascot',
      click: () => {
        app.quit();
      }
    }
  );

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray(): void {
  try {
    tray = new Tray(createTrayIcon());
    updateTray();
  } catch {
    // tray creation is optional if system doesn't support it
  }
}

function sendActionToHost(action: string, payload?: any): void {
  const message = JSON.stringify({ action, payload }) + '\n';
  process.stdout.write(message);
}

// IPC from Renderer
ipcMain.on('action:copy-handoff', () => {
  sendActionToHost('copy-handoff');
});

ipcMain.on('action:snooze', (_event, minutes) => {
  sendActionToHost('snooze', minutes);
  if (mainWindow) mainWindow.hide();
});

ipcMain.on('action:dismiss', () => {
  sendActionToHost('dismiss');
  if (mainWindow) mainWindow.hide();
  app.quit();
});

// Stdin listener from watcher process
process.stdin.setEncoding('utf-8');
process.stdin.resume();

process.stdin.on('data', (chunk) => {
  const lines = chunk.toString().split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line.trim());
      if ((msg.type === 'SHOW_ALERT' || msg.type === 'METER_UPDATE') && mainWindow) {
        mainWindow.showInactive();
        mainWindow.webContents.send('overlay:update', msg.payload);
        updateTray(msg.payload);

        // Auto-dismiss after 60s if not interacted
        if (autoDismissTimer) clearTimeout(autoDismissTimer);
        autoDismissTimer = setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.hide();
          }
        }, 60000);
      } else if (msg.type === 'QUIT') {
        app.quit();
      }
    } catch {
      // ignore parsing errors
    }
  }
});

// Self-terminate if stdin pipe closes (watcher terminates or IPC disconnects)
process.stdin.on('end', () => {
  app.quit();
});
process.stdin.on('close', () => {
  app.quit();
});
process.stdin.on('error', () => {
  app.quit();
});

// Additional safeguard: parent PID liveness check (e.g. if watcher is kill -9'd)
const parentPidStr = process.env.TOKENPAL_PARENT_PID;
if (parentPidStr) {
  const parentPid = parseInt(parentPidStr, 10);
  if (!isNaN(parentPid) && parentPid > 0) {
    const parentWatcherInterval = setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        clearInterval(parentWatcherInterval);
        app.quit();
      }
    }, 1000);
  }
}

// Parse initial arguments if passed directly via CLI
app.whenReady().then(() => {
  // On macOS, run as an accessory app so it can float over spaces without taking dock focus
  if (process.platform === 'darwin' && app.dock) {
    try {
      app.dock.hide();
    } catch {
      // ignore
    }
  }

  createWindow();
  createTray();

  // If initial alert is passed via environment or arguments
  const initialData = process.env.TOKENPAL_OVERLAY_INITIAL;
  if (initialData && mainWindow) {
    try {
      const parsed: OverlayAlertPayload = JSON.parse(initialData);
      mainWindow.webContents.on('did-finish-load', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.showInactive();
          mainWindow.webContents.send('overlay:update', parsed);
          updateTray(parsed);
        }
      });
    } catch {
      // ignore
    }
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
