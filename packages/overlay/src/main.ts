import { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, powerMonitor } from 'electron';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  SettingsManager,
  discoverSkins,
  SkinDefinition,
  OverlaySettingsConfig,
  DEFAULT_OVERLAY_SETTINGS,
  calculatePanelPosition
} from 'tokenpal-core';
import { OverlayAlertPayload } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mascotWindow: Electron.BrowserWindow | null = null;
let panelWindow: Electron.BrowserWindow | null = null;
let customizeWindow: Electron.BrowserWindow | null = null;
let tray: Electron.Tray | null = null;

let isLowPower = false;
let isRoaming = false;
let isUserDraggingMascot = false;
let isUserDraggingPanel = false;
let currentState = 'green';
let isAlertActive = false;
let isCurrentlyVisible = true;
let frontmostAppHintShown = false;
let isPanelPinned = false;
let isPanelManuallyOpened = false;
let currentPayload: OverlayAlertPayload | null = null;

const settingsManager = new SettingsManager();
let overlaySettings: OverlaySettingsConfig = {
  ...DEFAULT_OVERLAY_SETTINGS,
  ...(settingsManager.get('overlay') || {})
};
isRoaming = Boolean(overlaySettings.roam);
isPanelPinned = Boolean(overlaySettings.isPinned);

// Tray icon (16x16 geometric circle)
function createTrayIcon(): Electron.NativeImage {
  return nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAFRJREFUOE9jZKAQMOLQ/x9NH4qB0Qy4yYBEh7EaQLoB+A1gGfEfm0vweQffoYw4DcCGG+E0wGAAhW4w4g2Q3QBMGv78/fvn25evXzYw4DAAnwEYAACC3T4sH/698QAAAABJRU5ErkJggg==',
      'base64'
    )
  );
}

function getActiveSkin(): SkinDefinition {
  const skins = discoverSkins();
  const found = skins.find((s) => s.id === overlaySettings.skin);
  return found || skins[0];
}

function clampWindowPosition(x: number, y: number, winWidth: number, winHeight: number): { x: number; y: number } {
  const currentDisplay = screen.getDisplayNearestPoint({ x, y });
  const workArea = currentDisplay.workArea;

  const clampedX = Math.round(Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - winWidth)));
  const clampedY = Math.round(Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - winHeight)));
  return { x: clampedX, y: clampedY };
}

