// renderer.js — UI logic for the Onboard app.
// Loads configuration from .onboard YAML files and renders tools/apps.

// ─── Release Notes Data ────────────────────────────────────────────

const RELEASE_NOTES = {
  '0.1.2': [
    'Uninstall and upgrade dependencies with version tracking',
    'Terminal output view — inline or pop-out window',
    'Activity log tracks all install/upgrade/uninstall actions',
    'Redesigned footer with file picker and theme toggle',
  ],
  '0.1.0': [
    'Initial release with auto-update support',
    'Load configs from files, URLs, or defaults',
    'Install Homebrew, Git, Node.js, Python, and more',
  ],
};

const RELEASE_DATES = {
  '0.1.2': 'Feb 11 2026',
  '0.1.0': 'Feb 11 2026',
};

function hasReleaseNotes(version) {
  return version in RELEASE_NOTES && RELEASE_NOTES[version].length > 0;
}

// ─── State ─────────────────────────────────────────────────────────

let currentConfig = null;
let toolStates = {};   // { [id]: { status, installed, installing, version, latestVersion, hasUpdate } }
let appStates = {};    // { [id]: { status, installed, installing, processId } }
let homeDir = '';
let activeProcesses = {}; // Track active install processes for cancellation

// Terminal output state
let terminalOutputs = {};  // { [id]: { lines: [], poppedOut: false, active: false } }
const MAX_TERMINAL_LINES = 200; // Keep last N lines

// Update state
let appVersion = '0.0.0';
let updateStatus = 'idle';
let updateError = null;
let versionHovered = false;
let showReleaseNotes = false;

// ─── Config Loading ────────────────────────────────────────────────

async function loadConfig(source) {
  if (!source) {
    showEmptyState();
    return false;
  }

  let result;

  try {
    setStatusLoading(true);
    if (source.startsWith('http://') || source.startsWith('https://')) {
      setStatus('Loading config from URL...');
      result = await window.onboard.loadConfigURL(source);
    } else if (source === 'bundled' || source.startsWith('bundled:')) {
      const name = source === 'bundled' ? undefined : source.slice('bundled:'.length);
      setStatus('Loading config...');
      result = await window.onboard.loadBundledConfig(name);
    } else {
      setStatus('Loading config...');
      result = await window.onboard.loadConfigFile(source);
    }
    setStatusLoading(false);
  } catch (err) {
    setStatusLoading(false);
    showError(`Failed to load config: ${err.message}`);
    return false;
  }

  // Handle errors from main process
  if (result && result.error) {
    showError(`Config error: ${result.error}`);
    return false;
  }

  // Reset state for new config
  currentConfig = result;
  toolStates = {};
  appStates = {};

  (currentConfig.dependencies || []).forEach(d => {
    toolStates[d.id] = { status: 'unchecked', installed: false };
  });
  (currentConfig.apps || []).forEach(a => {
    appStates[a.id] = { status: 'unchecked', installed: false };
  });

  // Save for persistence
  localStorage.setItem('lastConfigPath', source);

  // Save to config history
  saveToConfigHistory(source, currentConfig?.name);

  // Update UI
  updateConfigDisplay();
  renderToolCards();
  renderAppCards();
  setStatus('Ready (drop .onboard file)');

  // Auto-check all tools
  checkAllTools();

  return true;
}

function loadConfigFromURL() {
  const url = document.getElementById('config-url').value.trim();
  if (!url) {
    showError('Please enter a URL');
    return;
  }
  loadConfig(url);
}

function resetConfig() {
  localStorage.removeItem('lastConfigPath');
  currentConfig = null;
  toolStates = {};
  appStates = {};
  showEmptyState();
}

function formatPath(filePath) {
  if (!filePath) return '';
  if (filePath === 'bundled' || filePath.startsWith('bundled:')) return 'Built-in config';
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath;
  // Replace home directory with ~
  if (homeDir && filePath.startsWith(homeDir)) {
    return '~' + filePath.slice(homeDir.length);
  }
  return filePath;
}

function updateConfigDisplay() {
  const name = currentConfig?.name || '';
  const desc = currentConfig?.description || '';

  document.getElementById('title-config-name').textContent = name;
  document.getElementById('config-name-display').textContent = name;
  document.getElementById('config-description').textContent = desc;
  document.title = name ? `onboard.computer — ${name}` : 'onboard.computer';

  // Show config path
  const lastPath = localStorage.getItem('lastConfigPath');
  const pathEl = document.getElementById('config-path');
  if (pathEl) {
    pathEl.textContent = formatPath(lastPath);
  }

  // Show main content, hide empty state
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('main-content').style.display = 'block';
}

function showEmptyState() {
  document.getElementById('empty-state').style.display = 'flex';
  document.getElementById('main-content').style.display = 'none';
  document.getElementById('title-config-name').textContent = '';
  document.getElementById('config-url').value = '';
  document.title = 'onboard.computer';
  setStatus('Drop a config file to get started');
}

// ─── Rendering ─────────────────────────────────────────────────────

function renderIcon(item) {
  const bg = item.icon_bg || '#30363d';

  if (item.icon_img) {
    // Check if it's a URL or bundled filename
    const src = item.icon_img.startsWith('http') ? item.icon_img : `assets/${item.icon_img}`;
    return `<div class="tool-icon" style="background: ${bg}; padding: 4px;">
      <img src="${src}" alt="${item.name}" onerror="this.parentElement.innerHTML='${item.icon || '📦'}'">
    </div>`;
  }

  return `<div class="tool-icon" style="background: ${bg};">${item.icon || '📦'}</div>`;
}

function renderStatusBadge(state, type = 'app') {
  if (state.status === 'checking') {
    return '<span class="status-badge checking">Checking...</span>';
  }
  if (state.installed) {
    if (state.version) {
      if (state.hasUpdate && state.latestVersion) {
        return `<span class="status-badge update-available" title="Update available: ${state.latestVersion}">v${state.version} → v${state.latestVersion}</span>`;
      }
      return `<span class="status-badge installed">v${state.version}</span>`;
    }
    return '<span class="status-badge installed">✓ Installed</span>';
  }
  return '<span class="status-badge missing">Not installed</span>';
}

