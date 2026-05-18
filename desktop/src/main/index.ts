/** Electron 主进程入口。
 *
 * 职责：
 * - 创建 BrowserWindow (frameless + 自绘窗口控件)
 * - 管理 WebSocket 连接（聊天 + 管理）
 * - IPC 桥接：暴露 API 给渲染进程
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { WebSocketManager } from './ws-manager';

let mainWindow: BrowserWindow | null = null;
let wsManager: WebSocketManager | null = null;

// ─── 配置 ──────────────────────────────────────────────────────────

const DEFAULT_CONNECTION_CONFIG: DesktopConnectionConfig = {
  host: '127.0.0.1',
  desktopPort: 9730,
  adminPort: 3000,
  token: 'desktop-local',
};

type DesktopConnectionConfig = {
  host: string;
  desktopPort: number;
  adminPort: number;
  token: string;
};

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    thickFrame: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    resizable: true,
    title: 'AesyClaw Desktop',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
    },
  });

  mainWindow.webContents.openDevTools({ mode: 'detach' });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximizeChange', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximizeChange', false));
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── IPC 处理器 ────────────────────────────────────────────────────

function setupIpc(): void {
  // 窗口控制
  ipcMain.handle('win-action', (_event, action: string) => {
    const win = BrowserWindow.fromWebContents(_event.sender) ?? mainWindow;
    if (!win) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.close();
  });

  ipcMain.handle('window:isMaximized', (_event) => {
    const win = BrowserWindow.fromWebContents(_event.sender) ?? mainWindow;
    return win?.isMaximized() ?? false;
  });

  // 聊天消息
  ipcMain.handle('chat:send', async (_event, payload: { sessionId: string; text: string }) => {
    return wsManager?.sendChatMessage(payload.sessionId, payload.text) ?? false;
  });

  ipcMain.handle('chat:cancel', async (_event, sessionId: string) => {
    wsManager?.sendCancelMessage(sessionId);
  });

  // 管理 API
  ipcMain.handle('admin:request', async (_event, request: { type: string; requestId: string; payload?: unknown }) => {
    return await (wsManager?.sendAdminRequest(request) ?? Promise.resolve({ ok: false, error: 'Admin WS 未连接' }));
  });

  ipcMain.handle('status:get', async () => {
    return wsManager?.getStatus() ?? { chat: 'disconnected', admin: 'disconnected' };
  });

  ipcMain.handle('connection:getConfig', async () => {
    return loadConnectionConfig();
  });

  ipcMain.handle('connection:updateConfig', async (_event, config: DesktopConnectionConfig) => {
    const normalized = normalizeConnectionConfig(config);
    saveConnectionConfig(normalized);
    wsManager?.disconnect();
    wsManager?.updateUrls(buildDesktopWsUrl(normalized), buildAdminWsUrl(normalized));
    wsManager?.connect();
    return normalized;
  });
}

function getConnectionConfigPath(): string {
  return join(app.getPath('userData'), 'connection.json');
}

function loadConnectionConfig(): DesktopConnectionConfig {
  const configPath = getConnectionConfigPath();
  if (!existsSync(configPath)) return DEFAULT_CONNECTION_CONFIG;

  try {
    return normalizeConnectionConfig(JSON.parse(readFileSync(configPath, 'utf8')) as Partial<DesktopConnectionConfig>);
  } catch {
    return DEFAULT_CONNECTION_CONFIG;
  }
}

function saveConnectionConfig(config: DesktopConnectionConfig): void {
  const configPath = getConnectionConfigPath();
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

function normalizeConnectionConfig(config: Partial<DesktopConnectionConfig>): DesktopConnectionConfig {
  return {
    host: typeof config.host === 'string' && config.host.trim() ? config.host.trim() : DEFAULT_CONNECTION_CONFIG.host,
    desktopPort: normalizePort(config.desktopPort, DEFAULT_CONNECTION_CONFIG.desktopPort),
    adminPort: normalizePort(config.adminPort, DEFAULT_CONNECTION_CONFIG.adminPort),
    token: typeof config.token === 'string' && config.token.trim() ? config.token.trim() : DEFAULT_CONNECTION_CONFIG.token,
  };
}

function normalizePort(value: unknown, fallback: number): number {
  const port = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

function buildDesktopWsUrl(config: DesktopConnectionConfig): string {
  const url = new URL('ws://127.0.0.1/ws');
  url.hostname = config.host;
  url.port = String(config.desktopPort);
  url.searchParams.set('token', config.token);
  return url.toString();
}

function buildAdminWsUrl(config: DesktopConnectionConfig): string {
  const url = new URL('ws://127.0.0.1/api/ws');
  url.hostname = config.host;
  url.port = String(config.adminPort);
  return url.toString();
}

// ─── 生命周期 ──────────────────────────────────────────────────────

void app.whenReady().then(() => {
  setupIpc();

  createWindow();

  const connectionConfig = loadConnectionConfig();
  wsManager = new WebSocketManager(
    buildDesktopWsUrl(connectionConfig),
    buildAdminWsUrl(connectionConfig),
  );
  wsManager.on('chat-message', (msg) => mainWindow?.webContents.send('chat:message', msg));
  wsManager.on('admin-message', (msg) => mainWindow?.webContents.send('admin:message', msg));
  wsManager.on('status-change', (status) => mainWindow?.webContents.send('status:change', status));
  wsManager.connect();
});

app.on('window-all-closed', () => {
  wsManager?.disconnect();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