// ---------------------------------------------------------------------------
// 1. MASCOT WINDOW (Always floating companion)
// ---------------------------------------------------------------------------
function createMascotWindow(): void {
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;

  const mascotWidth = 120;
  const mascotHeight = 100;

  let initialX = workArea.x + workArea.width - mascotWidth - 24;
  let initialY = workArea.y + workArea.height - mascotHeight - 24;

  const savedPos = overlaySettings.positionsByDisplay?.[primaryDisplay.id.toString()];
  if (savedPos && typeof savedPos.x === 'number' && typeof savedPos.y === 'number') {
    const clamped = clampWindowPosition(savedPos.x, savedPos.y, mascotWidth, mascotHeight);
    initialX = clamped.x;
    initialY = clamped.y;
  }

  mascotWindow = new BrowserWindow({
    width: mascotWidth,
    height: mascotHeight,
    x: initialX,
    y: initialY,
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
    mascotWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mascotWindow.setAlwaysOnTop(true, 'screen-saver');
  }

  const mascotHtmlPath = path.join(__dirname, 'mascot.html');
  mascotWindow.loadFile(mascotHtmlPath);

  mascotWindow.webContents.on('did-finish-load', () => {
    if (mascotWindow && !mascotWindow.isDestroyed()) {
      const activeSkin = getActiveSkin();
      mascotWindow.webContents.send('overlay:init-skin', {
        skin: activeSkin,
        settings: overlaySettings
      });
      if (currentPayload) {
        mascotWindow.webContents.send('overlay:update', currentPayload);
      }
    }
  });

  mascotWindow.on('closed', () => {
    mascotWindow = null;
  });

  // Display metrics change listener
  const handleDisplayChange = () => {
    if (!mascotWindow || mascotWindow.isDestroyed()) return;
    const [curX, curY] = mascotWindow.getPosition();
    const [w, h] = mascotWindow.getSize();
    const clamped = clampWindowPosition(curX, curY, w, h);
    mascotWindow.setPosition(clamped.x, clamped.y);
    repositionPanel();
  };

  screen.on('display-metrics-changed', handleDisplayChange);
  screen.on('display-removed', handleDisplayChange);
}

// ---------------------------------------------------------------------------
// 2. STATUS PANEL WINDOW (Redesigned opaque draggable card)
// ---------------------------------------------------------------------------
function createPanelWindow(): void {
  const panelWidth = 340;
  const panelHeight = 360;

  panelWindow = new BrowserWindow({
    width: panelWidth,
    height: panelHeight,
    show: false,
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
    panelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    panelWindow.setAlwaysOnTop(true, 'screen-saver');
  }

  const panelHtmlPath = path.join(__dirname, 'panel.html');
  panelWindow.loadFile(panelHtmlPath);

  panelWindow.webContents.on('did-finish-load', () => {
    if (panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.webContents.send('panel:init-state', {
        data: currentPayload,
        isPinned: isPanelPinned
      });
    }
  });

  panelWindow.on('closed', () => {
    panelWindow = null;
  });
}

function repositionPanel(): void {
  if (!panelWindow || panelWindow.isDestroyed() || !mascotWindow || mascotWindow.isDestroyed()) return;

  const [mx, my] = mascotWindow.getPosition();
  const [mw, mh] = mascotWindow.getSize();
  const [pw, ph] = panelWindow.getSize();

  const currentDisplay = screen.getDisplayNearestPoint({ x: mx, y: my });
  const workArea = currentDisplay.workArea;

  const placement = calculatePanelPosition(
    { x: mx, y: my, width: mw, height: mh },
    { width: pw, height: ph },
    workArea,
    overlaySettings.panelOffset
  );

  panelWindow.setPosition(placement.x, placement.y);
}

function togglePanelVisibility(force?: boolean): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;

  const shouldShow = force !== undefined ? force : !panelWindow.isVisible();
  if (shouldShow) {
    repositionPanel();
    panelWindow.showInactive();
    if (currentPayload) {
      panelWindow.webContents.send('panel:update', currentPayload);
    }
  } else {
    panelWindow.hide();
    isPanelManuallyOpened = false;
  }
}

// ---------------------------------------------------------------------------
// 3. CUSTOMIZE WINDOW (Mascot Studio)
// ---------------------------------------------------------------------------
function openCustomizeWindow(): void {
  if (customizeWindow && !customizeWindow.isDestroyed()) {
    customizeWindow.focus();
    return;
  }

  customizeWindow = new BrowserWindow({
    width: 460,
    height: 640,
    minWidth: 420,
    minHeight: 520,
    title: 'TokenPal Mascot Studio',
    backgroundColor: '#0f172a',
    frame: true,
    hasShadow: true,
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const customizeHtmlPath = path.join(__dirname, 'customize.html');
  customizeWindow.loadFile(customizeHtmlPath);

  customizeWindow.on('closed', () => {
    customizeWindow = null;
  });
}

// ---------------------------------------------------------------------------
// 4. SYSTEM TRAY & CONTEXT MENU
// ---------------------------------------------------------------------------
function updateTray(): void {
  if (!tray) {
    tray = new Tray(createTrayIcon());
    tray.setToolTip('TokenPal Proactive Guardian');
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'TokenPal Mascot Studio...',
      click: () => openCustomizeWindow()
    },
    {
      label: panelWindow?.isVisible() ? 'Hide Status Panel' : 'Show Status Panel',
      click: () => togglePanelVisibility()
    },
    { type: 'separator' },
    {
      label: 'Visibility Mode',
      submenu: [
        {
          label: 'Only in Coding Apps',
          type: 'radio',
          checked: overlaySettings.visibilityMode === 'coding_apps' || !overlaySettings.visibilityMode,
          click: () => {
            overlaySettings.visibilityMode = 'coding_apps';
            settingsManager.save({ overlay: overlaySettings });
            checkFrontmostApp();
          }
        },
        {
          label: 'Always Visible',
          type: 'radio',
          checked: overlaySettings.visibilityMode === 'always',
          click: () => {
            overlaySettings.visibilityMode = 'always';
            settingsManager.save({ overlay: overlaySettings });
            checkFrontmostApp();
          }
        },
        {
          label: 'Only on Alerts',
          type: 'radio',
          checked: overlaySettings.visibilityMode === 'alerts_only',
          click: () => {
            overlaySettings.visibilityMode = 'alerts_only';
            settingsManager.save({ overlay: overlaySettings });
            checkFrontmostApp();
          }
        }
      ]
    },
    {
      label: 'Snooze (30m)',
      click: () => {
        sendActionToHost('snooze', 30);
        togglePanelVisibility(false);
      }
    },
    {
      label: 'Low-Power Mode',
      type: 'checkbox',
      checked: isLowPower,
      click: (item) => {
        setLowPowerMode(item.checked);
      }
    },
    {
      label: 'Roaming Mode',
      type: 'checkbox',
      checked: isRoaming,
      click: (item) => {
        isRoaming = item.checked;
        overlaySettings.roam = isRoaming;
        settingsManager.save({ overlay: overlaySettings });
      }
    },
    { type: 'separator' },
    {
      label: 'Quit TokenPal Overlay',
      click: () => app.quit()
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function setLowPowerMode(enabled: boolean): void {
  isLowPower = enabled;
  if (mascotWindow && !mascotWindow.isDestroyed()) {
    mascotWindow.webContents.send('overlay:low-power', isLowPower);
  }
}

function sendActionToHost(action: string, payload?: any): void {
  const message = JSON.stringify({ action, payload }) + '\n';
  process.stdout.write(message);
}

// ---------------------------------------------------------------------------
// 5. IPC HANDLERS
// ---------------------------------------------------------------------------

// Mascot drag & click
ipcMain.on('window:drag-start', () => {
  isUserDraggingMascot = true;
});

ipcMain.on('window:drag-move', (_event, { deltaX, deltaY }) => {
  if (!mascotWindow || mascotWindow.isDestroyed()) return;
  const [currentX, currentY] = mascotWindow.getPosition();
  const [winWidth, winHeight] = mascotWindow.getSize();

  const newX = currentX + deltaX;
  const newY = currentY + deltaY;
  const clamped = clampWindowPosition(newX, newY, winWidth, winHeight);

  mascotWindow.setPosition(clamped.x, clamped.y);

  // If panel is open and unpinned, move panel with mascot
  if (panelWindow && panelWindow.isVisible() && !isPanelPinned) {
    const [px, py] = panelWindow.getPosition();
    panelWindow.setPosition(px + (clamped.x - currentX), py + (clamped.y - currentY));
  }
});

ipcMain.on('window:drag-end', () => {
  isUserDraggingMascot = false;
  if (!mascotWindow || mascotWindow.isDestroyed()) return;

  const [x, y] = mascotWindow.getPosition();
  const currentDisplay = screen.getDisplayNearestPoint({ x, y });

  if (!overlaySettings.positionsByDisplay) {
    overlaySettings.positionsByDisplay = {};
  }
  overlaySettings.positionsByDisplay[currentDisplay.id.toString()] = { x, y };
  settingsManager.save({ overlay: overlaySettings });
});

// Click mascot to toggle panel
ipcMain.on('mascot:toggle-panel', () => {
  isPanelManuallyOpened = true;
  togglePanelVisibility();
});

// Panel drag by header (using renderer mouse events + IPC)
ipcMain.on('panel:drag-start', () => {
  isUserDraggingPanel = true;
});

ipcMain.on('panel:drag-move', (_event, { deltaX, deltaY }) => {
  if (!panelWindow || panelWindow.isDestroyed() || !mascotWindow || mascotWindow.isDestroyed()) return;

  const [px, py] = panelWindow.getPosition();
  const [pw, ph] = panelWindow.getSize();
  const [mx, my] = mascotWindow.getPosition();

  const currentDisplay = screen.getDisplayNearestPoint({ x: px, y: py });
  const workArea = currentDisplay.workArea;

  const newX = Math.round(Math.max(workArea.x, Math.min(px + deltaX, workArea.x + workArea.width - pw)));
  const newY = Math.round(Math.max(workArea.y, Math.min(py + deltaY, workArea.y + workArea.height - ph)));

  panelWindow.setPosition(newX, newY);

  // Record panel offset relative to mascot
  overlaySettings.panelOffset = {
    x: newX - mx,
    y: newY - my
  };
});

ipcMain.on('panel:drag-end', () => {
  isUserDraggingPanel = false;
  settingsManager.save({ overlay: overlaySettings });
});

ipcMain.on('panel:close', () => {
  togglePanelVisibility(false);
});

ipcMain.on('panel:set-pinned', (_event, pinned) => {
  isPanelPinned = Boolean(pinned);
  overlaySettings.isPinned = isPanelPinned;
  settingsManager.save({ overlay: overlaySettings });
});

// Right click context menu on mascot
ipcMain.on('overlay:show-context-menu', () => {
  if (!mascotWindow || mascotWindow.isDestroyed()) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: panelWindow?.isVisible() ? 'Hide Status Panel' : 'Show Status Panel',
      click: () => togglePanelVisibility()
    },
    {
      label: 'Customize Mascot...',
      click: () => openCustomizeWindow()
    },
    { type: 'separator' },
    {
      label: 'Snooze (30m)',
      click: () => {
        sendActionToHost('snooze', 30);
        togglePanelVisibility(false);
      }
    },
    {
      label: isRoaming ? 'Stop Roaming' : 'Start Roaming',
      click: () => {
        isRoaming = !isRoaming;
        overlaySettings.roam = isRoaming;
        settingsManager.save({ overlay: overlaySettings });
        updateTray();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Overlay',
      click: () => app.quit()
    }
  ]);

  contextMenu.popup({ window: mascotWindow });
});

// Host button actions
ipcMain.on('action:snooze', (_event, minutes) => {
  sendActionToHost('snooze', minutes);
  togglePanelVisibility(false);
});

ipcMain.on('action:dismiss', () => {
  sendActionToHost('dismiss');
  togglePanelVisibility(false);
});

ipcMain.on('action:copy-handoff', () => {
  sendActionToHost('copy-handoff');
});

ipcMain.on('overlay:open-customize', () => {
  openCustomizeWindow();
});

// Customize window IPC
ipcMain.on('customize:get-data', (event) => {
  const skins = discoverSkins();
  event.sender.send('customize:data', {
    settings: overlaySettings,
    skins
  });
});

ipcMain.on('customize:save', (_event, newSettings) => {
  overlaySettings = { ...overlaySettings, ...newSettings };
  settingsManager.save({ overlay: overlaySettings });

  const activeSkin = getActiveSkin();
  if (mascotWindow && !mascotWindow.isDestroyed()) {
    mascotWindow.webContents.send('overlay:settings-updated', {
      skin: activeSkin,
      settings: overlaySettings
    });
  }
  updateTray();
});

ipcMain.on('customize:close', () => {
  if (customizeWindow && !customizeWindow.isDestroyed()) {
    customizeWindow.close();
  }
});

// ---------------------------------------------------------------------------
// 6. ROAMING IMPLEMENTATION
// ---------------------------------------------------------------------------
function stepRoaming(): void {
  if (
    !isRoaming ||
    isLowPower ||
    isUserDraggingMascot ||
    isUserDraggingPanel ||
    !mascotWindow ||
    mascotWindow.isDestroyed() ||
    !mascotWindow.isVisible() ||
    currentState !== 'green'
  ) {
    return;
  }

  const [currentX, currentY] = mascotWindow.getPosition();
  const [winWidth, winHeight] = mascotWindow.getSize();

  const stepX = (Math.random() - 0.5) * 8;
  const stepY = (Math.random() - 0.5) * 4;

  const newX = currentX + stepX;
  const newY = currentY + stepY;
  const clamped = clampWindowPosition(newX, newY, winWidth, winHeight);

  mascotWindow.setPosition(clamped.x, clamped.y);
  mascotWindow.webContents.send('overlay:walking', true);
  setTimeout(() => {
    if (mascotWindow && !mascotWindow.isDestroyed()) {
      mascotWindow.webContents.send('overlay:walking', false);
    }
  }, 400);
}

setInterval(stepRoaming, 3000);

// ---------------------------------------------------------------------------
// 7. FRONTMOST APPLICATION & VISIBILITY MODES
// ---------------------------------------------------------------------------
function checkFrontmostApp(): void {
  if (process.platform !== 'darwin') {
    applyAppVisibility(true);
    return;
  }

  const mode = overlaySettings.visibilityMode || 'coding_apps';

  // 1. "Always" visible mode
  if (mode === 'always') {
    applyAppVisibility(true);
    return;
  }

  // 2. "Only on alerts" mode
  if (mode === 'alerts_only') {
    applyAppVisibility(isAlertActive);
    return;
  }

  // 3. "Only in coding apps" mode (default)
  if (isAlertActive && overlaySettings.showAlertsAnywhere) {
    applyAppVisibility(true);
    return;
  }

  child_process.exec(
    'lsappinfo info -only name $(lsappinfo front)',
    { timeout: 1000 },
    (error, stdout) => {
      if (error || !stdout) {
        if (!frontmostAppHintShown) {
          frontmostAppHintShown = true;
          console.log('[TokenPal] Frontmost application detection falling back to visible.');
        }
        applyAppVisibility(true);
        return;
      }

      const match = stdout.match(/"([^"]+)"/);
      const frontApp = match ? match[1].trim() : '';

      const allowedApps = overlaySettings.codingApps || DEFAULT_OVERLAY_SETTINGS.codingApps;
      const isAllowed = allowedApps.some(
        (app) => app.toLowerCase() === frontApp.toLowerCase() || frontApp.toLowerCase().includes(app.toLowerCase())
      );

      applyAppVisibility(isAllowed);
    }
  );
}

function applyAppVisibility(shouldBeVisible: boolean): void {
  if (shouldBeVisible === isCurrentlyVisible) return;
  isCurrentlyVisible = shouldBeVisible;

  if (mascotWindow && !mascotWindow.isDestroyed()) {
    mascotWindow.webContents.send('overlay:fade', { visible: isCurrentlyVisible });
  }
  if (panelWindow && !panelWindow.isDestroyed() && !isPanelPinned) {
    if (!isCurrentlyVisible && !isPanelManuallyOpened) {
      panelWindow.hide();
    }
  }
}

const frontmostAppTimer = setInterval(checkFrontmostApp, 1500);

// Battery monitoring (Electron powerMonitor)
if (powerMonitor) {
  const checkBattery = () => {
    try {
      const onBattery = powerMonitor.isOnBatteryPower();
      if (onBattery) {
        setLowPowerMode(true);
      } else if (!isLowPower) {
        setLowPowerMode(false);
      }
    } catch {
      // ignore
    }
  };

  powerMonitor.on('on-battery', () => setLowPowerMode(true));
  powerMonitor.on('on-ac', () => setLowPowerMode(false));
  setTimeout(checkBattery, 2000);
}

// ---------------------------------------------------------------------------
// 8. STDIN LISTENER FROM WATCHER PROCESS
// ---------------------------------------------------------------------------
process.stdin.setEncoding('utf-8');
process.stdin.resume();

process.stdin.on('data', (chunk) => {
  const lines = chunk.toString().split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line.trim());
      if (msg.type === 'SHOW_ALERT' || msg.type === 'METER_UPDATE') {
        const payload: OverlayAlertPayload = msg.payload;
        currentPayload = payload;
        currentState = payload.state || 'green';

        // An alert is active only for warning/red rules (or demo)
        const isRealAlert = Boolean(
          payload.rule === 'projected_exhaustion' ||
          payload.rule === 'single_request_high' ||
          currentState === 'red' ||
          currentState === 'yellow' ||
          (payload.reason && payload.reason.includes('DEMO'))
        );

        isAlertActive = isRealAlert;

        // Auto-open status panel ONLY for alerts (respecting snooze and manual close)
        if (isRealAlert) {
          togglePanelVisibility(true);
        }

        // Info notice (e.g. model switch): small speech bubble that auto-hides after ~6s
        // Stale reading: sleeping mascot state, NO popup

        if (payload.openCustomize) {
          openCustomizeWindow();
        }

        // Broadcast to mascot and panel
        if (mascotWindow && !mascotWindow.isDestroyed()) {
          mascotWindow.webContents.send('overlay:update', payload);
        }
        if (panelWindow && !panelWindow.isDestroyed()) {
          panelWindow.webContents.send('panel:update', payload);
        }
      } else if (msg.type === 'SET_VISIBILITY') {
        applyAppVisibility(Boolean(msg.payload?.visible));
      } else if (msg.type === 'SET_LOW_POWER') {
        setLowPowerMode(Boolean(msg.payload?.enabled));
      } else if (msg.type === 'QUIT') {
        app.quit();
      }
    } catch {
      // ignore malformed lines
    }
  }
});

