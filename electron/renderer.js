// renderer.js — All the onboarding logic that runs in the browser window.
// Talks to the main process exclusively through window.onboard (the preload bridge).
// No Node.js access here — just DOM manipulation and IPC calls.

// ─── Tool Definitions ──────────────────────────────────────────────
// Each tool has an id, display name, description, why it matters,
// the check id (for the IPC handler), and install instructions.
// ORDER MATTERS — Homebrew first because everything else depends on it.

const TOOLS = [
  {
    id: 'xcode-cli',
    name: 'Xcode CLI Tools',
    icon: '🛠',
    iconBg: '#1c7ed6',
    iconColor: '#fff',
    desc: 'Apple\'s command line developer tools. Compilers, git, and build essentials.',
    explain: '<strong>Why:</strong> Xcode Command Line Tools include essential compilers (clang), git, make, and other build tools that everything else depends on. This is the foundation — Homebrew won\'t work without it.',
    installCmd: 'xcode-select --install',
    installNote: 'A dialog will appear. Click "Install" and wait for it to complete.',
  },
  {
    id: 'homebrew',
    name: 'Homebrew',
    iconImg: 'assets/homebrew.svg',
    iconBg: '#fbb040',
    desc: 'The package manager for macOS. Installs everything else.',
    explain: '<strong>Why:</strong> Homebrew is the standard way to install developer tools on macOS. Almost every other tool on this list can be installed through it. Think of it as the App Store for command-line tools.',
    installCmd: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    installNote: 'This may take a few minutes and will ask for your password.',
    dependsOn: 'xcode-cli',
  },
  {
    id: 'git',
    name: 'Git',
    iconImg: 'assets/git.png',
    iconBg: '#f0f0f0',
    desc: 'Version control. Track changes, collaborate, push to GitHub.',
    explain: '<strong>Why:</strong> Git is how every developer tracks code changes and collaborates. When you "push" code to GitHub or "pull" someone else\'s project, you\'re using Git. It\'s non-negotiable — every team, every project, everywhere.',
    installCmd: 'brew install git',
    dependsOn: 'homebrew',
  },
  {
    id: 'node',
    name: 'Node.js',
    iconImg: 'assets/nodejs.svg',
    iconBg: '#333',
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
    iconImg: 'assets/bun.svg',
    iconBg: '#fbf0df',
    desc: 'Fast JavaScript runtime and package manager. Drop-in npm replacement.',
    explain: '<strong>Why:</strong> Bun is a blazing-fast alternative to Node.js for running JavaScript and installing packages. Many newer projects use it for speed. It\'s optional but increasingly popular in the ecosystem.',
    installCmd: 'brew install oven-sh/bun/bun',
    dependsOn: 'homebrew',
  },
  {
    id: 'claude',
    name: 'Claude CLI',
    icon: '✦',
    iconBg: '#d97706',
    iconColor: '#fff',
    desc: 'AI coding assistant from Anthropic. Powers your pair programming.',
    explain: '<strong>Why:</strong> The Claude CLI gives you an AI coding partner right in your terminal. It can write code, explain errors, refactor, and debug alongside you. This is the engine behind the AI-assisted development workflow and the <code>field-theory</code> toolchain.',
    installCmd: 'npm install -g @anthropic-ai/claude-code',
    dependsOn: 'node',
  },
  {
    id: 'gh',
    name: 'GitHub CLI',
    iconImg: 'assets/github.png',
    iconBg: '#24292e',
    desc: 'GitHub from the command line. Create PRs, issues, and manage repos.',
    explain: '<strong>Why:</strong> The GitHub CLI (<code>gh</code>) lets you interact with GitHub without leaving your terminal. Create pull requests, view issues, trigger workflows, and authenticate Git — all from the command line.',
    installCmd: 'brew install gh',
    dependsOn: 'homebrew',
  },
  {
    id: 'cursor-cli',
    name: 'Cursor CLI',
    iconImg: 'assets/Cursor.png',
    iconBg: '#1a1a2e',
    desc: 'Open projects in Cursor from the terminal with the <code>cursor</code> command.',
    explain: '<strong>Why:</strong> The Cursor CLI lets you open files and folders in Cursor directly from your terminal, just like <code>code .</code> for VS Code. Run <code>cursor .</code> to open the current directory.',
    installCmd: 'cursor --install-extension',
    dependsOn: 'homebrew',
  },
];

