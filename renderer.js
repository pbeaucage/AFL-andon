// renderer.js (Renderer process)
const { ipcRenderer } = require('electron');
const fetch = require('node-fetch');

let config;
let editingServer = null;

async function loadConfig() {
  config = await ipcRenderer.invoke('get-config');
}

async function saveConfig() {
  await ipcRenderer.invoke('save-config', config);
}

async function controlServer(serverName, action) {
  try {
    const result = await ipcRenderer.invoke(`${action}-server`, serverName);
    if (result.success) {
      console.log(`${action} successful for ${serverName}`);
      updateServerStatus(serverName);
    } else {
      console.error(`${action} failed for ${serverName}:`, result.error);
    }
  } catch (error) {
    console.error(`Error during ${action} for ${serverName}:`, error);
  }
}

async function updateServerStatus(serverName) {
  try {
    const sshResult = await ipcRenderer.invoke('get-server-status', serverName);
    const httpResult = await checkHttpEndpoint(serverName);
    
    const sshStatusElement = document.getElementById(`${serverName}-ssh-status`);
    const httpStatusElement = document.getElementById(`${serverName}-http-status`);
    
    if (sshStatusElement) {
      sshStatusElement.textContent = sshResult.success && sshResult.status ? 'SSH UP' : 'SSH DOWN';
      sshStatusElement.className = `status-indicator ${sshResult.success && sshResult.status ? 'status-up' : 'status-down'}`;
    }
    if (httpStatusElement) {
      httpStatusElement.textContent = httpResult ? 'HTTP UP' : 'HTTP DOWN';
      httpStatusElement.className = `status-indicator ${httpResult ? 'status-up' : 'status-down'}`;
    }
  } catch (error) {
    console.error(`Error getting status for ${serverName}:`, error);
  }
}

async function checkHttpEndpoint(serverName) {
  const { host, httpPort } = config[serverName];
  const url = `http://${host}:${httpPort}/get_server_time`;
  try {
    const response = await fetch(url, { timeout: 5000 });
    return response.ok;
  } catch (error) {
    console.error(`HTTP check failed for ${serverName}:`, error);
    return false;
  }
}

function createServerControls(serverName) {
  const serverConfig = config[serverName];
  const container = document.createElement('div');
  container.className = `server-container`;
  
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
  infoElement.textContent = `SSH: ${serverConfig.host}, HTTP: ${serverConfig.host}:${serverConfig.httpPort}`;
  container.appendChild(infoElement);

  const statusContainer = document.createElement('div');
  statusContainer.className = 'status-indicators';

  const sshStatusElement = document.createElement('span');
  sshStatusElement.id = `${serverName}-ssh-status`;
  sshStatusElement.className = 'status-indicator';
  statusContainer.appendChild(sshStatusElement);

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

async function viewServerLog(serverName) {
  try {
    const result = await ipcRenderer.invoke('get-server-log', serverName);
    if (result.success) {
      console.log(result.log);
      alert(result.log); // Temporary solution, replace with a better UI
    } else {
      console.error(`Failed to get log for ${serverName}:`, result.error);
    }
  } catch (error) {
    console.error(`Error getting log for ${serverName}:`, error);
  }
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
    form.elements['server-port'].value = server.httpPort;
    form.elements['server-script'].value = server.server_script;
    form.elements['server-name'].disabled = true;
  } else {
    modalTitle.textContent = 'Add New Server';
    form.reset();
    form.elements['server-name'].disabled = false;
  }

  modal.style.display = 'block';
}

function closeServerModal() {
  const modal = document.getElementById('server-modal');
  modal.style.display = 'none';
  editingServer = null;
}

async function handleServerFormSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const serverName = form.elements['server-name'].value;
  const serverConfig = {
    host: form.elements['server-host'].value,
    httpPort: parseInt(form.elements['server-port'].value, 10),
    server_script: form.elements['server-script'].value,
    active: true
  };

  if (editingServer) {
    config[editingServer] = { ...config[editingServer], ...serverConfig };
  } else {
    config[serverName] = serverConfig;
  }

  await saveConfig();
  closeServerModal();
  renderServers();
}

function toggleServerActive(serverName) {
  config[serverName].active = !config[serverName].active;
  saveConfig();
  renderServers(); // Re-render all servers after toggling
}

function renderServers() {
  const activeServersContainer = document.getElementById('active-servers');
  const inactiveServersContainer = document.getElementById('inactive-servers-content');
  
  // Clear existing content
  activeServersContainer.innerHTML = '';
  inactiveServersContainer.innerHTML = '';

  // Sort servers: active first, then alphabetically
  const sortedServers = Object.keys(config).sort((a, b) => {
    if (config[a].active === config[b].active) {
      return a.localeCompare(b);
    }
    return config[b].active - config[a].active;
  });

  sortedServers.forEach(serverName => {
    const serverControls = createServerControls(serverName);
    if (config[serverName].active) {
      activeServersContainer.appendChild(serverControls);
    } else {
      inactiveServersContainer.appendChild(serverControls);
    }
  });

  // Update inactive servers count
  const inactiveCount = sortedServers.filter(name => !config[name].active).length;
  document.getElementById('inactive-servers-header').querySelector('.arrow').textContent = 
    `▶ Inactive Servers (${inactiveCount})`;
}

// Function to toggle inactive servers visibility
function toggleInactiveServers() {
  const content = document.getElementById('inactive-servers-content');
  const arrow = document.querySelector('#inactive-servers-header .arrow');
  if (content.style.display === 'none' || content.style.display === '') {
    content.style.display = 'block';
    arrow.classList.add('down');
  } else {
    content.style.display = 'none';
    arrow.classList.remove('down');
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

async function joinServer(serverName) {
  try {
    const result = await ipcRenderer.invoke('join-server', serverName);
    if (result.success) {
      console.log(`Joined server ${serverName}`);
      // You might want to handle this differently since joining a server
      // typically means taking over the terminal
      alert(`Joined server ${serverName}. Check your terminal.`);
    } else {
      console.error(`Failed to join server ${serverName}:`, result.error);
      alert(`Failed to join server ${serverName}: ${result.error}`);
    }
  } catch (error) {
    console.error(`Error joining server ${serverName}:`, error);
    alert(`Error joining server ${serverName}: ${error.message}`);
  }
}

// Wait for the DOM to be fully loaded before creating UI elements
document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  renderServers();

  // Set up event listeners
  document.getElementById('add-server-btn').addEventListener('click', () => openServerModal());
  document.querySelector('.modal .close').addEventListener('click', closeServerModal);
  document.getElementById('server-form').addEventListener('submit', handleServerFormSubmit);
  document.getElementById('inactive-servers-header').addEventListener('click', toggleInactiveServers);
  document.getElementById('import-config-btn').addEventListener('click', importConfig);
  document.getElementById('import-ssh-key-btn').addEventListener('click', importSSHKey);

  // Update statuses every 5 seconds
  setInterval(() => {
    if (config) {
      Object.keys(config).forEach(updateServerStatus);
    }
  }, 5000);
});