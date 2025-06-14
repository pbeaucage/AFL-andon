const { Client } = require('ssh2');
const fs = require('fs').promises;
const path = require('path');

class SSHOperations {
  constructor(configPath, sshKeyPath) {
    this.config = {};
    this.sshKeyPath = sshKeyPath;
    this.configPath = configPath;
    this.screenSessionCache = {}; // Cache for screen sessions by host
  }

  async initialize() {
    await this.loadConfig();
    await this.loadSSHKey();
  }

  async loadConfig() {
    try {
      const configData = await fs.readFile(this.configPath, 'utf8');
      this.config = JSON.parse(configData);
      // Set default values if not specified
      Object.keys(this.config).forEach(serverName => {
        const server = this.config[serverName];
        if (!server.httpPort) server.httpPort = 5000;
        if (!server.shell) server.shell = 'bash';
        if (!server.statusEndpoint) server.statusEndpoint = '/get_server_time';
        if (!('active' in server)) server.active = true;
        if (!server.username) {
          console.warn(`Username not specified for server ${serverName}. Using current user.`);
          server.username = require('os').userInfo().username;
        }
      });
    } catch (error) {
      console.error('Error loading config:', error);
    }
  }
  async saveConfig() {
    try {
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('Error saving config:', error);
      throw error;
    }
  }

  async loadSSHKey() {
    try {
      this.sshKey = await fs.readFile(this.sshKeyPath);
    } catch (error) {
      console.error('Error loading SSH key:', error);
    }
  }

  setConfigPath(newPath) {
    this.configPath = newPath;
  }

  setSshKeyPath(newPath) {
    this.sshKeyPath = newPath;
  }
  addServer(serverName, serverConfig) {
    this.config[serverName] = serverConfig;
  }

  removeServer(serverName) {
    delete this.config[serverName];
  }

  updateServer(serverName, serverConfig) {
    this.config[serverName] = { ...this.config[serverName], ...serverConfig };
  }

  toggleServerActive(serverName) {
    if (this.config[serverName]) {
      this.config[serverName].active = !this.config[serverName].active;
    }
  }