// ─── QOL Apps ──────────────────────────────────────────────────────
// Quality-of-life macOS apps that make development more pleasant.
// These are installed via Homebrew cask.

const QOL_APPS = [
  {
    id: 'fieldtheory',
    name: 'Field Theory',
    iconImg: 'assets/fieldtheory-icon.png',
    iconBg: '#1a1a2e',
    desc: 'Local voice transcripts and context management.',
    explain: '<strong>Why:</strong> Field Theory handles voice-to-text transcription locally on your device and manages context across your development workflow — keeping everything private and fast.',
    installCmd: 'brew install --cask fieldtheory',
    checkCmd: 'ls /Applications/Field\\ Theory.app',
    dependsOn: 'homebrew',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    iconImg: 'assets/Cursor.png',
    iconBg: '#1a1a2e',
    desc: 'AI-powered code editor. VS Code fork with built-in AI assistance.',
    explain: '<strong>Why:</strong> Cursor is a code editor built around AI — it has Claude and GPT built right in for code generation, editing, and chat. It\'s VS Code under the hood, so all your extensions work.',
    installCmd: 'brew install --cask cursor',
    checkCmd: 'ls /Applications/Cursor.app',
    dependsOn: 'homebrew',
  },
  {
    id: 'rectangle',
    name: 'Rectangle',
    iconImg: 'assets/Rectangle.png',
    iconBg: 'var(--bg-tertiary)',
    desc: 'Window management with keyboard shortcuts. Snap windows to edges.',
    explain: '<strong>Why:</strong> macOS doesn\'t have built-in window snapping. Rectangle lets you tile windows with keyboard shortcuts (like ⌘⌥← for left half). Essential for multi-window workflows.',
    installCmd: 'brew install --cask rectangle',
    checkCmd: 'ls /Applications/Rectangle.app',
    dependsOn: 'homebrew',
  },
  {
    id: 'alfred',
    name: 'Alfred',
    iconImg: 'assets/Alfred-5.png',
    iconBg: 'var(--bg-tertiary)',
    desc: 'Spotlight replacement with workflows, snippets, and clipboard history.',
    explain: '<strong>Why:</strong> Alfred is a supercharged launcher. Beyond just opening apps, it has clipboard history, text expansion, custom workflows, and integrations with everything. Most power users can\'t live without it.',
    installCmd: 'brew install --cask alfred',
    checkCmd: 'ls /Applications/Alfred\\ 5.app || ls /Applications/Alfred\\ 4.app || ls "/Applications/Alfred.app"',
    dependsOn: 'homebrew',
  },
  {
    id: 'caffeine',
    name: 'Caffeine',
    iconImg: 'assets/Caffeine.png',
    iconBg: 'var(--bg-tertiary)',
    desc: 'Keeps your Mac awake. One click to prevent sleep.',
    explain: '<strong>Why:</strong> When you\'re running long builds, presentations, or just don\'t want your screen dimming, Caffeine sits in your menu bar and keeps your Mac awake with a single click.',
    installCmd: 'brew install --cask caffeine',
    checkCmd: 'ls /Applications/Caffeine.app',
    dependsOn: 'homebrew',
  },
  {
    id: 'xcode',
    name: 'Xcode',
    icon: '🔨',
    iconBg: '#1c7ed6',
    iconColor: '#fff',
    desc: 'Apple\'s full IDE. Required for iOS/macOS development.',
    explain: '<strong>Why:</strong> The full Xcode app is needed if you\'re building iOS or macOS apps, or if you need simulators. It\'s large (~12GB) so only install if you need it.',
    installCmd: 'open "macappstore://apps.apple.com/app/xcode/id497799835"',
    checkCmd: 'ls /Applications/Xcode.app',
    dependsOn: 'homebrew',
  },
];

// ─── State ─────────────────────────────────────────────────────────
// Simple state object tracking each tool's check result.

const toolStates = {};
TOOLS.forEach(t => {
  toolStates[t.id] = { status: 'unchecked', installed: false, version: null };
});

