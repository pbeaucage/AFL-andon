const winrm = require('nodejs-winrm');
const winrmHttp = require('nodejs-winrm/src/http.js');
const { NtlmClient } = require('axios-ntlm');
const { parseString } = require('xml2js');

async function sendHttpNtlm(data, host, port, path, creds) {
  const client = NtlmClient({ username: creds.username, password: creds.password, domain: creds.domain || '' });
  const url = `http://${host}:${port}${path}`;
  const response = await client({
    url,
    method: 'post',
    data,
    responseType: 'text',
    headers: {
      'Content-Type': 'application/soap+xml;charset=UTF-8',
      'User-Agent': 'NodeJS WinRM Client'
    }
  });
  return new Promise((resolve, reject) => {
    parseString(response.data, (err, result) => {
      if (err) reject(err); else resolve(result);
    });
  });
}

const originalSendHttp = winrmHttp.sendHttp;
winrmHttp.sendHttp = async function(data, host, port, path, auth) {
  if (auth && typeof auth === 'object') {
    return sendHttpNtlm(data, host, port, path, auth);
  }
  return originalSendHttp(data, host, port, path, auth);
};

async function runCommand(command, host, username, password, port = 5985, usePowershell = false) {
  const params = { host, port, path: '/wsman', auth: { username, password } };
  const shellId = await winrm.shell.doCreateShell(params);
  params.shellId = shellId;
  params.command = command;
  const commandId = usePowershell ?
    await winrm.command.doExecutePowershell(params) :
    await winrm.command.doExecuteCommand(params);
  params.commandId = commandId;
  const output = await winrm.command.doReceiveOutput(params);
  await winrm.shell.doDeleteShell(params);
  return output;
}

module.exports = { runCommand };
