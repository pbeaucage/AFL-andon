// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const SSHOperations = require('./sshOperations');

let mainWindow;
let sshOps;
const configPath = path.join(app.getPath('userData'), 'config.json');
const sshKeyPath = path.join(app.getPath('userData'), 'id_rsa');

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  await mainWindow.loadFile('index.html');
}

app.whenReady().then(async () => {
  sshOps = new SSHOperations(configPath, sshKeyPath);
  await sshOps.initialize();
  await createWindow();
});
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


ipcMain.handle('import-config', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (result.canceled) {
      return { success: false, message: 'File selection was canceled.' };
    }

    const sourcePath = result.filePaths[0];
    await fs.copyFile(sourcePath, configPath);
    sshOps.loadConfig(configPath);
    return { success: true, message: 'Config file imported successfully.' };
  } catch (error) {
    console.error('Error importing config:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('import-ssh-key', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile']
    });

    if (result.canceled) {
      return { success: false, message: 'File selection was canceled.' };
    }

    const sourcePath = result.filePaths[0];
    await fs.copyFile(sourcePath, sshKeyPath);
    await fs.chmod(sshKeyPath, 0o600); // Ensure correct permissions
    sshOps.loadSSHKey(sshKeyPath);
    return { success: true, message: 'SSH key imported successfully.' };
  } catch (error) {
    console.error('Error importing SSH key:', error);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('get-config', async () => {
  await sshOps.loadConfig();  // Reload config before sending
  return sshOps.config;
});

ipcMain.handle('save-config', async (event, newConfig) => {
  try {
    await fs.writeFile(configPath, JSON.stringify(newConfig, null, 2));
    await sshOps.loadConfig();  // Reload config after saving
    return { success: true };
  } catch (error) {
    console.error('Error saving config:', error);
    return { success: false, error: error.message };
  }
});


ipcMain.handle('join-server', async (event, serverName) => {
  try {
    const result = await sshOps.joinServer(serverName);
    return { success: true, output: result.output };
  } catch (error) {
    console.error(`Error joining server ${serverName}:`, error);
    return { success: false, error: error.message };
  }
});