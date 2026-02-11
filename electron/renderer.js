// renderer.js — All the onboarding logic that runs in the browser window.
// Talks to the main process exclusively through window.onboard (the preload bridge).
// No Node.js access here — just DOM manipulation and IPC calls.

// ─── Tool Definitions ──────────────────────────────────────────────
// Each tool has an id, display name, description, why it matters,
// the check id (for the IPC handler), and install instructions.
// ORDER MATTERS — Homebrew first because everything else depends on it.

const TOOLS = [
  {
    id: 'homebrew',
    name: 'Homebrew',
    icon: '🍺',
    iconBg: 'var(--yellow-dim)',
    iconColor: 'var(--yellow)',
    desc: 'The package manager for macOS. Installs everything else.',
    explain: '<strong>Why:</strong> Homebrew is the standard way to install developer tools on macOS. Almost every other tool on this list can be installed through it. Think of it as the App Store for command-line tools.',
    installCmd: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    installNote: 'This may take a few minutes and will ask for your password.',
  },
  {
    id: 'git',
    name: 'Git',
    icon: '🔀',
    iconBg: 'var(--red-dim)',
    iconColor: 'var(--red)',
    desc: 'Version control. Track changes, collaborate, push to GitHub.',
    explain: '<strong>Why:</strong> Git is how every developer tracks code changes and collaborates. When you "push" code to GitHub or "pull" someone else\'s project, you\'re using Git. It\'s non-negotiable — every team, every project, everywhere.',
    installCmd: 'brew install git',
    dependsOn: 'homebrew',
  },
  {
    id: 'node',
    name: 'Node.js',
    icon: '🟢',
    iconBg: 'var(--green-dim)',
    iconColor: 'var(--green)',
    desc: 'JavaScript runtime. Runs JS outside the browser, powers npm.',
    explain: '<strong>Why:</strong> Node.js lets you run JavaScript on your machine (not just in a browser). It comes with <strong>npm</strong>, the package manager that installs libraries for web projects. Most modern web development depends on Node.',
    installCmd: 'brew install node',
    dependsOn: 'homebrew',
  },
  {
    id: 'python',
    name: 'Python 3',
    icon: '🐍',
    iconBg: 'var(--blue-dim)',
    iconColor: 'var(--blue)',
    desc: 'General-purpose language. Used for scripting, AI/ML, and tooling.',
    explain: '<strong>Why:</strong> Python is everywhere — data science, automation, backend APIs, AI tools. Even if you\'re mainly doing web dev, you\'ll encounter Python scripts regularly. macOS ships with an old version; we need Python 3.',
    installCmd: 'brew install python@3',
    dependsOn: 'homebrew',
  },
  {
    id: 'bun',
    name: 'Bun',
    icon: '🥟',
    iconBg: 'rgba(188, 140, 255, 0.15)',
    iconColor: 'var(--purple)',
    desc: 'Fast JavaScript runtime and package manager. Drop-in npm replacement.',
    explain: '<strong>Why:</strong> Bun is a blazing-fast alternative to Node.js for running JavaScript and installing packages. Many newer projects use it for speed. It\'s optional but increasingly popular in the ecosystem.',
    installCmd: 'brew install oven-sh/bun/bun',
    dependsOn: 'homebrew',
  },
  {
    id: 'claude',
    name: 'Claude CLI',
    icon: '🤖',
    iconBg: 'var(--blue-dim)',
    iconColor: 'var(--blue)',
    desc: 'AI coding assistant from Anthropic. Powers your pair programming.',
    explain: '<strong>Why:</strong> The Claude CLI gives you an AI coding partner right in your terminal. It can write code, explain errors, refactor, and debug alongside you. This is the engine behind the AI-assisted development workflow and the <code>field-theory</code> toolchain.',
    installCmd: 'npm install -g @anthropic-ai/claude-code',
    dependsOn: 'node',
  },
];

// ─── State ─────────────────────────────────────────────────────────
// Simple state object tracking each tool's check result.

const toolStates = {};
TOOLS.forEach(t => {
  toolStates[t.id] = { status: 'unchecked', installed: false, version: null };
});