function renderAction(item, state, type, terminalInfo = null) {
  if (state.status === 'checking') {
    return '<span class="spinner"></span>';
  }

  // Helper to render terminal history button
  const terminalBtn = (terminalId, show) => show ? `<button class="btn btn-sm btn-terminal" id="terminal-history-${terminalId}"
    onclick="showTerminalHistory('${terminalId}')" title="View output">
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
  </button>` : '';

  // App-specific states
  if (type === 'app') {
    if (state.installing) {
      return `<div class="install-progress">
        <div class="progress-bar"><div class="progress-shimmer"></div></div>
        <button class="cancel-btn" onclick="cancelInstall('${item.id}')" title="Cancel">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>`;
    }
    if (state.installed) {
      const showTerminal = terminalInfo && !terminalInfo.isActive && terminalInfo.hasOutput;
      return `<div class="app-actions">
        ${terminalBtn(terminalInfo?.id, showTerminal)}
        <button class="btn btn-sm btn-uninstall" onclick="revealAppInFinder('${item.id}')" title="Show in Finder">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
        <button class="btn btn-sm btn-open" onclick="openApp('${item.id}')">Open</button>
      </div>`;
    }
  } else {
    // Tool (dependency) states
    if (state.installing) {
      return `<div class="install-spinner">
        <span class="spinner"></span>
        <button class="cancel-btn" onclick="cancelToolInstall('${item.id}')" title="Cancel">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>`;
    }
    if (state.installed) {
      const showTerminal = terminalInfo && !terminalInfo.isActive && terminalInfo.hasOutput;
      let actions = '';
      // Terminal history button (left-most, hidden until hover)
      actions += terminalBtn(terminalInfo?.id, showTerminal);
      // Uninstall button (hidden until hover)
      actions += `<button class="btn btn-sm btn-uninstall" onclick="uninstallTool('${item.id}')" title="Uninstall">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
        </svg>
      </button>`;
      // Show upgrade button if update available
      if (state.hasUpdate && state.latestVersion) {
        actions += `<button class="btn btn-sm btn-upgrade" onclick="upgradeTool('${item.id}')" title="Upgrade to ${state.latestVersion}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7"/>
          </svg>
          Upgrade
        </button>`;
      }
      return `<div class="tool-actions">${actions}</div>`;
    }
  }

  const dependsOn = item.depends_on;
  if (dependsOn) {
    const depState = type === 'tool' ? toolStates[dependsOn] : appStates[dependsOn];
    if (depState && !depState.installed) {
      return `<button class="btn btn-sm" disabled>Needs ${dependsOn}</button>`;
    }
  }

  const onclick = type === 'tool'
    ? `installTool('${item.id}')`
    : `installApp('${item.id}')`;

  return `<button class="btn btn-primary btn-sm" onclick="${onclick}">Install</button>`;
}

function renderToolCards() {
  const container = document.getElementById('tools-container');
  const tools = currentConfig?.dependencies || [];
  container.innerHTML = '';

  tools.forEach(tool => {
    const state = toolStates[tool.id] || { status: 'unchecked', installed: false };
    const terminalId = `tool-${tool.id}`;
    const output = terminalOutputs[terminalId];
    const hasOutput = output?.lines?.length > 0;
    const isActive = output?.active;
    const isPoppedOut = output?.poppedOut;

    const terminalInfo = { id: terminalId, hasOutput, isActive };
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.id = `card-${terminalId}`;
    card.innerHTML = `
      <div class="tool-card-main">
        ${renderIcon(tool)}
        <div class="tool-info">
          <div class="tool-name">${tool.name} ${renderStatusBadge(state, 'tool')}</div>
          <div class="tool-desc">${tool.desc || ''}</div>
        </div>
        <div class="tool-action">
          ${renderAction(tool, state, 'tool', terminalInfo)}
        </div>
      </div>
      <div class="terminal-inline" id="terminal-${terminalId}" style="display: ${(hasOutput && !isPoppedOut) ? 'block' : 'none'};">
        <div class="terminal-header" onclick="toggleTerminalExpand('${terminalId}')">
          <span class="terminal-last-line"></span>
          <div class="terminal-actions">
            <button class="terminal-btn" onclick="event.stopPropagation(); popOutTerminal('${terminalId}')" title="Pop out">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="terminal-full"></div>
      </div>
    `;
    container.appendChild(card);

    // Update terminal display if there's existing output
    if (hasOutput) {
      updateTerminalDisplay(terminalId);
    }
  });

  updateDepsProgress();
}

function renderAppCards() {
  const container = document.getElementById('apps-container');
  const apps = currentConfig?.apps || [];
  container.innerHTML = '';

  apps.forEach(app => {
    const state = appStates[app.id] || { status: 'unchecked', installed: false };
    const terminalId = app.id;
    const output = terminalOutputs[terminalId];
    const hasOutput = output?.lines?.length > 0;
    const isActive = output?.active;
    const isPoppedOut = output?.poppedOut;

    const terminalInfo = { id: terminalId, hasOutput, isActive };
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.id = `card-${terminalId}`;
    card.innerHTML = `
      <div class="tool-card-main">
        ${renderIcon(app)}
        <div class="tool-info">
          <div class="tool-name">${app.name} ${renderStatusBadge(state, 'app')}</div>
          <div class="tool-desc">${app.desc || ''}</div>
        </div>
        <div class="tool-action">
          ${renderAction(app, state, 'app', terminalInfo)}
        </div>
      </div>
      <div class="terminal-inline" id="terminal-${terminalId}" style="display: ${(hasOutput && !isPoppedOut) ? 'block' : 'none'};">
        <div class="terminal-header" onclick="toggleTerminalExpand('${terminalId}')">
          <span class="terminal-last-line"></span>
          <div class="terminal-actions">
            <button class="terminal-btn" onclick="event.stopPropagation(); popOutTerminal('${terminalId}')" title="Pop out">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="terminal-full"></div>
      </div>
    `;
    container.appendChild(card);

    // Update terminal display if there's existing output
    if (hasOutput) {
      updateTerminalDisplay(terminalId);
    }
  });

  updateAppsProgress();
}

function updateDepsProgress() {
  const tools = currentConfig?.dependencies || [];
  const installed = tools.filter(t => toolStates[t.id]?.installed).length;
  const label = document.getElementById('deps-progress-label');
  if (label) {
    label.textContent = `${installed}/${tools.length} installed`;
  }
}

