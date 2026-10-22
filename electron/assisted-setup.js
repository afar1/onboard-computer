const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
let installingHost = false;
const brewPath = () => ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find(p => fs.existsSync(p));
const { setupPrompt } = require('./setup-prompt');
const HOSTS = {
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/download/' },
  claude: { name: 'Claude', url: 'https://claude.ai/download' },
};
function appPath(name) {
  return [path.join('/Applications', name + '.app'), path.join(os.homedir(), 'Applications', name + '.app')].find(p => fs.existsSync(p));
}
async function fieldTheoryRequest(route, action) {
  const discovery = JSON.parse(await fs.promises.readFile(path.join(os.homedir(), '.fieldtheory/browser-helper.json'), 'utf8'));
  if (discovery.host !== '127.0.0.1' || !Number.isInteger(discovery.port) || discovery.port < 1 || discovery.port > 65535 || typeof discovery.token !== 'string') throw new Error('Invalid Field Theory connection. Reopen Field Theory and retry.');
  const response = await fetch(`http://127.0.0.1:${discovery.port}/native/onboarding/${route}`, {
    method: action ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { 'X-FieldTheory-Browser-Token': discovery.token, 'X-FieldTheory-Browser-Client': 'onboard-setup', 'Content-Type': 'application/json' },
    ...(action ? { body: JSON.stringify({ action }) } : {}),
  });
  if (!response.ok) throw new Error(`Field Theory setup check unavailable (${response.status}). Open or update Field Theory, then retry.`);
  return response.json();
}
function projectStatus(s) {
  const str = v => typeof v === 'string' ? v.slice(0, 100) : null;
  const bool = v => typeof v === 'boolean' ? v : null;
  return {
    app: { version: str(s.app?.version) },
    account: { signedIn: bool(s.account?.signedIn) },
    permissions: { microphone: str(s.permissions?.microphone), screen: str(s.permissions?.screen), accessibility: bool(s.permissions?.accessibility) },
    recording: { source: str(s.recording?.source), hotkey: str(s.recording?.hotkey), engine: str(s.recording?.engine) },
    parakeet: { runtimeInstalled: bool(s.parakeet?.runtimeInstalled), serverState: str(s.parakeet?.serverState), activeEngine: str(s.parakeet?.activeEngine), engines: Array.isArray(s.parakeet?.engines) ? s.parakeet.engines.slice(0, 10).map(e => ({ engine: str(e.engine), verified: bool(e.verified), needsReinstall: bool(e.needsReinstall), hasError: Boolean(e.lastError || e.setupError) })) : [] },
    setup: { parakeetPreparing: bool(s.setup?.parakeetPreparing) },
  };
}

async function status() {
  let fieldTheory = null;
  let fieldTheoryError = null;
  try { const result = await fieldTheoryRequest('status'); if (!result.ok || result.status?.schemaVersion !== 1) throw new Error('Update Field Theory'); fieldTheory = projectStatus(result.status); } catch { fieldTheoryError = 'Open a Field Theory build with setup checks, then check again.'; }
  return { checkedAt: new Date().toISOString(), apps: { chatgpt: !!appPath('ChatGPT'), claude: !!appPath('Claude'), fieldTheory: !!appPath('Field Theory') }, fieldTheory, fieldTheoryError, homebrewAvailable: !!brewPath(), computerUse: 'Requires a test in your assistant' };
}
function register({ ipcMain, shell, clipboard }) {
  ipcMain.handle('assisted:status', status);
  ipcMain.handle('assisted:install', async (_event, host) => {
    if (!HOSTS[host]) throw new Error('Unknown application.');
    if (appPath(HOSTS[host].name)) return { installed: true };
    if (installingHost) throw new Error('An assistant installation is already running. Wait for it to finish.');
    const brew = brewPath();
    if (!brew) throw new Error('Homebrew is not installed. Use the Download button instead.');
    installingHost = true;
    try {
      await execFileAsync(brew, ['install', '--cask', host], { timeout: 15 * 60 * 1000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1' } });
      if (!appPath(HOSTS[host].name)) throw new Error('Installation finished, but the app was not found. Open the download page and install it manually.');
      return { installed: true };
    } catch { throw new Error('Installation did not complete. Check your network or any other Homebrew installation, then retry. You can also use Download.'); }
    finally { installingHost = false; }
  });
  ipcMain.handle('assisted:prompt', async (_event, host) => {
    if (!HOSTS[host]) throw new Error('Choose ChatGPT or Claude.');
    const snapshot = await status();
    // Never include the helper discovery file or authentication credentials.
    const prompt = setupPrompt(host, snapshot);
    clipboard.writeText(prompt);
    return { prompt };
  });
  ipcMain.handle('assisted:open', async (_event, target) => {
    if (target === 'fieldTheory') {
      const installed = appPath('Field Theory');
      if (installed) return shell.openPath(installed);
      return shell.openExternal('https://fieldtheory.dev');
    }
    if (!HOSTS[target]) throw new Error('Unknown application.');
    const installed = appPath(HOSTS[target].name);
    return installed ? shell.openPath(installed) : shell.openExternal(HOSTS[target].url);
  });
  ipcMain.handle('assisted:action', async (_event, action) => {
    if (!['open-onboarding', 'open-account', 'open-permissions', 'open-transcription', 'prepare-parakeet'].includes(action)) throw new Error('Unknown setup action.');
    return fieldTheoryRequest('action', action);
  });
}
module.exports = { status, register, fieldTheoryRequest, projectStatus };