let homeDir = '';
let devFolderPath = '';
let clonedProjectPath = '';

// ─── Tab Switching ─────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

    btn.classList.add('active');
    const panelId = 'panel-' + btn.dataset.tab;
    document.getElementById(panelId).classList.add('active');
  });
});

// ─── Render Tool Cards ─────────────────────────────────────────────
// Builds the DOM for each tool card on the Dependencies tab.
// We preserve the open/closed state of detail panels across re-renders.

const expandedPanels = new Set();

function renderToolCards() {
  const container = document.getElementById('tools-container');
  container.innerHTML = '';

  TOOLS.forEach(tool => {
    const state = toolStates[tool.id];
    const isExpanded = expandedPanels.has(tool.id);
    const card = document.createElement('div');
    card.className = 'tool-card fade-in';
    card.id = `tool-${tool.id}`;

    card.innerHTML = `
      <div class="tool-card-header">
        <div class="tool-icon" style="background: ${tool.iconBg}; color: ${tool.iconColor};">${tool.icon}</div>
        <div class="tool-info">
          <div class="tool-name">
            ${tool.name}
            ${renderStatusBadge(state)}
          </div>
          <div class="tool-desc">${tool.desc}</div>
          ${state.version ? `<div class="version-text">${escapeHtml(state.version)}</div>` : ''}
        </div>
        <div class="tool-action">
          ${renderToolAction(tool, state)}
        </div>
      </div>
      <div class="tool-details" id="details-${tool.id}" style="display: ${isExpanded ? 'block' : 'none'};">
        <div class="tool-explain">${tool.explain}</div>
        ${tool.installCmd ? `
          <div class="install-command">
            <code>${escapeHtml(tool.installCmd)}</code>
            <button class="copy-btn" onclick="copyToClipboard(\`${tool.installCmd.replace(/`/g, '\\`')}\`, this)" title="Copy command">📋</button>
          </div>
        ` : ''}
        ${tool.installNote ? `<div class="tool-explain" style="margin-top: 8px; font-style: italic;">${tool.installNote}</div>` : ''}
        <div class="terminal-output" id="output-${tool.id}" style="display: none;"></div>
      </div>
    `;

    // Toggle detail expansion on header click.
    card.querySelector('.tool-card-header').addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      if (expandedPanels.has(tool.id)) {
        expandedPanels.delete(tool.id);
      } else {
        expandedPanels.add(tool.id);
      }
      const details = card.querySelector('.tool-details');
      details.style.display = expandedPanels.has(tool.id) ? 'block' : 'none';
    });

    container.appendChild(card);
  });
}

function renderStatusBadge(state) {
  if (state.status === 'checking') {
    return '<span class="status-badge checking"><span class="spinner"></span> Checking</span>';
  }
  if (state.status === 'installing') {
    return '<span class="status-badge checking"><span class="spinner"></span> Installing</span>';
  }
  if (state.installed) {
    return '<span class="status-badge installed">✓ Installed</span>';
  }
  if (state.status === 'checked') {
    return '<span class="status-badge missing">✗ Missing</span>';
  }
  return '';
}

function renderToolAction(tool, state) {
  if (state.status === 'checking' || state.status === 'installing') {
    return '<span class="spinner"></span>';
  }
  if (state.installed) {
    return '<span style="color: var(--green); font-size: 18px;">✓</span>';
  }
  if (state.status === 'checked' && !state.installed) {
    // Show dependency hint if the parent tool isn't installed yet.
    if (tool.dependsOn && !toolStates[tool.dependsOn].installed) {
      return `<button class="btn btn-sm" disabled title="Install ${TOOLS.find(t => t.id === tool.dependsOn).name} first">Needs ${TOOLS.find(t => t.id === tool.dependsOn).name}</button>`;
    }
    return `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); installTool('${tool.id}')">Install</button>`;
  }
  return '';
}

// ─── Check Dependencies ────────────────────────────────────────────

