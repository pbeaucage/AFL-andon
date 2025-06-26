# AFL Andon

This Electron application provides a simple control panel for starting and stopping
server processes over SSH. It also includes an on-screen terminal for interactive
sessions.

## Prerequisites

- **Node.js 20** or newer is required. Install via [nvm](https://github.com/nvm-sh/nvm) or your
  preferred method.

## Installation

Install dependencies and audit them for security issues:

```bash
npm install
npm audit fix
```

If additional issues remain after running `npm audit fix`, review the log and
update the affected packages.

## Running

Start the application with:

```bash
npm start
```

For development with debugging enabled use:

```bash
npm run dev
```

## Building

Builds for your current platform can be created with:

```bash
npm run build
```

See `package.json` for platform-specific build scripts.

## Windows Support

Servers running Windows can now be managed through [WinRM](https://learn.microsoft.com/en-us/windows/win32/winrm/windows-remote-management).
Add `"protocol": "winrm"` and a `"password"` field to the server configuration.

When adding a server in the UI, select **Windows (WinRM)** to specify a Windows host.
The application will execute commands via PowerShell remoting instead of SSH.