  async executeCommand(serverName, command) {
    return new Promise((resolve) => {
      const serverConfig = this.config[serverName];
      if (!serverConfig) {
        resolve({ success: false, sshDown: true });
        return;
      }

      const conn = new Client();
      conn.on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            conn.end();
            resolve({ success: false, sshDown: true });
            return;
          }

          let output = '';
          stream.on('close', (code, signal) => {
            conn.end();
            resolve({ success: true, output, code, signal });
          }).on('data', (data) => {
            output += data;
          }).stderr.on('data', (data) => {
            output += data;
          });
        });
      }).on('error', (err) => {
        console.error(`SSH connection error for ${serverName}:`, err);
        resolve({ success: false, sshDown: true });
      }).connect({
        host: serverConfig.host,
        port: 22,
        username: serverConfig.username,
        privateKey: this.sshKey
      });
    });
  }

  async startServer(serverName) {
    const serverConfig = this.config[serverName];
    const screenLogPath = path.join('.afl', `${serverConfig.screen_name}.screenlog`);
    let startCommand;

    if (serverConfig.server_module) {
      let command = `python -m ${serverConfig.server_module}`;
      if (serverConfig.conda_env) {
        command = `conda activate ${serverConfig.conda_env};${command}`;
      }
      startCommand = `screen -d -m -L -Logfile $\{HOME}/${screenLogPath} -S ${serverConfig.screen_name} ${serverConfig.shell} -ci "${command}"`;
    } else if (serverConfig.server_script) {
      startCommand = `screen -d -m -L -Logfile $\{HOME}/${screenLogPath} -S ${serverConfig.screen_name} ${serverConfig.server_script}`;
    } else {
      return { success: false, error: 'Neither server_module nor server_script specified in config' };
    }

    return this.executeCommand(serverName, startCommand);
  }

  async stopServer(serverName) {
    const serverConfig = this.config[serverName];
    const stopCommand = `screen -X -S ${serverConfig.screen_name} quit`;
    return this.executeCommand(serverName, stopCommand);
  }

  async restartServer(serverName) {
    const stopResult = await this.stopServer(serverName);
    if (!stopResult.success && !stopResult.sshDown) {
      return stopResult;
    }
    return this.startServer(serverName);
  }

  async getServerStatus(serverName) {
    const serverConfig = this.config[serverName];
    
    // Use the cached screen sessions if they exist for this host and are recent
    const host = serverConfig.host;
    const cachedData = this.screenSessionCache && this.screenSessionCache[host];
    const now = Date.now();
    
    if (cachedData && (now - cachedData.timestamp) < 5000) { // Cache valid for 5 seconds
      return {
        success: true,
        status: cachedData.sessions.includes(serverConfig.screen_name)
      };
    }
    
    const statusCommand = 'screen -ls';
    const result = await this.executeCommand(serverName, statusCommand);
    
    if (!result.success) {
      return { success: false, sshDown: true };
    }
    
    // Parse and cache all screen sessions for this host
    if (!this.screenSessionCache) {
      this.screenSessionCache = {};
    }
    
    // Extract all session names from the screen -ls output
    const screenSessions = [];
    const lines = result.output.split('\n');
    for (const line of lines) {
      // Look for lines containing screen session info
      const match = line.match(/\d+\.([^\s\t]+)/); // Extracts session name
      if (match && match[1]) {
        screenSessions.push(match[1]);
      }
    }
    
    // Cache the results
    this.screenSessionCache[host] = {
      timestamp: now,
      sessions: screenSessions
    };
    
    return {
      success: true,
      status: screenSessions.includes(serverConfig.screen_name)
    };
  }

  // Get status for all servers on a given host in one call
  async getBatchServerStatus(host) {
    // Find a server from this host to execute the command
    const serverName = Object.keys(this.config).find(name => 
      this.config[name].host === host
    );
    
    if (!serverName) {
      return { success: false, error: `No server configured for host ${host}` };
    }
    
    const statusCommand = 'screen -ls';
    const result = await this.executeCommand(serverName, statusCommand);
    
    if (!result.success) {
      return { success: false, sshDown: true, host };
    }
    
    // Extract all session names from the screen -ls output
    const screenSessions = [];
    const lines = result.output.split('\n');
    for (const line of lines) {
      const match = line.match(/\d+\.([^\s\t]+)/); // Extracts session name
      if (match && match[1]) {
        screenSessions.push(match[1]);
      }
    }
    
    // Cache the results
    const now = Date.now();
    if (!this.screenSessionCache) {
      this.screenSessionCache = {};
    }
    this.screenSessionCache[host] = {
      timestamp: now,
      sessions: screenSessions
    };
    
    return { success: true, host, sessions: screenSessions };
  }
  
  // Group all servers by host for efficient batch checking
  getServersByHost() {
    const hostMap = {};
    
    Object.entries(this.config).forEach(([serverName, serverConfig]) => {
      if (!serverConfig.active) return;
      
      const host = serverConfig.host;
      if (!hostMap[host]) {
        hostMap[host] = [];
      }
      hostMap[host].push(serverName);
    });
    
    return hostMap;
  }
  
  async getServerLog(serverName, lines = 200) {
    const serverConfig = this.config[serverName];
    const logPath = path.join('.afl', `${serverConfig.screen_name}.screenlog`);
    const logCommand = `tail -n ${lines} $\{HOME}/${logPath}`;
    return this.executeCommand(serverName, logCommand);
  }

  async joinServer(serverName) {
    const serverConfig = this.config[serverName];
    const joinCommand = `screen -x ${serverConfig.screen_name}`;
    return this.executeCommand(serverName, joinCommand);
  }
}

module.exports = SSHOperations;