async function checkAllDependencies() {
  const btn = document.getElementById('check-all-btn');
  btn.disabled = true;
  btn.textContent = 'Checking...';
  setStatus('Scanning your machine for installed tools...');

  for (const tool of TOOLS) {
    toolStates[tool.id].status = 'checking';
    renderToolCards();
    updateProgress();

    try {
      const result = await window.onboard.checkTool(tool.id);
      toolStates[tool.id] = {
        status: 'checked',
        installed: result.installed,
        version: result.version,
        path: result.path,
      };
    } catch (err) {
      toolStates[tool.id] = { status: 'checked', installed: false, version: null };
    }

    renderToolCards();
    updateProgress();
  }

  btn.disabled = false;
  btn.textContent = 'Re-check All';
  updateOverallStatus();
}

// ─── Install a Tool ────────────────────────────────────────────────
// Runs the install command for a given tool and shows streaming output.

async function installTool(toolId) {
  const tool = TOOLS.find(t => t.id === toolId);
  if (!tool) return;

  // Enforce dependency ordering.
  if (tool.dependsOn && !toolStates[tool.dependsOn].installed) {
    const dep = TOOLS.find(t => t.id === tool.dependsOn);
    alert(`You need to install ${dep.name} first.`);
    return;
  }

  toolStates[toolId].status = 'installing';
  expandedPanels.add(toolId);
  renderToolCards();

  // Show the output panel inside the card.
  const output = document.getElementById(`output-${toolId}`);
  if (output) {
    output.style.display = 'block';
    output.innerHTML = `<span class="cmd">$ ${escapeHtml(tool.installCmd)}</span>\n`;
  }

  setStatus(`Installing ${tool.name}...`);

  try {
    // Route streaming output into this tool's terminal panel.
    window.onboard.setStreamCallback((data) => {
      if (output) {
        const cls = data.stream === 'stderr' ? 'err' : '';
        output.innerHTML += `<span class="${cls}">${escapeHtml(data.data)}</span>`;
        output.scrollTop = output.scrollHeight;
      }
    });

    const result = await window.onboard.runStreaming(tool.installCmd);

    // Done streaming — clear the callback.
    window.onboard.clearStreamCallback();

    if (result.succeeded) {
      // Re-check to confirm installation and get version info.
      const check = await window.onboard.checkTool(toolId);
      toolStates[toolId] = {
        status: 'checked',
        installed: check.installed,
        version: check.version,
      };
      if (output) {
        output.innerHTML += `\n<span class="info">✓ ${tool.name} installed successfully.</span>`;
      }
    } else {
      toolStates[toolId].status = 'checked';
      if (output) {
        output.innerHTML += `\n<span class="err">✗ Installation failed (exit code ${result.exitCode}).</span>`;
      }
    }
  } catch (err) {
    window.onboard.clearStreamCallback();
    toolStates[toolId].status = 'checked';
    if (output) {
      output.innerHTML += `\n<span class="err">Error: ${escapeHtml(err.message)}</span>`;
    }
  }

  renderToolCards();
  updateProgress();
  updateOverallStatus();
}

// ─── Progress Tracking ─────────────────────────────────────────────

function updateProgress() {
  const total = TOOLS.length;
  const installed = TOOLS.filter(t => toolStates[t.id].installed).length;
  const pct = Math.round((installed / total) * 100);

  document.getElementById('deps-progress').style.width = pct + '%';
  document.getElementById('deps-progress-label').textContent = `${installed}/${total} installed`;

  // Update the badge on the Dependencies tab.
  const badge = document.getElementById('deps-badge');
  if (installed === total) {
    badge.className = 'tab-badge complete';
    badge.textContent = '✓';
  } else {
    badge.className = 'tab-badge pending';
    badge.textContent = `${installed}/${total}`;
  }
}

function updateOverallStatus() {
  const total = TOOLS.length;
  const installed = TOOLS.filter(t => toolStates[t.id].installed).length;
  const missing = total - installed;

  if (missing === 0) {
    setStatus('All dependencies installed. You\'re ready to build.');
  } else {
    setStatus(`${missing} tool${missing > 1 ? 's' : ''} still needed. Install them in order, top to bottom.`);
  }
}