// Self-termination safety
process.stdin.on('end', () => {
  clearInterval(frontmostAppTimer);
  app.quit();
});
process.stdin.on('close', () => {
  clearInterval(frontmostAppTimer);
  app.quit();
});

const parentPidStr = process.env.TOKENPAL_PARENT_PID;
if (parentPidStr) {
  const parentPid = parseInt(parentPidStr, 10);
  if (!isNaN(parentPid) && parentPid > 0) {
    const parentWatcherTimer = setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        clearInterval(parentWatcherTimer);
        app.quit();
      }
    }, 2000);
  }
}

// ---------------------------------------------------------------------------
// 9. APP INITIALIZATION
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  createMascotWindow();
  createPanelWindow();
  updateTray();

  // If initial alert payload was passed via env
  const initialPayloadRaw = process.env.TOKENPAL_OVERLAY_INITIAL;
  if (initialPayloadRaw) {
    try {
      const parsed = JSON.parse(initialPayloadRaw);
      currentPayload = parsed;
      currentState = parsed.state || 'green';
      if (currentState !== 'green' || parsed.rule) {
        isAlertActive = true;
        setTimeout(() => {
          togglePanelVisibility(true);
        }, 500);
      }
    } catch {
      // ignore
    }
  }
});

app.on('window-all-closed', () => {
  // Do not quit when windows are closed; keep overlay process running
});
