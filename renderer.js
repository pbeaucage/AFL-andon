// renderer.js (Renderer process)
const { ipcRenderer } = require('electron');
const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const http = require('http');
const https = require('https');

let config;
let editingServer = null;

let sshStream;

let terminal;
let currentServerName;

async function joinServer(serverName) {
  try {
    // Close existing connection if any
    if (currentServerName) {
      await ipcRenderer.invoke('close-ssh-session', currentServerName);
      currentServerName = null;
    }

    // Reinitialize terminal
    if (terminal) {
      terminal.dispose();
      terminal = null;
    }
    initializeTerminal();

    const result = await ipcRenderer.invoke('start-ssh-session', serverName);
    if (result.success) {
      showTerminalModal();
      currentServerName = serverName;
      terminal.clear();
      terminal.writeln(`Connected to ${serverName}`);
    } else {
      console.error(`Failed to join server ${serverName}`);
      alert(`Failed to join server ${serverName}`);
    }
  } catch (error) {
    console.error(`Error joining server ${serverName}:`, error);
    alert(`Error joining server ${serverName}: ${error.message}`);
  }
}

function initializeTerminal() {
  if (terminal) {
    console.warn('Terminal already initialized, disposing old instance');
    terminal.dispose();
  }

  terminal = new Terminal({
    disableStdin: false
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  const terminalContainer = document.getElementById('terminal-container');
  terminal.open(terminalContainer);
  fitAddon.fit();

  terminal.onData(data => {
    if (currentServerName) {
      ipcRenderer.send('ssh-data', { serverName: currentServerName, data });
    }
  });

  // Remove any existing ssh-data listeners
  ipcRenderer.removeAllListeners('ssh-data');

  ipcRenderer.on('ssh-data', (event, { serverName, data }) => {
    if (serverName === currentServerName) {
      terminal.write(data);
    }
  });
}


function showTerminalModal() {
  const modal = document.getElementById('terminal-modal');
  modal.style.display = 'block';
  if (!terminal) {
    initializeTerminal();
  }
}

function closeTerminalModal() {
  const modal = document.getElementById('terminal-modal');
  modal.style.display = 'none';
  if (currentServerName) {
    ipcRenderer.send('close-ssh-session', currentServerName);
    currentServerName = null;
  }
}

async function loadConfig() {
  config = await ipcRenderer.invoke('get-config');
}

async function saveConfig() {
  await ipcRenderer.invoke('save-config', config);
}
async function checkHttpEndpoint(serverName) {
  const serverConfig = config[serverName];
  const endpoint = serverConfig.statusEndpoint || '/get_server_time';
  const sanitizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const urlString = `http://${serverConfig.host}:${serverConfig.httpPort}${sanitizedEndpoint}`;
  return new Promise((resolve) => {
    try {
      const url = new URL(urlString);
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.get(url, (res) => {
        res.resume(); // consume data
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      });
      req.on('error', (error) => {
        console.error(`HTTP check failed for ${serverName}:`, error);
        resolve(false);
      });
      req.setTimeout(5000, () => {
        req.destroy();
        resolve(false);
      });
    } catch (error) {
      console.error(`HTTP check setup failed for ${serverName}:`, error);
      resolve(false);
    }
  });
}

async function updateServerStatus(serverName) {
  try {
    // For individual status updates (e.g. after server control operations),
    // we still use direct status check
    const result = await ipcRenderer.invoke('get-server-status', serverName);
    const httpResult = await checkHttpEndpoint(serverName);
    
    updateServerStatusUI(serverName, result, httpResult);
  } catch (error) {
    console.error(`Error getting status for ${serverName}:`, error);
  }
}

// Update the UI with status information
function updateServerStatusUI(serverName, screenResult, httpResult) {
  const screenStatusElement = document.getElementById(`${serverName}-screen-status`);
  const httpStatusElement = document.getElementById(`${serverName}-http-status`);
  
  if (screenStatusElement) {
    if (screenResult.sshDown) {
      screenStatusElement.textContent = 'SSH DOWN';
      screenStatusElement.className = 'status-indicator status-down';
    } else {
      screenStatusElement.textContent = screenResult.status ? 'SCREEN ACTIVE' : 'SCREEN INACTIVE';
      screenStatusElement.className = `status-indicator ${screenResult.status ? 'status-up' : 'status-down'}`;
    }
  }
  
  if (httpStatusElement) {
    httpStatusElement.textContent = httpResult ? 'HTTP UP' : 'HTTP DOWN';
    httpStatusElement.className = `status-indicator ${httpResult ? 'status-up' : 'status-down'}`;
  }
}

// Batch update server statuses by host
async function batchUpdateServerStatuses() {
  try {
    // Get servers grouped by host
    const serversByHost = await ipcRenderer.invoke('get-servers-by-host');
    
    // For each host, make a single batch status check
    for (const [host, servers] of Object.entries(serversByHost)) {
      const batchResult = await ipcRenderer.invoke('get-batch-server-status', host);
      
      if (!batchResult.success) {
        // If SSH is down for this host, update all servers on this host
        servers.forEach(serverName => {
          updateServerStatusUI(serverName, { sshDown: true }, false);
        });
        continue;
      }
      
      // For each server on this host, update its status based on the batch result
      const sessions = batchResult.sessions;
      
      for (const serverName of servers) {
        const serverConfig = config[serverName];
        const screenStatus = {
          success: true,
          status: sessions.includes(serverConfig.screen_name),
          sshDown: false
        };
        
        // Check HTTP endpoint for each server individually
        const httpResult = await checkHttpEndpoint(serverName);
        
        // Update the UI
        updateServerStatusUI(serverName, screenStatus, httpResult);
      }
    }
  } catch (error) {
    console.error('Error in batch status update:', error);
  }
}

async function controlServer(serverName, action) {
  try {
    const result = await ipcRenderer.invoke(`${action}-server`, serverName);
    if (result.success) {
      console.log(`${action} successful for ${serverName}`);
    } else if (result.sshDown) {
      console.log(`SSH is down for ${serverName}`);
    } else {
      console.error(`${action} failed for ${serverName}`);
    }
    updateServerStatus(serverName);
  } catch (error) {
    console.error(`Error during ${action} for ${serverName}:`, error);
  }
}


async function viewServerLog(serverName) {
  try {
    const result = await ipcRenderer.invoke('get-server-log', serverName, 200); // Request 200 lines
    if (result.success) {
      const logModal = document.getElementById('log-modal');
      const logContent = document.getElementById('log-content');
      const logTitle = document.getElementById('log-title');

      logTitle.textContent = `Server Log: ${serverName}`;
      logContent.textContent = result.output;

      // Show the modal
      logModal.style.display = 'block';

      // Scroll to the bottom
      logContent.scrollTop = logContent.scrollHeight;
    } else if (result.sshDown) {
      console.log(`SSH is down for ${serverName}`);
      alert(`Unable to get log: SSH is down for ${serverName}`);
    } else {
      console.error(`Failed to get log for ${serverName}`);
      alert(`Failed to get log for ${serverName}`);
    }
  } catch (error) {
    console.error(`Error getting log for ${serverName}:`, error);
  }
}

// Function to close the log modal
function closeLogModal() {
  const logModal = document.getElementById('log-modal');
  logModal.style.display = 'none';
}


function createServerControls(serverName) {
  const serverConfig = config[serverName];
  const container = document.createElement('div');
  container.className = 'server-container';
  
  const headerElement = document.createElement('div');
  headerElement.className = 'server-header';

  const nameElement = document.createElement('div');
  nameElement.className = 'server-name';
  nameElement.textContent = serverName;
  headerElement.appendChild(nameElement);

  const actionsElement = document.createElement('div');
  actionsElement.className = 'server-actions';

  const editButton = document.createElement('button');
  editButton.textContent = 'Edit';
  editButton.className = 'edit-btn';
  editButton.onclick = () => openServerModal(serverName);
  actionsElement.appendChild(editButton);

  const toggleActiveButton = document.createElement('button');
  toggleActiveButton.textContent = serverConfig.active ? 'Deactivate' : 'Activate';
  toggleActiveButton.className = 'toggle-active-btn';
  toggleActiveButton.onclick = () => toggleServerActive(serverName);
  actionsElement.appendChild(toggleActiveButton);

  headerElement.appendChild(actionsElement);
  container.appendChild(headerElement);

  const infoElement = document.createElement('div');
  infoElement.className = 'server-info';
  const endpointInfo = serverConfig.statusEndpoint || '/get_server_time';
  infoElement.textContent = `SSH: ${serverConfig.username}@${serverConfig.host}, HTTP: ${serverConfig.host}:${serverConfig.httpPort}${endpointInfo}`;
  container.appendChild(infoElement);

  const statusContainer = document.createElement('div');
  statusContainer.className = 'status-indicators';

  const screenStatusElement = document.createElement('span');
  screenStatusElement.id = `${serverName}-screen-status`;
  screenStatusElement.className = 'status-indicator';
  statusContainer.appendChild(screenStatusElement);

  const httpStatusElement = document.createElement('span');
  httpStatusElement.id = `${serverName}-http-status`;
  httpStatusElement.className = 'status-indicator';
  statusContainer.appendChild(httpStatusElement);

  container.appendChild(statusContainer);

  const controlsContainer = document.createElement('div');
  controlsContainer.className = 'controls';

  ['start', 'stop', 'restart'].forEach(action => {
    const button = document.createElement('button');
    button.textContent = action.charAt(0).toUpperCase() + action.slice(1);
    button.className = `${action}-btn`;
    button.onclick = () => controlServer(serverName, action);
    controlsContainer.appendChild(button);
  });

  const logButton = document.createElement('button');
  logButton.textContent = 'View Log';
  logButton.className = 'log-btn';
  logButton.onclick = () => viewServerLog(serverName);
  controlsContainer.appendChild(logButton);

  const joinButton = document.createElement('button');
  joinButton.textContent = 'Join';
  joinButton.className = 'join-btn';
  joinButton.onclick = () => joinServer(serverName);
  controlsContainer.appendChild(joinButton);

  container.appendChild(controlsContainer);

  return container;
}


function openServerModal(serverName = null) {
  const modal = document.getElementById('server-modal');
  const modalTitle = document.getElementById('modal-title');
  const form = document.getElementById('server-form');

  editingServer = serverName;

  if (serverName) {
    modalTitle.textContent = 'Edit Server';
    const server = config[serverName];
    form.elements['server-name'].value = serverName;
    form.elements['server-host'].value = server.host;
    form.elements['server-username'].value = server.username;
    form.elements['server-http-port'].value = server.httpPort;
    form.elements['server-status-endpoint'].value = server.statusEndpoint || '/get_server_time';
    form.elements['server-screen-name'].value = server.screen_name;
    form.elements['server-type'].value = server.server_script ? 'script' : 'module';
    form.elements['server-script'].value = server.server_script || '';
    form.elements['server-module'].value = server.server_module || '';
    form.elements['server-shell'].value = server.shell || 'bash';
    form.elements['server-conda-env'].value = server.conda_env || '';
    form.elements['server-active'].checked = server.active;
    form.elements['server-name'].disabled = true;
  } else {
    modalTitle.textContent = 'Add New Server';
    form.reset();
    form.elements['server-name'].disabled = false;
    form.elements['server-type'].value = 'script';
    form.elements['server-shell'].value = 'bash';
    form.elements['server-active'].checked = true;
    form.elements['server-status-endpoint'].value = '/get_server_time';
  }

  updateServerTypeFields();
  modal.style.display = 'block';
}

function updateServerTypeFields() {
  const serverType = document.getElementById('server-type').value;
  document.getElementById('script-group').style.display = serverType === 'script' ? 'block' : 'none';
  document.getElementById('module-group').style.display = serverType === 'module' ? 'block' : 'none';
}

async function handleServerFormSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const serverName = form.elements['server-name'].value;
  const serverConfig = {
    host: form.elements['server-host'].value,
    username: form.elements['server-username'].value,
    httpPort: parseInt(form.elements['server-http-port'].value, 10),
    statusEndpoint: form.elements['server-status-endpoint'].value || '/get_server_time',
    screen_name: form.elements['server-screen-name'].value,
    shell: form.elements['server-shell'].value,
    active: form.elements['server-active'].checked
  };

  const serverType = form.elements['server-type'].value;
  if (serverType === 'script') {
    serverConfig.server_script = form.elements['server-script'].value;
  } else {
    serverConfig.server_module = form.elements['server-module'].value;
  }

  const condaEnv = form.elements['server-conda-env'].value;
  if (condaEnv) {
    serverConfig.conda_env = condaEnv;
  }

  if (editingServer) {
    await updateServer(editingServer, serverConfig);
  } else {
    await addServer(serverName, serverConfig);
  }

  closeServerModal();
}
function closeServerModal() {
  const modal = document.getElementById('server-modal');
  modal.style.display = 'none';
  editingServer = null;
}

async function addServer(serverName, serverConfig) {
  await ipcRenderer.invoke('add-server', { serverName, serverConfig });
  await loadConfig();
  renderServers();
}

async function updateServer(serverName, serverConfig) {
  await ipcRenderer.invoke('update-server', { serverName, serverConfig });
  await loadConfig();
  renderServers();
}

async function removeServer(serverName) {
  await ipcRenderer.invoke('remove-server', serverName);
  await loadConfig();
  renderServers();
}
async function toggleServerActive(serverName) {
  await ipcRenderer.invoke('toggle-server-active', serverName);
  await loadConfig();
  renderServers();
}

function renderServers() {
  const appContainer = document.getElementById('app');
  
  // Clear existing content
  appContainer.innerHTML = '';

  // Sort servers: active first, then alphabetically
  const sortedServers = Object.keys(config).sort((a, b) => {
    if (config[a].active === config[b].active) {
      return a.localeCompare(b);
    }
    return config[b].active - config[a].active;
  });

  // Render active servers
  sortedServers.forEach(serverName => {
    if (config[serverName].active) {
      const serverControls = createServerControls(serverName);
      appContainer.appendChild(serverControls);
    }
  });

  // Always create the inactive servers section
  const inactiveServers = sortedServers.filter(name => !config[name].active);
  
  const inactiveHeader = document.createElement('div');
  inactiveHeader.id = 'inactive-servers-header';
  inactiveHeader.className = 'inactive-servers-header';
  inactiveHeader.innerHTML = `<span class="arrow">▶</span> Inactive Servers (${inactiveServers.length})`;
  inactiveHeader.onclick = toggleInactiveServers;
  appContainer.appendChild(inactiveHeader);

  const inactiveContent = document.createElement('div');
  inactiveContent.id = 'inactive-servers-content';
  inactiveContent.style.display = 'none';
  appContainer.appendChild(inactiveContent);

  inactiveServers.forEach(serverName => {
    const serverControls = createServerControls(serverName);
    inactiveContent.appendChild(serverControls);
  });

  // Update all server statuses
  sortedServers.forEach(updateServerStatus);
}

// Function to toggle inactive servers visibility
function toggleInactiveServers() {
  const content = document.getElementById('inactive-servers-content');
  const arrow = document.querySelector('#inactive-servers-header .arrow');
  if (content.style.display === 'none' || content.style.display === '') {
    content.style.display = 'grid';
    arrow.textContent = '▼';
  } else {
    content.style.display = 'none';
    arrow.textContent = '▶';
  }
}
async function importConfig() {
  try {
    const result = await ipcRenderer.invoke('import-config');
    if (result.success) {
      alert(result.message);
      await loadConfig();
      renderServers();
    } else {
      alert(result.message || result.error);
    }
  } catch (error) {
    console.error('Error importing config:', error);
    alert('Failed to import config file.');
  }
}

async function importSSHKey() {
  try {
    const result = await ipcRenderer.invoke('import-ssh-key');
    if (result.success) {
      alert(result.message);
    } else {
      alert(result.message || result.error);
    }
  } catch (error) {
    console.error('Error importing SSH key:', error);
    alert('Failed to import SSH key.');
  }
}
async function loadPaths() {
  const paths = await ipcRenderer.invoke('get-paths');
  document.getElementById('config-path').textContent = paths.configPath;
  document.getElementById('ssh-key-path').textContent = paths.sshKeyPath;
}

async function setConfigPath() {
  const result = await ipcRenderer.invoke('show-open-dialog', {
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (!result.canceled) {
    const newPath = result.filePaths[0];
    await ipcRenderer.invoke('set-config-path', newPath);
    loadPaths();
    renderServers();  // Reload the server list with the new configuration
  }
}

async function saveConfig() {
  const result = await ipcRenderer.invoke('save-config');
  if (result.success) {
    alert('Configuration saved successfully');
  } else {
    alert('Failed to save configuration: ' + result.error);
  }
}

async function setSshKeyPath() {
  const result = await ipcRenderer.invoke('show-open-dialog', {
    properties: ['openFile']
  });
  if (!result.canceled) {
    const newPath = result.filePaths[0];
    await ipcRenderer.invoke('set-ssh-key-path', newPath);
    loadPaths();
  }
}

// Wait for the DOM to be fully loaded before creating UI elements
document.addEventListener('DOMContentLoaded', async () => {
  await loadPaths();  // Load paths first
  await loadConfig();
  renderServers();

  // Set up event listeners
  document.getElementById('add-server-btn').addEventListener('click', () => openServerModal());
  document.querySelector('.modal .close').addEventListener('click', closeServerModal);
  document.getElementById('server-form').addEventListener('submit', handleServerFormSubmit);
  document.getElementById('inactive-servers-header').addEventListener('click', toggleInactiveServers);
  // document.getElementById('import-config-btn').addEventListener('click', importConfig);
  // document.getElementById('import-ssh-key-btn').addEventListener('click', importSSHKey);
  document.getElementById('server-type').addEventListener('change', updateServerTypeFields);
  document.getElementById('set-config-path-btn').addEventListener('click', setConfigPath);
  document.getElementById('save-config-btn').addEventListener('click', saveConfig);
  document.getElementById('set-ssh-key-path-btn').addEventListener('click', setSshKeyPath);

  document.querySelector('.close-log').addEventListener('click', closeLogModal);

  document.querySelector('.close-terminal').addEventListener('click', closeTerminalModal);

  window.onclick = function(event) {
    const termModal = document.getElementById('terminal-modal');

    const logModal = document.getElementById('log-modal');
    if (event.target == logModal) {
      logModal.style.display = 'none';
    }
    if (event.target == termModal) {
      closeTerminalModal();
    }
  }
  
  // Update statuses every 5 seconds using batch updates
  setInterval(() => {
    if (config) {
      batchUpdateServerStatuses(); // Use the new batch update function
    }
  }, 5000);
});
