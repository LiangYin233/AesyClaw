/** Electron 主进程入口。
 *
 * 职责：
 * - 创建 BrowserWindow
 * - 管理 WebSocket 连接（聊天 + 管理）
 * - IPC 桥接：暴露 API 给渲染进程
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { WebSocketManager } from './ws-manager';

let mainWindow: BrowserWindow | null = null;
let wsManager: WebSocketManager | null = null;

// ─── 配置 ──────────────────────────────────────────────────────────

const DESKTOP_WS_URL = 'ws://127.0.0.1:9730/ws?token=desktop-local';
const ADMIN_WS_URL = 'ws://127.0.0.1:3000/api/ws?token=desktop-local';

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    title: 'AesyClaw Desktop',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
    },
  });

  mainWindow.webContents.openDevTools({ mode: 'detach' });

  // 确保窗口可最小化/最大化
  mainWindow.setMinimizable(true);
  mainWindow.setMaximizable(true);

  // 开发模式加载 dev server，生产模式加载文件
  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── IPC 处理器 ────────────────────────────────────────────────────

function setupIpc(): void {
  // 窗口控制
  ipcMain.handle('win-action', (_event, action: string) => {
    const win = mainWindow ?? BrowserWindow.fromWebContents(_event.sender);
    if (!win) return;
    if (action === 'minimize') { win.minimize(); return; }
    if (action === 'maximize') { win.isMaximized() ? win.unmaximize() : win.maximize(); return; }
    if (action === 'close') { win.close(); return; }
  });
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);

  // 聊天消息
  ipcMain.handle('chat:send', async (_event, payload: { sessionId: string; text: string }) => {
    return wsManager?.sendChatMessage(payload.sessionId, payload.text) ?? false;
  });

  // 取消当前对话
  ipcMain.handle('chat:cancel', async (_event, sessionId: string) => {
    wsManager?.sendCancelMessage(sessionId);
  });

  // 管理 API（代理到 admin WS）
  ipcMain.handle('admin:request', async (_event, request: { type: string; requestId: string; payload?: unknown }) => {
    return await (wsManager?.sendAdminRequest(request) ?? Promise.resolve({ ok: false, error: 'Admin WS 未连接' }));
  });

  // 获取连接状态
  ipcMain.handle('status:get', async () => {
    return wsManager?.getStatus() ?? { chat: 'disconnected', admin: 'disconnected' };
  });
}

// ─── 生命周期 ──────────────────────────────────────────────────────

void app.whenReady().then(() => {
  setupIpc();

  // 启动 WebSocket 连接
  wsManager = new WebSocketManager(DESKTOP_WS_URL, ADMIN_WS_URL);

  wsManager.on('chat-message', (msg) => {
    mainWindow?.webContents.send('chat:message', msg);
  });

  wsManager.on('admin-message', (msg) => {
    mainWindow?.webContents.send('admin:message', msg);
  });

  wsManager.on('status-change', (status) => {
    mainWindow?.webContents.send('status:change', status);
  });

  wsManager.connect();

  createWindow();

  // 窗口最大化/还原事件
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximizeChange', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximizeChange', false));
});

app.on('window-all-closed', () => {
  wsManager?.disconnect();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