const qolStates = {};
QOL_APPS.forEach(t => {
  qolStates[t.id] = { status: 'unchecked', installed: false };
});

// Stack state
const stackState = {
  deps: { currentIndex: 0, expanded: false },
  apps: { currentIndex: 0, expanded: false },
};

// ─── Theme Toggle ──────────────────────────────────────────────────

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-dark').classList.toggle('active', theme === 'dark');
  document.getElementById('theme-light').classList.toggle('active', theme === 'light');
  localStorage.setItem('theme', theme);
}

function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  setTheme(saved);
}

// ─── Stack Navigation ──────────────────────────────────────────────

function toggleStack(stackId) {
  const stack = stackState[stackId];
  stack.expanded = !stack.expanded;

  const containerId = stackId === 'deps' ? 'tools-stack' : 'apps-stack';
  const container = document.getElementById(containerId);
  const btn = document.getElementById(`show-all-${stackId}-btn`);

  if (stack.expanded) {
    container.classList.add('expanded');
    btn.textContent = 'Collapse';
  } else {
    container.classList.remove('expanded');
    btn.textContent = 'Show All';
  }

  if (stackId === 'deps') renderToolCards();
  else renderQolCards();
}

function navigateStack(stackId, direction) {
  const stack = stackState[stackId];
  const items = stackId === 'deps' ? TOOLS : QOL_APPS;

  stack.currentIndex = Math.max(0, Math.min(items.length - 1, stack.currentIndex + direction));

  if (stackId === 'deps') renderToolCards();
  else renderQolCards();

  updateStackSummary(stackId);
}

function updateStackSummary(stackId) {
  const stack = stackState[stackId];
  const items = stackId === 'deps' ? TOOLS : QOL_APPS;
  const states = stackId === 'deps' ? toolStates : qolStates;

  const installed = items.filter(t => states[t.id].installed).length;
  const summary = document.getElementById(`${stackId}-summary`);

  if (stack.expanded) {
    summary.textContent = '';
  } else {
    summary.textContent = `${stack.currentIndex + 1} of ${items.length} · ${installed}/${items.length} installed`;
  }
}

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

  const { currentIndex, expanded } = stackState.deps;

  // Reorder tools so current item is first when stacked
  let orderedTools = [...TOOLS];
  if (!expanded) {
    orderedTools = [
      ...TOOLS.slice(currentIndex),
      ...TOOLS.slice(0, currentIndex)
    ];
  }

  orderedTools.forEach((tool, idx) => {
    const state = toolStates[tool.id];
    const isExpanded = expandedPanels.has(tool.id);
    const card = document.createElement('div');
    card.className = 'tool-card fade-in';
    card.id = `tool-${tool.id}`;
    card.setAttribute('data-index', idx);

    const iconHtml = tool.iconImg
      ? `<div class="tool-icon" style="background: ${tool.iconBg}; padding: 4px;"><img src="${tool.iconImg}" style="width: 100%; height: 100%; object-fit: contain;"></div>`
      : `<div class="tool-icon" style="background: ${tool.iconBg}; color: ${tool.iconColor || '#fff'};">${tool.icon}</div>`;

    card.innerHTML = `
      <div class="tool-card-header">
        ${iconHtml}
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

// ─── Render QOL App Cards ──────────────────────────────────────────

function renderQolCards() {
  const container = document.getElementById('qol-container');
  if (!container) return;
  container.innerHTML = '';

  const { currentIndex, expanded } = stackState.apps;

  // Reorder apps so current item is first when stacked
  let orderedApps = [...QOL_APPS];
  if (!expanded) {
    orderedApps = [
      ...QOL_APPS.slice(currentIndex),
      ...QOL_APPS.slice(0, currentIndex)
    ];
  }

  orderedApps.forEach((app, idx) => {
    const state = qolStates[app.id];
    const isExpanded = expandedPanels.has('qol-' + app.id);
    const card = document.createElement('div');
    card.className = 'tool-card fade-in';
    card.id = `qol-${app.id}`;
    card.setAttribute('data-index', idx);

    const iconHtml = app.iconImg
      ? `<div class="tool-icon" style="background: ${app.iconBg}; padding: 0;"><img src="${app.iconImg}" style="width: 100%; height: 100%; object-fit: contain;"></div>`
      : `<div class="tool-icon" style="background: ${app.iconBg}; color: ${app.iconColor || '#fff'};">${app.icon}</div>`;

    card.innerHTML = `
      <div class="tool-card-header">
        ${iconHtml}
        <div class="tool-info">
          <div class="tool-name">
            ${app.name}
            ${renderStatusBadge(state)}
          </div>
          <div class="tool-desc">${app.desc}</div>
        </div>
        <div class="tool-action">
          ${renderQolAction(app, state)}
        </div>
      </div>
      <div class="tool-details" id="details-qol-${app.id}" style="display: ${isExpanded ? 'block' : 'none'};">
        <div class="tool-explain">${app.explain}</div>
        ${app.installCmd ? `
          <div class="install-command">
            <code>${escapeHtml(app.installCmd)}</code>
            <button class="copy-btn" onclick="copyToClipboard(\`${app.installCmd.replace(/`/g, '\\`')}\`, this)" title="Copy command">📋</button>
          </div>
        ` : ''}
        <div class="terminal-output" id="output-qol-${app.id}" style="display: none;"></div>
      </div>
    `;

    card.querySelector('.tool-card-header').addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const key = 'qol-' + app.id;
      if (expandedPanels.has(key)) {
        expandedPanels.delete(key);
      } else {
        expandedPanels.add(key);
      }
      const details = card.querySelector('.tool-details');
      details.style.display = expandedPanels.has(key) ? 'block' : 'none';
    });

    container.appendChild(card);
  });
}

function renderQolAction(app, state) {
  if (state.status === 'checking' || state.status === 'installing') {
    return '<span class="spinner"></span>';
  }
  if (state.installed) {
    return '<span style="color: var(--green); font-size: 18px;">✓</span>';
  }
  if (state.status === 'checked' && !state.installed) {
    if (app.dependsOn && !toolStates[app.dependsOn]?.installed) {
      return `<button class="btn btn-sm" disabled>Needs Homebrew</button>`;
    }
    return `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); installQolApp('${app.id}')">Install</button>`;
  }
  return '';
}