function updateAppsProgress() {
  const apps = currentConfig?.apps || [];
  const installed = apps.filter(a => appStates[a.id]?.installed).length;
  const label = document.getElementById('apps-progress-label');
  if (label) {
    label.textContent = `${installed}/${apps.length} installed`;
  }
}

// ─── Tool Checking ─────────────────────────────────────────────────

// Fast check - just installed status
async function checkToolFast(tool) {
  const result = await window.onboard.run(tool.check);
  toolStates[tool.id] = {
    ...toolStates[tool.id],
    status: 'checked',
    installed: result.succeeded,
  };
  renderToolCards();
  return result.succeeded;
}

// Slow enrichment - version and upgrade info (runs in background)
async function enrichToolVersion(tool) {
  if (!toolStates[tool.id]?.installed) return;

  const versionInfo = await getToolVersion(tool);
  toolStates[tool.id] = {
    ...toolStates[tool.id],
    version: versionInfo.version,
    latestVersion: versionInfo.latestVersion,
    hasUpdate: versionInfo.hasUpdate,
  };
  renderToolCards();
}

// Legacy function for re-checking after install/uninstall
async function checkTool(tool) {
  toolStates[tool.id] = { status: 'checking', installed: false };
  renderToolCards();

  const installed = await checkToolFast(tool);
  if (installed) {
    await enrichToolVersion(tool);
  }
}

async function getToolVersion(tool) {
  let version = null;
  let latestVersion = null;
  let hasUpdate = false;

  // Determine package name from install command
  const installCmd = tool.install || '';
  let pkgName = null;
  let isCask = false;

  // Parse brew install command
  const brewMatch = installCmd.match(/brew install\s+(--cask\s+)?(\S+)/);
  if (brewMatch) {
    isCask = !!brewMatch[1];
    pkgName = brewMatch[2];
  }

  if (pkgName) {
    // Get installed version
    const listCmd = isCask
      ? `brew list --cask --versions ${pkgName} 2>/dev/null | awk '{print $2}'`
      : `brew list --versions ${pkgName} 2>/dev/null | awk '{print $2}'`;
    const versionResult = await window.onboard.run(listCmd);
    if (versionResult.succeeded && versionResult.stdout) {
      version = versionResult.stdout.split('\n')[0].trim();
    }

    // Check for updates
    const outdatedCmd = isCask
      ? `brew outdated --cask --json 2>/dev/null`
      : `brew outdated --json 2>/dev/null`;
    const outdatedResult = await window.onboard.run(outdatedCmd);
    if (outdatedResult.succeeded && outdatedResult.stdout) {
      try {
        const outdated = JSON.parse(outdatedResult.stdout);
        const formulae = isCask ? (outdated.casks || []) : (outdated.formulae || []);
        const pkg = formulae.find(f => f.name === pkgName);
        if (pkg) {
          hasUpdate = true;
          latestVersion = pkg.current_version || pkg.installed_versions?.[0];
        }
      } catch (e) {
        // JSON parse failed, ignore
      }
    }
  } else {
    // For non-brew tools, try --version flag
    const versionResult = await window.onboard.run(`${tool.id} --version 2>/dev/null | head -1`);
    if (versionResult.succeeded && versionResult.stdout) {
      // Extract version number from output
      const match = versionResult.stdout.match(/(\d+\.\d+(?:\.\d+)?)/);
      if (match) {
        version = match[1];
      }
    }
  }

  return { version, latestVersion, hasUpdate };
}

// Fast check - just installed status
async function checkAppFast(app) {
  const result = await window.onboard.run(app.check);
  appStates[app.id] = {
    ...appStates[app.id],
    status: 'checked',
    installed: result.succeeded,
  };
  renderAppCards();
  return result.succeeded;
}

// Slow enrichment - version info (runs in background)
async function enrichAppVersion(app) {
  if (!appStates[app.id]?.installed) return;

  const version = await getAppVersion(app);
  appStates[app.id] = {
    ...appStates[app.id],
    version,
  };
  renderAppCards();
}

// Legacy function for re-checking after install/uninstall
async function checkApp(app) {
  appStates[app.id] = { status: 'checking', installed: false };
  renderAppCards();

  const installed = await checkAppFast(app);
  if (installed) {
    await enrichAppVersion(app);
  }
}

async function getAppVersion(app) {
  // Try to get version from the app bundle's Info.plist
  const checkCmd = app.check || '';
  const appPathMatch = checkCmd.match(/ls\s+(.+\.app)/);

  if (appPathMatch) {
    const paths = appPathMatch[1].split('||').map(p => p.trim().replace(/\\/g, ''));
    for (const appPath of paths) {
      const versionCmd = `defaults read "${appPath}/Contents/Info" CFBundleShortVersionString 2>/dev/null`;
      const result = await window.onboard.run(versionCmd);
      if (result.succeeded && result.stdout) {
        return result.stdout.trim();
      }
    }
  }

  // Fallback: try brew list --cask --versions
  const installCmd = app.install || '';
  const brewMatch = installCmd.match(/brew install\s+--cask\s+(\S+)/);
  if (brewMatch) {
    const pkgName = brewMatch[1];
    const result = await window.onboard.run(`brew list --cask --versions ${pkgName} 2>/dev/null | awk '{print $2}'`);
    if (result.succeeded && result.stdout) {
      return result.stdout.split('\n')[0].trim();
    }
  }

  return null;
}

async function checkAllTools() {
  const tools = currentConfig?.dependencies || [];
  const apps = currentConfig?.apps || [];

  // Set all to checking state
  tools.forEach(t => { toolStates[t.id] = { status: 'checking', installed: false }; });
  apps.forEach(a => { appStates[a.id] = { status: 'checking', installed: false }; });
  renderToolCards();
  renderAppCards();
  setStatus('Checking...');

  // Phase 1: Fast parallel check for installed status (all at once)
  const toolChecks = tools.map(tool => checkToolFast(tool));
  const appChecks = apps.map(app => checkAppFast(app));
  await Promise.all([...toolChecks, ...appChecks]);

  setStatus('Ready (drop .onboard file)');

  // Phase 2: Background enrichment for versions (fire and forget)
  tools.forEach(tool => enrichToolVersion(tool));
  apps.forEach(app => enrichAppVersion(app));
}

