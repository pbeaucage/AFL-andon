const { Client } = require('ssh2');
const fs = require('fs').promises;
const path = require('path');

class SSHOperations {
  constructor(configPath, sshKeyPath) {
    this.config = {};
    this.sshKeyPath = sshKeyPath;
    this.configPath = configPath;
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
        if (!server.active) server.active = true;
      });
    } catch (error) {
      console.error('Error loading config:', error);
    }
  }

  async loadSSHKey() {
    try {
      this.sshKey = await fs.readFile(this.sshKeyPath);
    } catch (error) {
      console.error('Error loading SSH key:', error);
    }
  }

  async executeCommand(serverName, command) {
    return new Promise((resolve, reject) => {
      const serverConfig = this.config[serverName];
      if (!serverConfig) {
        reject(new Error(`Server ${serverName} not found in config`));
        return;
      }

      const conn = new Client();
      conn.on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            conn.end();
            reject(err);
            return;
          }

          let output = '';
          stream.on('close', (code, signal) => {
            conn.end();
            resolve({ output, code, signal });
          }).on('data', (data) => {
            output += data;
          }).stderr.on('data', (data) => {
            output += data;
          });
        });
      }).connect({
        host: serverConfig.host,
        port: 22,
        username: process.env.SSH_USERNAME,
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
      throw new Error('Neither server_module nor server_script specified in config');
    }

    return this.executeCommand(serverName, startCommand);
  }

  async stopServer(serverName) {
    const serverConfig = this.config[serverName];
    const stopCommand = `screen -X -S ${serverConfig.screen_name} quit`;
    return this.executeCommand(serverName, stopCommand);
  }

  async restartServer(serverName) {
    await this.stopServer(serverName);
    return this.startServer(serverName);
  }

  async getServerStatus(serverName) {
    const serverConfig = this.config[serverName];
    const statusCommand = 'screen -ls';
    const { output } = await this.executeCommand(serverName, statusCommand);
    return output.includes(serverConfig.screen_name);
  }

  async getServerLog(serverName, lines = 100) {
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