async function checkQolApps() {
  for (const app of QOL_APPS) {
    qolStates[app.id].status = 'checking';
    renderQolCards();

    try {
      const result = await window.onboard.run(app.checkCmd);
      qolStates[app.id] = {
        status: 'checked',
        installed: result.succeeded,
      };
    } catch (err) {
      qolStates[app.id] = { status: 'checked', installed: false };
    }

    renderQolCards();
  }
}

async function installQolApp(appId) {
  const app = QOL_APPS.find(a => a.id === appId);
  if (!app) return;

  if (app.dependsOn && !toolStates[app.dependsOn]?.installed) {
    alert('You need to install Homebrew first.');
    return;
  }

  qolStates[appId].status = 'installing';
  expandedPanels.add('qol-' + appId);
  renderQolCards();

  const output = document.getElementById(`output-qol-${appId}`);
  if (output) {
    output.style.display = 'block';
    output.innerHTML = `<span class="cmd">$ ${escapeHtml(app.installCmd)}</span>\n`;
  }

  setStatus(`Installing ${app.name}...`);

  try {
    window.onboard.setStreamCallback((data) => {
      if (output) {
        const cls = data.stream === 'stderr' ? 'err' : '';
        output.innerHTML += `<span class="${cls}">${escapeHtml(data.data)}</span>`;
        output.scrollTop = output.scrollHeight;
      }
    });

    const result = await window.onboard.runStreaming(app.installCmd);
    window.onboard.clearStreamCallback();

    if (result.succeeded) {
      qolStates[appId] = { status: 'checked', installed: true };
      if (output) {
        output.innerHTML += `\n<span class="info">✓ ${app.name} installed successfully.</span>`;
      }
    } else {
      qolStates[appId].status = 'checked';
      if (output) {
        output.innerHTML += `\n<span class="err">✗ Installation failed (exit code ${result.exitCode}).</span>`;
      }
    }
  } catch (err) {
    window.onboard.clearStreamCallback();
    qolStates[appId].status = 'checked';
    if (output) {
      output.innerHTML += `\n<span class="err">Error: ${escapeHtml(err.message)}</span>`;
    }
  }

  renderQolCards();
  setStatus('');
}