// ─── Installation ──────────────────────────────────────────────────

async function installTool(toolId) {
  const tool = (currentConfig?.dependencies || []).find(t => t.id === toolId);
  if (!tool) return;

  const terminalId = `tool-${toolId}`;

  // Clear previous output and set installing state
  clearTerminalOutput(terminalId);
  setTerminalActive(terminalId, true);
  toolStates[toolId] = { ...toolStates[toolId], installing: true };
  renderToolCards();
  setStatus(`Installing ${tool.name}...`);

  const result = await window.onboard.runStreamingWithId(tool.install, terminalId);

  // Clear installing state, deactivate terminal
  toolStates[toolId] = { ...toolStates[toolId], installing: false };
  setTerminalActive(terminalId, false);

  if (result.cancelled) {
    setStatus('Installation cancelled');
    renderToolCards();
    return;
  }

  if (result.succeeded) {
    // Re-check to confirm installation and get version
    await checkTool(tool);
    const version = toolStates[toolId]?.version;
    logActivity('installed', tool.name, version);
  } else {
    showError(`Failed to install ${tool.name}`, result.stderr);
    logActivity('failed', `install ${tool.name}`);
    renderToolCards();
  }
}

async function cancelToolInstall(toolId) {
  await window.onboard.cancelProcess(`tool-${toolId}`);
  toolStates[toolId] = { ...toolStates[toolId], installing: false };
  renderToolCards();
  setStatus('Installation cancelled');
}

function uninstallTool(toolId) {
  const tool = (currentConfig?.dependencies || []).find(t => t.id === toolId);
  if (!tool) return;

  const warning = `This will remove ${tool.name} from your system. Other tools or apps that depend on it may stop working.`;
  showUninstallModal('tool', toolId, tool.name, warning);
}

async function doUninstallTool(toolId) {
  const tool = (currentConfig?.dependencies || []).find(t => t.id === toolId);
  if (!tool) return;

  // Derive uninstall command from install command
  const installCmd = tool.install || '';
  let uninstallCmd = null;

  // Parse brew install command
  const brewMatch = installCmd.match(/brew install\s+(--cask\s+)?(\S+)/);
  if (brewMatch) {
    const caskFlag = brewMatch[1] || '';
    const pkgName = brewMatch[2];
    uninstallCmd = `brew uninstall ${caskFlag}${pkgName}`;
  }

  if (!uninstallCmd) {
    showError(`Cannot uninstall ${tool.name}: no uninstall command available`);
    return;
  }

  const terminalId = `tool-${toolId}`;

  // Clear previous output and set uninstalling state
  clearTerminalOutput(terminalId);
  setTerminalActive(terminalId, true);
  toolStates[toolId] = { ...toolStates[toolId], installing: true };
  renderToolCards();
  setStatus(`Uninstalling ${tool.name}...`);

  const result = await window.onboard.runStreamingWithId(uninstallCmd, terminalId);

  // Clear state, deactivate terminal
  toolStates[toolId] = { ...toolStates[toolId], installing: false };
  setTerminalActive(terminalId, false);

  if (result.succeeded) {
    // Re-check to confirm uninstallation
    await checkTool(tool);
    logActivity('uninstalled', tool.name);
  } else {
    showError(`Failed to uninstall ${tool.name}`, result.stderr);
    logActivity('failed', `uninstall ${tool.name}`);
    renderToolCards();
  }
}

async function upgradeTool(toolId) {
  const tool = (currentConfig?.dependencies || []).find(t => t.id === toolId);
  if (!tool) return;

  // Derive upgrade command from install command
  const installCmd = tool.install || '';
  let upgradeCmd = null;

  // Parse brew install command
  const brewMatch = installCmd.match(/brew install\s+(--cask\s+)?(\S+)/);
  if (brewMatch) {
    const caskFlag = brewMatch[1] || '';
    const pkgName = brewMatch[2];
    upgradeCmd = `brew upgrade ${caskFlag}${pkgName}`;
  }

  if (!upgradeCmd) {
    showError(`Cannot upgrade ${tool.name}: no upgrade command available`);
    return;
  }

  const terminalId = `tool-${toolId}`;
  const fromVersion = toolStates[toolId]?.version || 'current';
  const toVersion = toolStates[toolId]?.latestVersion || 'latest';

  // Clear previous output and set upgrading state
  clearTerminalOutput(terminalId);
  setTerminalActive(terminalId, true);
  toolStates[toolId] = { ...toolStates[toolId], installing: true };
  renderToolCards();
  setStatus(`Upgrading ${tool.name} from v${fromVersion} to v${toVersion}...`);

  const result = await window.onboard.runStreamingWithId(upgradeCmd, terminalId);

  // Clear state, deactivate terminal
  toolStates[toolId] = { ...toolStates[toolId], installing: false };
  setTerminalActive(terminalId, false);

  if (result.succeeded) {
    // Re-check to get new version
    await checkTool(tool);
    const newVersion = toolStates[toolId]?.version || toVersion;
    logActivity('upgraded', tool.name, newVersion);
  } else {
    showError(`Failed to upgrade ${tool.name}`, result.stderr);
    logActivity('failed', `upgrade ${tool.name}`);
    renderToolCards();
  }
}

async function installApp(appId) {
  const app = (currentConfig?.apps || []).find(a => a.id === appId);
  if (!app) return;

  // Clear previous output and set installing state
  clearTerminalOutput(appId);
  setTerminalActive(appId, true);
  appStates[appId] = { ...appStates[appId], installing: true };
  renderAppCards();
  setStatus(`Installing ${app.name}...`);

  const result = await window.onboard.runStreamingWithId(app.install, appId);

  // Clear installing state, deactivate terminal
  appStates[appId] = { ...appStates[appId], installing: false };
  setTerminalActive(appId, false);
  delete activeProcesses[appId];

  if (result.cancelled) {
    setStatus('Installation cancelled');
    renderAppCards();
    return;
  }

  if (result.succeeded) {
    // Re-check to confirm installation
    await checkApp(app);
    const version = appStates[appId]?.version;
    logActivity('installed', app.name, version);
  } else {
    showError(`Failed to install ${app.name}`, result.stderr);
    logActivity('failed', `install ${app.name}`);
  }
}

