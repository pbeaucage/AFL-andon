// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');

const { Client } = require('ssh2');  // Correct import for ssh2
const SSH2 = require('ssh2');
const path = require('path');
const fs = require('fs').promises;
const SSHOperations = require('./sshOperations');

let mainWindow;
let sshOps;

// Set default paths
let configPath = path.join(app.getPath('home'), '.afl', 'launchers.json');
let sshKeyPath = path.join(app.getPath('home'), '.ssh', 'id_rsa');

// Override with environment variables if set
if (process.env.SERVER_CONTROL_CONFIG_PATH) {
  configPath = process.env.SERVER_CONTROL_CONFIG_PATH;
}
if (process.env.SERVER_CONTROL_SSH_KEY_PATH) {
  sshKeyPath = process.env.SERVER_CONTROL_SSH_KEY_PATH;
}

// Override with command-line arguments if provided
const argConfigPath = process.argv.find(arg => arg.startsWith('--config='));
const argSshKeyPath = process.argv.find(arg => arg.startsWith('--ssh-key='));

if (argConfigPath) {
  configPath = argConfigPath.split('=')[1];
}
if (argSshKeyPath) {
  sshKeyPath = argSshKeyPath.split('=')[1];
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    icon: path.join(__dirname, 'assets', 'icons', 'png', '256x256.png'), // Use PNG for all platforms in dev
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
ipcMain.handle('add-server', async (event, { serverName, serverConfig }) => {
  sshOps.addServer(serverName, serverConfig);
  await sshOps.saveConfig();
  return { success: true };
});

ipcMain.handle('update-server', async (event, { serverName, serverConfig }) => {
  sshOps.updateServer(serverName, serverConfig);
  await sshOps.saveConfig();
  return { success: true };
});

ipcMain.handle('remove-server', async (event, serverName) => {
  sshOps.removeServer(serverName);
  await sshOps.saveConfig();
  return { success: true };
});

ipcMain.handle('toggle-server-active', async (event, serverName) => {
  sshOps.toggleServerActive(serverName);
  await sshOps.saveConfig();
  return { success: true };
});

ipcMain.handle('save-config', async () => {
  try {
    await sshOps.saveConfig();
    return { success: true };
  } catch (error) {
    console.error('Error saving config:', error);
    return { success: false, error: error.message };
  }
});


let sshConnections = {};


ipcMain.handle('start-ssh-session', async (event, serverName) => {
  const serverConfig = sshOps.config[serverName];
  const conn = new Client();

  try {
    await new Promise((resolve, reject) => {
      conn.on('ready', resolve);
      conn.on('error', reject);
      conn.connect({
        host: serverConfig.host,
        port: 22,
        username: serverConfig.username,
        privateKey: require('fs').readFileSync(sshKeyPath)
      });
    });

    const stream = await new Promise((resolve, reject) => {
      conn.shell((err, stream) => {
        if (err) reject(err);
        else resolve(stream);
      });
    });

    sshConnections[serverName] = { conn, stream };

    stream.on('data', (data) => {
      mainWindow.webContents.send('ssh-data', { serverName, data: data.toString() });
    });

    stream.on('close', () => {
      delete sshConnections[serverName];
      mainWindow.webContents.send('ssh-closed', serverName);
    });

    // Send the 'screen -x' command
    stream.write(`screen -x ${serverConfig.screen_name}\n`);

    return { success: true };
  } catch (error) {
    console.error(`SSH connection error for ${serverName}:`, error);
    return { success: false, error: error.message };
  }
});

ipcMain.on('ssh-data', (event, { serverName, data }) => {
  const connection = sshConnections[serverName];
  if (connection && connection.stream) {
    connection.stream.write(data);
  }
});

ipcMain.on('close-ssh-session', (event, serverName) => {
  const connection = sshConnections[serverName];
  if (connection) {
    connection.conn.end();
    delete sshConnections[serverName];
  }
});

ipcMain.on('resize-pty', (event, { serverName, cols, rows }) => {
  const connection = sshConnections[serverName];
  if (connection && connection.stream) {
    connection.stream.setWindow(rows, cols);
  }
});

ipcMain.handle('set-config-path', async (event, newPath) => {
  configPath = newPath;
  sshOps.setConfigPath(newPath);
  await sshOps.loadConfig();
  return { success: true };
});


ipcMain.handle('set-ssh-key-path', async (event, newPath) => {
  sshKeyPath = newPath;
  sshOps.setSshKeyPath(newPath);
  return { success: true };
});

ipcMain.handle('get-paths', () => {
  return { configPath, sshKeyPath };
});

ipcMain.handle('show-open-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