function setStatus(text) {
  document.getElementById('status-text').textContent = text;
}

// ─── Accounts Tab Logic ────────────────────────────────────────────

async function installGhCli() {
  const output = document.getElementById('gh-output');
  output.style.display = 'block';
  output.innerHTML = '<span class="cmd">$ brew install gh</span>\n';

  window.onboard.setStreamCallback((data) => {
    output.innerHTML += escapeHtml(data.data);
    output.scrollTop = output.scrollHeight;
  });

  const result = await window.onboard.runStreaming('brew install gh');
  window.onboard.clearStreamCallback();

  if (result.succeeded) {
    output.innerHTML += '\n<span class="info">✓ GitHub CLI installed.</span>';
    markStep('gh-step-cli');
  } else {
    output.innerHTML += `\n<span class="err">✗ Failed. ${escapeHtml(result.stderr)}</span>`;
  }
}

async function ghAuthLogin() {
  const output = document.getElementById('gh-output');
  output.style.display = 'block';
  output.innerHTML += '\n<span class="cmd">$ gh auth login</span>\n';
  output.innerHTML += '<span class="info">Opening browser for GitHub authentication...</span>\n';

  // Use the web-based auth flow.
  const result = await window.onboard.run('gh auth login --web --git-protocol https 2>&1 || true');
  output.innerHTML += escapeHtml(result.stdout || result.stderr) + '\n';

  // Verify authentication succeeded.
  const check = await window.onboard.run('gh auth status 2>&1');
  if (check.succeeded) {
    output.innerHTML += '\n<span class="info">✓ Authenticated with GitHub!</span>';
    markStep('gh-step-login');
  } else {
    output.innerHTML += '\n<span class="err">Auth check didn\'t pass. You may need to complete it in your browser.</span>';
  }
}

// Helper to mark a step dot as complete.
function markStep(stepId) {
  const el = document.getElementById(stepId);
  if (el) {
    el.classList.add('done');
    el.textContent = '✓';
  }
}

function openLink(url) {
  window.onboard.openExternal(url);
}

// ─── Workspace Tab Logic ───────────────────────────────────────────

function suggestFolder(name) {
  document.getElementById('dev-folder-input').value = name;
}

function suggestRepo(url) {
  document.getElementById('clone-url-input').value = url;
}

async function createDevFolder() {
  const folderName = document.getElementById('dev-folder-input').value.trim();
  if (!folderName) {
    document.getElementById('dev-folder-input').focus();
    return;
  }

  const output = document.getElementById('folder-output');
  output.style.display = 'block';

  devFolderPath = `${homeDir}/${folderName}`;
  output.innerHTML = `<span class="cmd">$ mkdir -p ~/${escapeHtml(folderName)}</span>\n`;

  // Check if it already exists.
  const exists = await window.onboard.dirExists(devFolderPath);
  if (exists) {
    output.innerHTML += `<span class="info">✓ Folder already exists at ${escapeHtml(devFolderPath)}</span>`;
    document.getElementById('create-folder-btn').textContent = '✓ Exists';
    document.getElementById('create-folder-btn').classList.add('btn-success');
    enableCloneButton();
    return;
  }

  const result = await window.onboard.mkdir(devFolderPath);
  if (result.success) {
    output.innerHTML += `<span class="info">✓ Created ${escapeHtml(result.path)}</span>`;
    document.getElementById('create-folder-btn').textContent = '✓ Created';
    document.getElementById('create-folder-btn').classList.add('btn-success');
    enableCloneButton();
  } else {
    output.innerHTML += `<span class="err">✗ ${escapeHtml(result.error)}</span>`;
  }
}

function enableCloneButton() {
  document.getElementById('clone-btn').disabled = false;
}

