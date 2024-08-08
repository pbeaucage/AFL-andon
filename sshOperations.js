// sshOperations.js
const { Client } = require('ssh2');
const fs = require('fs-extra');
const path = require('path');

class SSHOperations {
  constructor(configPath) {
    this.config = {};
    this.loadConfig(configPath);
  }

  loadConfig(configPath) {
    try {
      this.config = fs.readJsonSync(configPath);
      // Set default HTTP port if not specified
      Object.keys(this.config).forEach(serverName => {
        if (!this.config[serverName].httpPort) {
          this.config[serverName].httpPort = 5000;
        }
      });
    } catch (error) {
      console.error('Error loading config:', error);
    }
  }

  executeCommand(serverName, command) {
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
        port: 22, // Always use the default SSH port
        username: process.env.SSH_USERNAME,
        privateKey: fs.readFileSync(process.env.SSH_PRIVATE_KEY_PATH)
      });
    });
  }


  async startServer(serverName) {
    const serverConfig = this.config[serverName];
    const command = `screen -d -m -L -Logfile ${path.join(process.env.HOME, '.afl', `${serverConfig.screen_name}.screenlog`)} -S ${serverConfig.screen_name} ${serverConfig.server_script}`;
    return this.executeCommand(serverName, command);
  }

  async stopServer(serverName) {
    const serverConfig = this.config[serverName];
    const command = `screen -X -S ${serverConfig.screen_name} quit`;
    return this.executeCommand(serverName, command);
  }

  async restartServer(serverName) {
    await this.stopServer(serverName);
    return this.startServer(serverName);
  }

  async getServerStatus(serverName) {
    const command = 'screen -ls';
    const { output } = await this.executeCommand(serverName, command);
    const serverConfig = this.config[serverName];
    return output.includes(serverConfig.screen_name);
  }

  async getServerLog(serverName, lines = 100) {
    const serverConfig = this.config[serverName];
    const logPath = path.join(process.env.HOME, '.afl', `${serverConfig.screen_name}.screenlog`);
    const command = `tail -n ${lines} ${logPath}`;
    return this.executeCommand(serverName, command);
  }
}

module.exports = SSHOperations;