async function cancelInstall(appId) {
  const app = (currentConfig?.apps || []).find(a => a.id === appId);
  if (!app) return;

  await window.onboard.cancelProcess(appId);
  appStates[appId] = { ...appStates[appId], installing: false };
  renderAppCards();
  setStatus('Installation cancelled');
}

async function resolveAppPath(app) {
  // Try to find the app path from the check command
  // Most apps have check: "ls /Applications/AppName.app"
  const checkCmd = app.check || '';
  const appPathMatch = checkCmd.match(/ls\s+(.+\.app)/);

  if (appPathMatch) {
    // Extract first valid path (handle || for multiple checks)
    const paths = appPathMatch[1].split('||').map(p => p.trim().replace(/\\/g, ''));
    for (const appPath of paths) {
      const exists = await window.onboard.run(`ls "${appPath}"`);
      if (exists.succeeded) return appPath;
    }
  }

  // Fallback: standard Applications path
  return `/Applications/${app.name}.app`;
}

async function openApp(appId) {
  const app = (currentConfig?.apps || []).find(a => a.id === appId);
  if (!app) return;
  await window.onboard.openPath(await resolveAppPath(app));
}

async function revealAppInFinder(appId) {
  const app = (currentConfig?.apps || []).find(a => a.id === appId);
  if (!app) return;
  await window.onboard.showInFolder(await resolveAppPath(app));
}

function uninstallApp(appId) {
  const app = (currentConfig?.apps || []).find(a => a.id === appId);
  if (!app) return;

  const warning = `This will remove ${app.name} from your Applications folder.`;
  showUninstallModal('app', appId, app.name, warning);
}

async function doUninstallApp(appId) {
  const app = (currentConfig?.apps || []).find(a => a.id === appId);
  if (!app) return;

  // Derive uninstall command from install command
  const installCmd = app.install || '';
  let uninstallCmd = null;

  // Parse brew install --cask command
  const brewMatch = installCmd.match(/brew install\s+(--cask\s+)?(\S+)/);
  if (brewMatch) {
    const caskFlag = brewMatch[1] || '';
    const pkgName = brewMatch[2];
    uninstallCmd = `brew uninstall ${caskFlag}${pkgName}`;
  }

  if (!uninstallCmd) {
    showError(`Cannot uninstall ${app.name}: no uninstall command available`);
    return;
  }

  // Clear previous output and set uninstalling state
  clearTerminalOutput(appId);
  setTerminalActive(appId, true);
  appStates[appId] = { ...appStates[appId], installing: true };
  renderAppCards();
  setStatus(`Uninstalling ${app.name}...`);

  const result = await window.onboard.runStreamingWithId(uninstallCmd, appId);

  // Clear state, deactivate terminal
  appStates[appId] = { ...appStates[appId], installing: false };
  setTerminalActive(appId, false);

  if (result.succeeded) {
    // Re-check to confirm uninstallation
    await checkApp(app);
    logActivity('uninstalled', app.name);
  } else {
    showError(`Failed to uninstall ${app.name}`, result.stderr);
    logActivity('failed', `uninstall ${app.name}`);
    renderAppCards();
  }
}

async function installAllDeps() {
  const tools = currentConfig?.dependencies || [];

  // Install in order — dependencies first
  for (const tool of tools) {
    if (toolStates[tool.id]?.installed) continue; // Already installed

    // Check dependency is installed (may have been installed earlier in this loop)
    if (tool.depends_on && !toolStates[tool.depends_on]?.installed) {
      continue; // Skip if dependency not met
    }

    await installTool(tool.id);
  }
}

async function installAllApps() {
  const apps = currentConfig?.apps || [];

  // Install in order
  for (const app of apps) {
    if (appStates[app.id]?.installed) continue; // Already installed

    // Check dependency (could be a tool or another app)
    if (app.depends_on) {
      const depInstalled = toolStates[app.depends_on]?.installed || appStates[app.depends_on]?.installed;
      if (!depInstalled) continue; // Skip if dependency not met
    }

    await installApp(app.id);
  }
}

// ─── Theme ─────────────────────────────────────────────────────────

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);

  // Update theme icon visibility
  const sunIcon = document.getElementById('theme-icon-sun');
  const moonIcon = document.getElementById('theme-icon-moon');
  if (sunIcon && moonIcon) {
    // Show sun in dark mode (click to go light), moon in light mode (click to go dark)
    sunIcon.style.display = theme === 'dark' ? 'block' : 'none';
    moonIcon.style.display = theme === 'light' ? 'block' : 'none';
  }
}

function toggleTheme() {
  const current = localStorage.getItem('theme') || 'dark';
  setTheme(current === 'dark' ? 'light' : 'dark');
}

function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  setTheme(saved);
}

// ─── File Picker ───────────────────────────────────────────────────

async function openFilePicker() {
  const filePath = await window.onboard.openFileDialog();
  if (filePath) {
    await loadConfig(filePath);
  }
}

// ─── Terminal Output ───────────────────────────────────────────────

function initTerminalOutput(id) {
  if (!terminalOutputs[id]) {
    terminalOutputs[id] = { lines: [], poppedOut: false, active: false, expanded: false };
  }
}

function setTerminalActive(id, active) {
  initTerminalOutput(id);
  terminalOutputs[id].active = active;
}

function appendTerminalOutput(id, data, stream = 'stdout') {
  initTerminalOutput(id);
  const lines = data.split('\n').filter(l => l.length > 0);
  lines.forEach(line => {
    terminalOutputs[id].lines.push({ text: line, stream });
    // Trim to max lines
    if (terminalOutputs[id].lines.length > MAX_TERMINAL_LINES) {
      terminalOutputs[id].lines.shift();
    }
  });
  updateTerminalDisplay(id);

  // Also send to pop-out window if open
  if (terminalOutputs[id].poppedOut) {
    window.onboard.sendToTerminalWindow(id, data, stream);
  }
}

