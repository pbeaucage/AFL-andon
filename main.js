// main.js (Main process)
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const SSHOperations = require('./sshOperations');

let mainWindow;
const sshOps = new SSHOperations(path.join(__dirname, 'config.json'));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
}


app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('start-server', async (event, serverName) => {
  try {
    await sshOps.startServer(serverName);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-server', async (event, serverName) => {
  try {
    await sshOps.stopServer(serverName);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('restart-server', async (event, serverName) => {
  try {
    await sshOps.restartServer(serverName);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-server-status', async (event, serverName) => {
  try {
    const status = await sshOps.getServerStatus(serverName);
    return { success: true, status };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-server-log', async (event, serverName) => {
  try {
    const { output } = await sshOps.getServerLog(serverName);
    return { success: true, log: output };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-config', () => {
  return sshOps.config;
});

ipcMain.handle('save-config', async (event, newConfig) => {
  try {
    await fs.writeFile(configPath, JSON.stringify(newConfig, null, 2));
    sshOps.loadConfig(configPath); // Reload the config in the SSHOperations instance
    return { success: true };
  } catch (error) {
    console.error('Error saving config:', error);
    return { success: false, error: error.message };
  }
});