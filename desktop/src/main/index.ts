/** Electron 主进程入口。
 *
 * 职责：
 * - 创建 BrowserWindow (frameless + 自绘窗口控件)
 * - 管理 WebSocket 连接（聊天 + 管理）
 * - IPC 桥接：暴露 API 给渲染进程
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { WebSocketManager, type DesktopUploadFile } from './ws-manager';
import {
  buildAdminWsUrl,
  buildDesktopWsUrl,
  DEFAULT_CONNECTION_CONFIG,
  normalizeConnectionConfig,
  type DesktopConnectionConfig,
} from '../shared/connection';

let mainWindow: BrowserWindow | null = null;
let wsManager: WebSocketManager | null = null;

// ─── 配置 ──────────────────────────────────────────────────────────

function createWindow(): void {
  const iconPath = join(__dirname, '..', '..', 'assets', 'icon.png');
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
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
    },
  });

  if (!app.isPackaged || process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximizeChange', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximizeChange', false));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── IPC 处理器 ────────────────────────────────────────────────────

function setupIpc(): void {
  // 窗口控制
  ipcMain.handle('win-action', (_event, action: string) => {
    const win = BrowserWindow.fromWebContents(_event.sender) ?? mainWindow;
    if (!win) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === 'close') win.close();
  });

  ipcMain.handle('window:isMaximized', (_event) => {
    const win = BrowserWindow.fromWebContents(_event.sender) ?? mainWindow;
    return win?.isMaximized() ?? false;
  });

  // 聊天消息
  ipcMain.handle(
    'chat:send',
    async (_event, payload: { sessionId: string; text: string; files?: DesktopUploadFile[] }) => {
      return (
        (await wsManager?.sendChatMessage(payload.sessionId, payload.text, payload.files ?? [])) ??
        false
      );
    },
  );
  ipcMain.handle(
    'chat:sendRaw',
    async (_event, payload: { type: string; sessionId: string; requestId?: string }) => {
      return (
        wsManager?.sendRawMessage(payload.type, {
          sessionId: payload.sessionId,
          ...(payload.requestId !== undefined ? { requestId: payload.requestId } : {}),
        }) ?? false
      );
    },
  );

  ipcMain.handle('chat:cancel', async (_event, sessionId: string) => {
    wsManager?.sendCancelMessage(sessionId);
  });

  // 管理 API
  ipcMain.handle(
    'channel:request',
    async (_event, request: { type: string; requestId: string; payload?: unknown }) => {
      return await (wsManager?.sendChannelRequest(request) ??
        Promise.resolve({ ok: false, error: 'Channel WS 未连接' }));
    },
  );

  ipcMain.handle(
    'admin:request',
    async (_event, request: { type: string; requestId: string; payload?: unknown }) => {
      return await (wsManager?.sendAdminRequest(request) ??
        Promise.resolve({ ok: false, error: 'Admin WS 未连接' }));
    },
  );

  ipcMain.handle('status:get', async () => {
    return wsManager?.getStatus() ?? { chat: 'disconnected', admin: 'disconnected' };
  });

  ipcMain.handle('commands:get', async () => {
    return wsManager?.getCommands() ?? [];
  });

  ipcMain.handle('connection:getConfig', async () => {
    return loadConnectionConfig();
  });

  ipcMain.handle('connection:updateConfig', async (_event, config: DesktopConnectionConfig) => {
    const normalized = normalizeConnectionConfig(config, { strict: true });
    saveConnectionConfig(normalized);
    wsManager?.disconnect();
    wsManager?.updateUrls(buildDesktopWsUrl(normalized), buildAdminWsUrl(normalized));
    wsManager?.connect();
    return normalized;
  });

  // 文件操作
  ipcMain.handle(
    'file:saveTemp',
    async (_event, payload: { name: string; data: string }): Promise<string> => {
      const tempDir = join(app.getPath('temp'), 'aesyclaw-desktop');
      mkdirSync(tempDir, { recursive: true });
      const filePath = join(tempDir, payload.name);
      writeFileSync(filePath, Buffer.from(payload.data, 'base64'));
      return filePath;
    },
  );

  ipcMain.handle('file:openFolder', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });
}

function getConnectionConfigPath(): string {
  return join(app.getPath('userData'), 'connection.json');
}

function loadConnectionConfig(): DesktopConnectionConfig {
  const configPath = getConnectionConfigPath();
  if (!existsSync(configPath)) return DEFAULT_CONNECTION_CONFIG;

  try {
    return normalizeConnectionConfig(
      JSON.parse(readFileSync(configPath, 'utf8')) as Partial<DesktopConnectionConfig>,
    );
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
  wsManager.on('chat-commands', (cmds) => mainWindow?.webContents.send('chat:commands', cmds));
  wsManager.connect();
});

app.on('window-all-closed', () => {
  wsManager?.disconnect();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