function updateTerminalDisplay(id) {
  const el = document.getElementById(`terminal-${id}`);
  const historyBtn = document.getElementById(`terminal-history-${id}`);

  const output = terminalOutputs[id];
  const hasOutput = output && output.lines.length > 0;
  const isActive = output?.active;
  const isPoppedOut = output?.poppedOut;

  // Hide history button — terminal inline is now always visible when there's output
  if (historyBtn) {
    historyBtn.style.display = 'none';
  }

  if (!el) return;

  // Show inline if there's output and not popped out
  if (!hasOutput || isPoppedOut) {
    el.style.display = 'none';
    return;
  }

  // Keep terminal visible (single line when not active, can expand when clicked)
  el.style.display = 'block';

  // Preserve expanded state across re-renders
  if (output?.expanded) {
    el.classList.add('expanded');
  } else {
    el.classList.remove('expanded');
  }

  // Show last line for compact view
  const lastLine = output.lines[output.lines.length - 1];
  const lastLineEl = el.querySelector('.terminal-last-line');
  if (lastLineEl) {
    lastLineEl.textContent = lastLine.text;
    lastLineEl.className = `terminal-last-line ${lastLine.stream}`;
  }

  // Update full output view
  const fullEl = el.querySelector('.terminal-full');
  if (fullEl) {
    fullEl.innerHTML = output.lines.map(l =>
      `<span class="${l.stream}">${escapeHtml(l.text)}</span>`
    ).join('\n');
    fullEl.scrollTop = fullEl.scrollHeight;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function clearTerminalOutput(id) {
  if (terminalOutputs[id]) {
    terminalOutputs[id].lines = [];
  }
  updateTerminalDisplay(id);
}

function toggleTerminalExpand(id) {
  initTerminalOutput(id);
  const el = document.getElementById(`terminal-${id}`);
  if (!el) return;
  terminalOutputs[id].expanded = !terminalOutputs[id].expanded;
  el.classList.toggle('expanded');
  updateTerminalDisplay(id);
}

function showTerminalHistory(id) {
  const el = document.getElementById(`terminal-${id}`);
  if (!el) return;

  const output = terminalOutputs[id];
  if (!output || output.lines.length === 0) return;

  // Show the terminal inline and expand it
  el.style.display = 'block';
  el.classList.add('expanded');

  // Hide the history button since terminal is now visible
  const historyBtn = document.getElementById(`terminal-history-${id}`);
  if (historyBtn) {
    historyBtn.style.display = 'none';
  }

  // Manually populate the terminal content (don't call updateTerminalDisplay which removes expanded)
  const lastLine = output.lines[output.lines.length - 1];
  const lastLineEl = el.querySelector('.terminal-last-line');
  if (lastLineEl) {
    lastLineEl.textContent = lastLine.text;
    lastLineEl.className = `terminal-last-line ${lastLine.stream}`;
  }

  const fullEl = el.querySelector('.terminal-full');
  if (fullEl) {
    fullEl.innerHTML = output.lines.map(l =>
      `<span class="${l.stream}">${escapeHtml(l.text)}</span>`
    ).join('\n');
    fullEl.scrollTop = fullEl.scrollHeight;
  }
}

async function popOutTerminal(id) {
  initTerminalOutput(id);
  terminalOutputs[id].poppedOut = true;
  updateTerminalDisplay(id);

  // Get the item name for the window title
  const tool = (currentConfig?.dependencies || []).find(t => t.id === id || `tool-${t.id}` === id);
  const app = (currentConfig?.apps || []).find(a => a.id === id);
  const name = tool?.name || app?.name || id;

  // Send existing output to pop-out window
  const existingOutput = terminalOutputs[id].lines.map(l => l.text).join('\n');

  await window.onboard.openTerminalWindow(id, name, existingOutput);
}

// Called when pop-out window is closed
function onTerminalWindowClosed(id) {
  if (terminalOutputs[id]) {
    terminalOutputs[id].poppedOut = false;
  }
  updateTerminalDisplay(id);
}

// ─── Activity Log ──────────────────────────────────────────────────

let activityLog = [];  // Array of { action, name, version, timestamp }
let statusQueue = [];  // Queue of status messages to show
let statusTimeout = null;

function logActivity(action, name, version = null) {
  const entry = {
    action,  // 'installed', 'uninstalled', 'upgraded', 'failed'
    name,
    version,
    timestamp: new Date(),
  };
  activityLog.unshift(entry);  // Most recent first

  // Keep only last 50 entries
  if (activityLog.length > 50) {
    activityLog.pop();
  }

  // Queue the status message
  let message = '';
  switch (action) {
    case 'installed':
      message = `Installed ${name}${version ? ' v' + version : ''}`;
      break;
    case 'uninstalled':
      message = `Uninstalled ${name}`;
      break;
    case 'upgraded':
      message = `Upgraded ${name}${version ? ' to v' + version : ''}`;
      break;
    case 'failed':
      message = `Failed to ${name}`;
      break;
  }

  queueStatus(message);
}

function queueStatus(message) {
  statusQueue.push(message);
  processStatusQueue();
}

function processStatusQueue() {
  if (statusTimeout) return;  // Already processing

  if (statusQueue.length === 0) {
    // Fade back to Ready after a delay
    statusTimeout = setTimeout(() => {
      setStatusDirect('Ready (drop .onboard file)');
      statusTimeout = null;
    }, 2000);
    return;
  }

  const message = statusQueue.shift();
  setStatusDirect(message);

  statusTimeout = setTimeout(() => {
    statusTimeout = null;
    processStatusQueue();
  }, 2500);  // Show each message for 2.5 seconds
}

function setStatusDirect(text) {
  const el = document.getElementById('status-text');
  if (el) el.textContent = text;
}

// ─── UI Helpers ────────────────────────────────────────────────────

function setStatus(text) {
  // Clear any pending status queue processing
  if (statusTimeout) {
    clearTimeout(statusTimeout);
    statusTimeout = null;
  }
  statusQueue = [];  // Clear queue when setting status directly

  const el = document.getElementById('status-text');
  if (el) el.textContent = text;
}

function setStatusLoading(loading) {
  const el = document.getElementById('status-text');
  if (el) {
    if (loading) {
      el.classList.add('loading');
    } else {
      el.classList.remove('loading');
    }
  }
}

let errorDetailsVisible = false;

function showError(message, details = null) {
  const toast = document.getElementById('error-toast');
  const msgEl = document.getElementById('error-message');
  const detailsEl = document.getElementById('error-details');
  const detailsTextEl = document.getElementById('error-details-text');
  const detailsBtn = document.getElementById('error-details-btn');

  if (toast && msgEl) {
    msgEl.textContent = message;
    toast.style.display = 'flex';
    errorDetailsVisible = false;

    // Show details button if we have details
    if (details && details.trim()) {
      detailsBtn.style.display = 'block';
      detailsTextEl.textContent = details.trim();
      detailsEl.style.display = 'none';
    } else {
      detailsBtn.style.display = 'none';
      detailsEl.style.display = 'none';
    }

    // Auto-hide after 8 seconds (longer for errors)
    setTimeout(() => hideError(), 8000);
  }
}

function toggleErrorDetails() {
  const detailsEl = document.getElementById('error-details');
  const detailsBtn = document.getElementById('error-details-btn');

  errorDetailsVisible = !errorDetailsVisible;
  detailsEl.style.display = errorDetailsVisible ? 'block' : 'none';
  detailsBtn.textContent = errorDetailsVisible ? 'Hide' : 'Details';
}

function hideError() {
  const toast = document.getElementById('error-toast');
  if (toast) toast.style.display = 'none';
}

// ─── Uninstall Confirmation Modal ──────────────────────────────────

let pendingUninstall = null;  // { type: 'tool' | 'app', id: string }

function showUninstallModal(type, id, name, warning) {
  pendingUninstall = { type, id };

  document.getElementById('uninstall-name').textContent = name;
  document.getElementById('uninstall-warning').textContent = warning;
  document.getElementById('uninstall-confirm-input').value = '';
  document.getElementById('uninstall-confirm-btn').disabled = true;
  document.getElementById('uninstall-modal').style.display = 'flex';

  // Focus the input
  setTimeout(() => {
    document.getElementById('uninstall-confirm-input').focus();
  }, 100);
}

function hideUninstallModal() {
  document.getElementById('uninstall-modal').style.display = 'none';
  pendingUninstall = null;
}

function onUninstallInputChange() {
  const input = document.getElementById('uninstall-confirm-input');
  const btn = document.getElementById('uninstall-confirm-btn');
  btn.disabled = input.value.toLowerCase() !== 'delete';
}

async function confirmUninstall() {
  if (!pendingUninstall) return;

  hideUninstallModal();

  if (pendingUninstall.type === 'tool') {
    await doUninstallTool(pendingUninstall.id);
  } else {
    await doUninstallApp(pendingUninstall.id);
  }
}

// ─── Activity Log Popup ────────────────────────────────────────────

function toggleActivityLog() {
  const popup = document.getElementById('activity-log-popup');
  if (!popup) return;

  if (popup.style.display === 'block') {
    popup.style.display = 'none';
  } else {
    renderActivityLog();
    popup.style.display = 'block';
  }
}

function renderActivityLog() {
  const list = document.getElementById('activity-log-list');
  if (!list) return;

  if (activityLog.length === 0) {
    list.innerHTML = '<li class="activity-empty">No activity yet</li>';
    return;
  }

  list.innerHTML = activityLog.map(entry => {
    const timeAgo = getTimeAgo(entry.timestamp);
    const icon = entry.action === 'installed' ? '↓' :
                 entry.action === 'uninstalled' ? '✕' :
                 entry.action === 'upgraded' ? '↑' : '!';
    const className = entry.action === 'failed' ? 'failed' : '';

    return `<li class="${className}">
      <span class="activity-icon">${icon}</span>
      <span class="activity-text">${entry.action} ${entry.name}${entry.version ? ' v' + entry.version : ''}</span>
      <span class="activity-time">${timeAgo}</span>
    </li>`;
  }).join('');
}

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ─── Config History ────────────────────────────────────────────────

function getConfigHistory() {
  try {
    return JSON.parse(localStorage.getItem('configHistory') || '[]');
  } catch {
    return [];
  }
}

function saveToConfigHistory(source, name) {
  if (!source || source === 'bundled') return;

  const history = getConfigHistory();

  // Remove existing entry with same path (to move it to top)
  const filtered = history.filter(h => h.path !== source);

  // Add new entry at the beginning
  filtered.unshift({
    path: source,
    name: name || source.split('/').pop(),
    timestamp: Date.now(),
  });

  // Keep only last 10 unique entries
  const trimmed = filtered.slice(0, 10);

  localStorage.setItem('configHistory', JSON.stringify(trimmed));
}

function toggleConfigHistory() {
  const popup = document.getElementById('config-history-popup');
  if (!popup) return;

  if (popup.style.display === 'block') {
    popup.style.display = 'none';
  } else {
    renderConfigHistory();
    popup.style.display = 'block';
  }
}

function renderConfigHistory() {
  const list = document.getElementById('config-history-list');
  if (!list) return;

  const history = getConfigHistory();

  if (history.length === 0) {
    list.innerHTML = '<li class="config-history-empty">No recent configs</li>';
    return;
  }

  list.innerHTML = history.map(entry => {
    const displayPath = formatPath(entry.path);
    return `<li onclick="loadConfigFromHistory('${entry.path.replace(/'/g, "\\'")}')">
      <span class="config-history-name">${entry.name}</span>
      <span class="config-history-path">${displayPath}</span>
    </li>`;
  }).join('');
}

async function loadConfigFromHistory(path) {
  toggleConfigHistory();
  await loadConfig(path);
}

// ─── Drag and Drop ─────────────────────────────────────────────────

function initDragDrop() {
  const emptyState = document.getElementById('empty-state');

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    emptyState.classList.add('drag-over');
  });

  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget || !document.body.contains(e.relatedTarget)) {
      emptyState.classList.remove('drag-over');
    }
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    emptyState.classList.remove('drag-over');

    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.onboard')) {
      const filePath = window.onboard.getFilePath(file);
      await loadConfig(filePath);
    } else if (file) {
      showError('Please drop a .onboard file');
    }
  });

  // Handle file opened via double-click (macOS file association)
  window.onboard.onFileOpened(async (filePath) => {
    await loadConfig(filePath);
  });
}