// ─── Install All Functions ─────────────────────────────────────────

async function installAllDeps() {
  const btn = document.getElementById('install-all-deps-btn');
  btn.disabled = true;
  btn.textContent = 'Installing...';

  // Install in order, respecting dependencies
  for (const tool of TOOLS) {
    if (toolStates[tool.id].installed) continue;

    // Check if dependency is met
    if (tool.dependsOn && !toolStates[tool.dependsOn].installed) {
      continue; // Skip if dependency not met (will be installed in order)
    }

    await installTool(tool.id);
  }

  btn.disabled = false;
  btn.textContent = 'Install All';
  updateOverallStatus();
}

async function installAllApps() {
  const btn = document.getElementById('install-all-apps-btn');
  btn.disabled = true;
  btn.textContent = 'Installing...';

  // Check if Homebrew is installed first
  if (!toolStates['homebrew']?.installed) {
    alert('Please install Homebrew first from the Dependencies section.');
    btn.disabled = false;
    btn.textContent = 'Install All';
    return;
  }

  for (const app of QOL_APPS) {
    if (qolStates[app.id].installed) continue;
    await installQolApp(app.id);
  }

  btn.disabled = false;
  btn.textContent = 'Install All';
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

  document.getElementById('deps-progress-label').textContent = `${installed}/${total}`;

  // Update the badge on the Setup tab.
  const badge = document.getElementById('deps-badge');
  if (installed === total) {
    badge.className = 'tab-badge complete';
    badge.textContent = '✓';
  } else {
    badge.className = 'tab-badge pending';
    badge.textContent = `${installed}/${total}`;
  }

  updateStackSummary('deps');
  updateStackSummary('apps');
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

async function checkClaudeAuth() {
  // Check if Claude CLI exists.
  const claudeCliCheck = await window.onboard.run('which claude');
  if (claudeCliCheck.succeeded) {
    markStep('claude-step-cli');
  }

  // Check if authenticated by looking for credentials.
  // Claude CLI stores auth in ~/.claude/ directory.
  const authCheck = await window.onboard.run('test -d ~/.claude && test -f ~/.claude/.credentials.json && echo "authenticated"');
  if (authCheck.succeeded && authCheck.stdout.includes('authenticated')) {
    markStep('claude-step-auth');
    markStep('claude-step-account');
  }
}

async function claudeAuth() {
  const output = document.getElementById('claude-output');
  output.style.display = 'block';
  output.innerHTML = '<span class="cmd">$ claude</span>\n';
  output.innerHTML += '<span class="info">Opening Claude CLI for authentication...</span>\n';
  output.innerHTML += '<span class="info">This will open a browser window. Complete the login there.</span>\n';

  // Launch claude which will prompt for auth if not authenticated.
  // We use a simple invocation that will trigger the auth flow.
  const result = await window.onboard.run('claude --version 2>&1');
  output.innerHTML += escapeHtml(result.stdout || result.stderr) + '\n';

  // Re-check auth status.
  await checkClaudeAuth();

  const authCheck = await window.onboard.run('test -f ~/.claude/.credentials.json && echo "ok"');
  if (authCheck.succeeded && authCheck.stdout.includes('ok')) {
    output.innerHTML += '\n<span class="info">✓ Claude CLI is authenticated!</span>';
  } else {
    output.innerHTML += '\n<span class="info">Run "claude" in your terminal to complete authentication.</span>';
  }
}

// ─── Init ──────────────────────────────────────────────────────────
// Entry point. Fetches home dir, renders the UI, runs initial checks.

async function init() {
  initTheme();
  homeDir = await window.onboard.homedir();

  renderToolCards();
  renderQolCards();
  updateStackSummary('deps');
  updateStackSummary('apps');
  setStatus('Scanning your machine...');

  // Run dependency checks automatically on launch.
  await checkAllDependencies();

  // Check QOL apps in parallel.
  checkQolApps();

  // Check auth status in the background.
  checkGitHubAuth();
  checkClaudeAuth();

  // Update summaries after checks
  updateStackSummary('deps');
  updateStackSummary('apps');
}

init();