async function cloneProject() {
  const url = document.getElementById('clone-url-input').value.trim();
  if (!url || !devFolderPath) return;

  const output = document.getElementById('clone-output');
  output.style.display = 'block';

  // Extract repo name from the URL (e.g., "next.js" from the github URL).
  const repoName = url.split('/').pop().replace('.git', '');
  clonedProjectPath = `${devFolderPath}/${repoName}`;

  output.innerHTML = `<span class="cmd">$ git clone --depth 1 ${escapeHtml(url)}</span>\n<span class="info">Cloning into ~/${escapeHtml(devFolderPath.split('/').pop())}/${escapeHtml(repoName)}...</span>\n`;

  const cloneBtn = document.getElementById('clone-btn');
  cloneBtn.disabled = true;
  cloneBtn.textContent = 'Cloning...';

  window.onboard.setStreamCallback((data) => {
    output.innerHTML += escapeHtml(data.data);
    output.scrollTop = output.scrollHeight;
  });

  const cmd = `cd "${devFolderPath}" && git clone --depth 1 ${url}`;
  const result = await window.onboard.runStreaming(cmd);
  window.onboard.clearStreamCallback();

  if (result.succeeded) {
    output.innerHTML += `\n<span class="info">✓ Cloned to ${escapeHtml(clonedProjectPath)}</span>`;
    cloneBtn.textContent = '✓ Cloned';
    cloneBtn.classList.add('btn-success');
    document.getElementById('run-btn').disabled = false;
  } else {
    output.innerHTML += `\n<span class="err">✗ Clone failed. Check the URL and try again.</span>`;
    cloneBtn.disabled = false;
    cloneBtn.textContent = 'Retry';
  }
}

async function runProject() {
  if (!clonedProjectPath) return;

  const output = document.getElementById('run-output');
  output.style.display = 'block';

  const runBtn = document.getElementById('run-btn');
  runBtn.disabled = true;
  runBtn.textContent = 'Installing deps...';

  output.innerHTML = `<span class="cmd">$ cd ${escapeHtml(clonedProjectPath)}</span>\n`;
  output.innerHTML += `<span class="cmd">$ npm install</span>\n`;

  window.onboard.setStreamCallback((data) => {
    output.innerHTML += escapeHtml(data.data);
    output.scrollTop = output.scrollHeight;
  });

  const installResult = await window.onboard.runStreaming(`cd "${clonedProjectPath}" && npm install`);
  window.onboard.clearStreamCallback();

  if (!installResult.succeeded) {
    output.innerHTML += `\n<span class="err">✗ npm install failed. Check the output above.</span>`;
    runBtn.disabled = false;
    runBtn.textContent = 'Retry';
    return;
  }

  output.innerHTML += `\n<span class="info">✓ Dependencies installed.</span>\n\n`;
  output.innerHTML += `<span class="cmd">$ npm run dev</span>\n`;
  output.innerHTML += `<span class="info">Starting project... Check your browser at http://localhost:3000</span>\n`;

  runBtn.textContent = '✓ Running';
  runBtn.classList.add('btn-success');

  // Fire off the dev server. This runs in the background — we don't await it.
  window.onboard.run(`cd "${clonedProjectPath}" && (npm run dev || npm start) &`);

  // Show the success banner.
  document.getElementById('workspace-success').style.display = 'block';
}

// ─── Helpers ───────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const original = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch {
    // Clipboard API may fail in some contexts — silently ignore.
  }
}

// ─── Startup Checks ───────────────────────────────────────────────
// Run on load to pre-populate the accounts tab status.

async function checkGitHubAuth() {
  // Check if gh CLI exists.
  const ghCliCheck = await window.onboard.run('which gh');
  if (ghCliCheck.succeeded) {
    markStep('gh-step-cli');
  }

  // Check if authenticated.
  const ghAuth = await window.onboard.run('gh auth status 2>&1');
  if (ghAuth.succeeded) {
    markStep('gh-step-login');
    markStep('gh-step-account');
  }
}

// ─── Init ──────────────────────────────────────────────────────────
// Entry point. Fetches home dir, renders the UI, runs initial checks.

async function init() {
  homeDir = await window.onboard.homedir();

  renderToolCards();
  setStatus('Scanning your machine...');

  // Run dependency checks automatically on launch.
  await checkAllDependencies();

  // Check GitHub auth status in the background.
  checkGitHubAuth();
}

init();