// ─── Initialization ────────────────────────────────────────────────

function initStreamCallback() {
  // Set up stream callback to route output to terminals
  window.onboard.setStreamCallback((data) => {
    if (data.id) {
      appendTerminalOutput(data.id, data.data, data.stream);
    }
  });

  // Listen for terminal window close events
  window.onboard.onTerminalWindowClosed((id) => {
    onTerminalWindowClosed(id);
  });
}

async function init() {
  initTheme();
  initDragDrop();
  initUpdater();
  initStreamCallback();

  homeDir = await window.onboard.homedir();

  // Check if we have a saved config path
  const lastConfig = localStorage.getItem('lastConfigPath');
  if (lastConfig && lastConfig !== 'bundled' && lastConfig.length > 0) {
    const success = await loadConfig(lastConfig);
    if (!success) {
      showEmptyState();
    }
  } else {
    showEmptyState();
  }
}

// ─── Update UI ──────────────────────────────────────────────────────

function renderUpdateUI() {
  const container = document.getElementById('update-section');
  if (!container) return;

  const giftIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/>
    <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
  </svg>`;

  const docIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
  </svg>`;

  let html = '';

  if (updateStatus !== 'idle' && updateStatus !== 'uptodate') {
    html = `<div class="update-indicator">${giftIcon}
      <span class="update-text ${updateStatus === 'error' ? 'error' : ''}">
        ${updateStatus === 'checking' ? 'Checking...' : updateStatus === 'downloading' ? 'Downloading...' :
          updateStatus === 'ready' ? 'Update ready' : updateStatus === 'error' ? 'Update failed' : 'Update available'}
      </span><div class="shimmer-overlay"></div></div>`;

    if (updateStatus !== 'checking' && updateStatus !== 'downloading' && updateStatus !== 'error') {
      html += `<button class="update-btn update-btn-secondary" onclick="dismissUpdate()">Later</button>
        <button class="update-btn update-btn-primary" onclick="${updateStatus === 'ready' ? 'installUpdate()' : 'downloadUpdate()'}">
          ${updateStatus === 'ready' ? 'Install' : 'Update'}</button>`;
    }
    if (updateStatus === 'error') {
      html += `<button class="update-btn update-btn-secondary" onclick="dismissUpdate()">Dismiss</button>`;
    }
  } else {
    if (versionHovered) {
      html = updateStatus === 'uptodate'
        ? `<span class="version-text uptodate">Up to date ✓</span>`
        : `<button class="version-hover" onclick="checkForUpdates()">Check for updates</button>`;
    } else {
      html = `<span class="version-text ${updateStatus === 'uptodate' ? 'uptodate' : ''}"
        onmouseenter="setVersionHovered(true)" onmouseleave="setVersionHovered(false)">
        ${updateStatus === 'uptodate' ? 'Up to date ✓' : 'v' + appVersion}</span>`;
    }
    if (hasReleaseNotes(appVersion)) {
      html += `<button class="release-notes-btn ${showReleaseNotes ? 'active' : ''}" onclick="toggleReleaseNotes()" title="Release notes">${docIcon}</button>`;
    }
  }
  container.innerHTML = html;
}

