// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');

const { Client } = require('ssh2');  // Correct import for ssh2
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
  const result = await sshOps.startServer(serverName);
  return result.sshDown ? { success: false, sshDown: true } : result;
});

ipcMain.handle('stop-server', async (event, serverName) => {
  const result = await sshOps.stopServer(serverName);
  return result.sshDown ? { success: false, sshDown: true } : result;
});

ipcMain.handle('restart-server', async (event, serverName) => {
  const result = await sshOps.restartServer(serverName);
  return result.sshDown ? { success: false, sshDown: true } : result;
});

ipcMain.handle('get-server-status', async (event, serverName) => {
  return await sshOps.getServerStatus(serverName);
});

ipcMain.handle('get-server-log', async (event, serverName) => {
  const result = await sshOps.getServerLog(serverName);
  return result.sshDown ? { success: false, sshDown: true } : result;
});

ipcMain.handle('join-server', async (event, serverName) => {
  const result = await sshOps.joinServer(serverName);
  return result.sshDown ? { success: false, sshDown: true } : result;
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

ipcMain.handle('start-ssh-session', async (event, serverName) => {
  const serverConfig = sshOps.config[serverName];
  const conn = new Client();

  return new Promise((resolve, reject) => {
    conn.on('ready', () => {
      conn.shell((err, stream) => {
        if (err) reject(err);
        resolve({ success: true, stream });

        stream.on('close', () => {
          conn.end();
        });
      });
    }).on('error', (err) => {
      reject(err);
    }).connect({
      host: serverConfig.host,
      port: 22,
      username: serverConfig.username,
      privateKey: fs.readFileSync(sshKeyPath)
    });
  });
});

ipcMain.on('ssh-data', (event, data) => {
  // This will be implemented in the renderer process
});

ipcMain.on('terminal-resize', (event, { cols, rows }) => {
  // This will be implemented in the renderer process
});