function setVersionHovered(hovered) { versionHovered = hovered; renderUpdateUI(); }
function checkForUpdates() { if (window.updaterAPI) window.updaterAPI.checkForUpdates(); }
function downloadUpdate() { if (window.updaterAPI) window.updaterAPI.downloadUpdate(); }
function installUpdate() { if (window.updaterAPI) window.updaterAPI.installUpdate(); }
function dismissUpdate() {
  if (window.updaterAPI) window.updaterAPI.dismissUpdate();
  updateStatus = 'idle'; updateError = null; renderUpdateUI();
}

function toggleReleaseNotes() {
  if (showReleaseNotes) hideReleaseNotes();
  else showReleaseNotesPopup(true);
}

function showReleaseNotesPopup(isLatestMode = false) {
  const popup = document.getElementById('release-notes-popup');
  if (!popup || !hasReleaseNotes(appVersion)) return;

  document.getElementById('release-notes-version').textContent = 'v' + appVersion;
  const labelEl = document.getElementById('release-notes-label');
  labelEl.textContent = isLatestMode ? 'Latest' : "What's new";
  labelEl.className = 'label' + (isLatestMode ? ' latest' : '');
  document.getElementById('release-notes-date').textContent = RELEASE_DATES[appVersion] ? 'Released ' + RELEASE_DATES[appVersion] : '';

  const notes = RELEASE_NOTES[appVersion] || [];
  document.getElementById('release-notes-list').innerHTML = notes.map(n => `<li><span class="bullet">•</span><span>${n}</span></li>`).join('');

  popup.style.display = 'block';
  popup.classList.remove('closing');
  showReleaseNotes = true;
  renderUpdateUI();
}

function hideReleaseNotes() {
  const popup = document.getElementById('release-notes-popup');
  if (!popup) return;
  popup.classList.add('closing');
  setTimeout(() => { popup.style.display = 'none'; popup.classList.remove('closing'); }, 300);
  showReleaseNotes = false;
  renderUpdateUI();
}

function initUpdater() {
  if (!window.updaterAPI) return;

  window.updaterAPI.getVersion().then(v => { appVersion = v || '0.0.0'; renderUpdateUI(); checkForNewVersionNotes(); });
  window.updaterAPI.getStatus().then(s => { if (s) { updateStatus = s.status; renderUpdateUI(); } });

  window.updaterAPI.onCheckingForUpdate(() => { updateStatus = 'checking'; renderUpdateUI(); });
  window.updaterAPI.onUpdateAvailable(() => { updateStatus = 'available'; renderUpdateUI(); });
  window.updaterAPI.onUpdateNotAvailable(() => {
    updateStatus = 'uptodate'; renderUpdateUI();
    setTimeout(() => { if (updateStatus === 'uptodate') { updateStatus = 'idle'; renderUpdateUI(); } }, 3000);
  });
  window.updaterAPI.onDownloadProgress(() => { updateStatus = 'downloading'; renderUpdateUI(); });
  window.updaterAPI.onUpdateDownloaded(() => { updateStatus = 'ready'; renderUpdateUI(); });
  window.updaterAPI.onError((err) => { updateStatus = 'error'; updateError = err; renderUpdateUI(); });
}

function checkForNewVersionNotes() {
  const lastSeen = localStorage.getItem('lastSeenReleaseNotesVersion');
  if (lastSeen && lastSeen !== appVersion && hasReleaseNotes(appVersion)) {
    showReleaseNotesPopup(false);
  }
  localStorage.setItem('lastSeenReleaseNotesVersion', appVersion);
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
