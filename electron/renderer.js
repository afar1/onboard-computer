// renderer.js — UI logic for the Onboard app.
// Loads a unified {name, description, items:[...]} config and renders
// tools / apps / setup steps from ONE item model.

// ─── Release Notes Data ────────────────────────────────────────────

const RELEASE_NOTES = {
  '0.2.0': [
    'One-button setup — Set up my Mac with a single admin prompt',
    'Setup steps: Connect GitHub, Claude Code, Codex sign-in',
    'Shorthand configs — brew/cask/setup lists',
    'Faster checks — batched Homebrew queries',
    'Security hardening for shared configs',
  ],
  '0.1.3': [
    'ASCII animation in empty state (matches website)',
    'Terminal button fixes — inline toggle, pop-out behavior',
    'Renamed default config to "Builder Basics"',
    'Sample configs: Data Science, Web Developer',
  ],
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
  '0.2.0': 'Jul 6 2026',
  '0.1.3': 'Feb 11 2026',
  '0.1.2': 'Feb 11 2026',
  '0.1.0': 'Feb 11 2026',
};

function hasReleaseNotes(version) {
  return version in RELEASE_NOTES && RELEASE_NOTES[version].length > 0;
}

// ─── State ─────────────────────────────────────────────────────────

let currentConfig = null;        // { name, description, items: [...] }
// ONE unified item-state map, keyed by item id.
// { [id]: { status, installed, installing, version, latest, hasUpdate,
//           deviceCode, saving, polling } }
let itemStates = {};
let homeDir = '';

// Orchestration ("Set up my Mac") state
let orchestrating = false;

// Terminal output state — keyed by ITEM id (inline element id = terminal-<itemId>)
let terminalOutputs = {};  // { [id]: { lines: [], poppedOut, active, expanded } }
const MAX_TERMINAL_LINES = 200;

// Update state
let appVersion = '0.0.0';
let updateStatus = 'idle';
let updateError = null;
let versionHovered = false;
let showReleaseNotes = false;

// ─── Item helpers ──────────────────────────────────────────────────

function allItems() {
  return currentConfig?.items || [];
}

function itemsByKind(kind) {
  return allItems().filter(i => i.kind === kind);
}

function findItem(id) {
  return allItems().find(i => i.id === id) || null;
}

function itemState(id) {
  return itemStates[id] || { status: 'unchecked', installed: false };
}

function isSetupPending() {
  return itemsByKind('setup').some(i => !itemState(i.id).installed);
}

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
  window.onboard.setupPollStop();
  currentConfig = result;
  itemStates = {};
  terminalOutputs = {};
  orchestrating = false;
  hidePhaseBanner();
  hideSummaryPanel();

  allItems().forEach(item => {
    itemStates[item.id] = { status: 'unchecked', installed: false };
  });

  // Save for persistence
  localStorage.setItem('lastConfigPath', source);

  // Save to config history
  saveToConfigHistory(source, currentConfig?.name);

  // Update UI
  updateConfigDisplay();
  renderAllCards();
  setStatus('Ready (drop .onboard file)');

  // Auto-check all items
  checkAll();

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
  window.onboard.setupPollStop();
  localStorage.removeItem('lastConfigPath');
  currentConfig = null;
  itemStates = {};
  terminalOutputs = {};
  orchestrating = false;
  hidePhaseBanner();
  hideSummaryPanel();
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

  document.getElementById('assisted').hidden = true;
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

// Build an icon element (never string-interpolates config-derived data into
// an HTML attribute). icon_bg is applied via style.background on the element.
function buildIcon(item) {
  const wrap = document.createElement('div');
  wrap.className = 'tool-icon';
  wrap.style.background = item.icon_bg || '#30363d';

  if (item.icon_img) {
    wrap.style.padding = '4px';
    const img = document.createElement('img');
    // http(s) URL or bundled filename (both validated in main/config.js).
    img.src = item.icon_img.startsWith('http') ? item.icon_img : `assets/${item.icon_img}`;
    img.alt = item.name;
    img.addEventListener('error', () => {
      // Fallback: letter-avatar with first letter of name.
      wrap.style.padding = '';
      wrap.textContent = '';
      const avatar = document.createElement('div');
      avatar.className = 'letter-avatar';
      avatar.textContent = (item.name || '?').charAt(0).toUpperCase();
      wrap.appendChild(avatar);
    });
    wrap.appendChild(img);
  } else {
    const avatar = document.createElement('div');
    avatar.className = 'letter-avatar';
    avatar.textContent = (item.name || '?').charAt(0).toUpperCase();
    wrap.appendChild(avatar);
  }

  return wrap;
}

// Status badge HTML string (all interpolations escaped or compile-time).
function statusBadgeHtml(item, state) {
  if (state.status === 'checking') {
    return '<span class="status-badge checking">Checking...</span>';
  }
  if (item.kind === 'setup') {
    return state.installed
      ? '<span class="status-badge installed">Done</span>'
      : '<span class="status-badge missing">Not done</span>';
  }
  if (state.installed) {
    if (state.version) {
      if (state.hasUpdate && state.latest) {
        return `<span class="status-badge update-available" title="Update available: ${escapeHtml(state.latest)}">v${escapeHtml(state.version)} → v${escapeHtml(state.latest)}</span>`;
      }
      return `<span class="status-badge installed">v${escapeHtml(state.version)}</span>`;
    }
    return '<span class="status-badge installed">✓ Installed</span>';
  }
  return '<span class="status-badge missing">Not installed</span>';
}

// Terminal history/pop-out toggle button (only data attribute is item id).
function terminalHistoryBtnHtml(id, show) {
  if (!show) return '';
  return `<button class="btn btn-sm btn-terminal" data-action="show-terminal" data-id="${escapeHtml(id)}" title="View output">
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
  </button>`;
}

// SVG constants (compile-time, no config data).
const SVG_CANCEL = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const SVG_TRASH = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`;
const SVG_UPGRADE = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;
const SVG_POPOUT = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
const SVG_FOLDER = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;

// Action-area HTML for a tool/app item.
function toolActionHtml(item, state, terminalInfo) {
  const id = escapeHtml(item.id);

  if (state.status === 'checking') {
    return '<span class="spinner"></span>';
  }

  if (state.installing) {
    return `<div class="install-spinner">
      <span class="spinner"></span>
      <button class="cancel-btn" data-action="cancel" data-id="${id}" title="Cancel">${SVG_CANCEL}</button>
    </div>`;
  }

  if (state.installed) {
    const showTerminal = terminalInfo && !terminalInfo.isActive && terminalInfo.hasOutput;
    let actions = terminalHistoryBtnHtml(item.id, showTerminal);
    // Uninstall button — hidden when the item has no uninstall command.
    if (item.uninstall) {
      actions += `<button class="btn btn-sm btn-uninstall" data-action="uninstall" data-id="${id}" title="Uninstall">${SVG_TRASH}</button>`;
    }
    // Apps: reveal in Finder + Open (main resolves the .app path by id).
    if (item.kind === 'app') {
      actions += `<button class="btn btn-sm btn-uninstall" data-action="reveal-app" data-id="${id}" title="Show in Finder">${SVG_FOLDER}</button>`;
      actions += `<button class="btn btn-sm btn-open" data-action="open-app" data-id="${id}">Open</button>`;
    }
    // Upgrade button if an update is available.
    if (state.hasUpdate && item.upgrade) {
      actions += `<button class="btn btn-sm btn-upgrade" data-action="upgrade" data-id="${id}" title="Upgrade${state.latest ? ' to ' + escapeHtml(state.latest) : ''}">${SVG_UPGRADE}Upgrade</button>`;
    }
    return `<div class="tool-actions">${actions}</div>`;
  }

  // Not installed — check unmet dependency (depends_on is an array).
  const unmet = firstUnmetDep(item);
  if (unmet) {
    const depName = escapeHtml(findItem(unmet)?.name || unmet);
    return `<button class="btn btn-sm" disabled>Needs ${depName}</button>`;
  }

  return `<button class="btn btn-primary btn-sm" data-action="install" data-id="${id}">Install</button>`;
}

// Action-area HTML for a setup-kind item.
function setupActionHtml(item, state) {
  const id = escapeHtml(item.id);

  if (state.status === 'checking') {
    return '<span class="spinner"></span>';
  }

  if (state.installing) {
    return `<div class="install-spinner">
      <span class="spinner"></span>
      <button class="cancel-btn" data-action="cancel" data-id="${id}" title="Cancel">${SVG_CANCEL}</button>
    </div>`;
  }

  if (state.installed) {
    // Done — nothing to do (badge shows "Done").
    return '';
  }

  // Unmet dependency gate.
  const unmet = firstUnmetDep(item);
  if (unmet) {
    const depName = escapeHtml(findItem(unmet)?.name || unmet);
    return `<button class="btn btn-sm" disabled>Needs ${depName}</button>`;
  }

  const parts = [];

  // action → primary "Connect" button
  if (item.action) {
    parts.push(`<button class="btn btn-primary btn-sm" data-action="setup-action" data-id="${id}">Connect</button>`);
    // GitHub recipe: url rendered as a quiet "Need an account?" link.
    if (item.url) {
      parts.push(`<button class="btn-quiet-link" data-action="setup-url" data-id="${id}">Need an account?</button>`);
    }
  } else if (item.terminal) {
    parts.push(`<button class="btn btn-primary btn-sm" data-action="setup-terminal" data-id="${id}">Open Terminal</button>`);
    if (state.polling) {
      parts.push(`<span class="waiting-text"><span class="spinner spinner-sm"></span> Waiting for sign-in…</span>`);
    }
  } else if (item.url && !item.input) {
    // Pure url step → quiet "Open" link button.
    parts.push(`<button class="btn btn-sm btn-quiet" data-action="setup-url" data-id="${id}">Open</button>`);
  }

  return `<div class="tool-actions">${parts.join('')}</div>`;
}

// Inline two-field (or N-field) form for input-type setup items.
function setupInputFormHtml(item, state) {
  if (!item.input || !Array.isArray(item.input.fields)) return '';
  const id = escapeHtml(item.id);
  const fields = item.input.fields.map(f => {
    const key = escapeHtml(f.key);
    const label = escapeHtml(f.label || f.key);
    const placeholder = escapeHtml(f.placeholder || '');
    return `<label class="setup-input-field">
      <span class="setup-input-label">${label}</span>
      <input type="text" class="setup-input" data-input-key="${key}" placeholder="${placeholder}" autocomplete="off">
    </label>`;
  }).join('');

  return `<form class="setup-input-form" data-action="setup-input" data-id="${id}">
    ${fields}
    <button type="submit" class="btn btn-primary btn-sm" data-role="setup-save" disabled>${state.saving ? 'Saving…' : 'Save'}</button>
  </form>`;
}

// Device-code banner for GitHub-style flows.
function deviceCodeBannerHtml(item, state) {
  if (!state.deviceCode) return '';
  const id = escapeHtml(item.id);
  return `<div class="device-code-banner">
    <div class="device-code-value" id="device-code-${id}">${escapeHtml(state.deviceCode)}</div>
    <button class="btn btn-sm" data-action="copy-code" data-id="${id}">Copy</button>
    <span class="device-code-hint">Enter this code on github.com — we opened it in your browser.</span>
  </div>`;
}

// Terminal inline block HTML (element id = terminal-<itemId>).
function terminalInlineHtml(id, hasOutput, isPoppedOut) {
  const eid = escapeHtml(id);
  return `<div class="terminal-inline" id="terminal-${eid}" style="display: ${(hasOutput && !isPoppedOut) ? 'block' : 'none'};">
    <div class="terminal-header" data-action="toggle-terminal" data-id="${eid}">
      <span class="terminal-last-line"></span>
      <div class="terminal-actions">
        <button class="terminal-btn" data-action="popout-terminal" data-id="${eid}" title="Pop out">${SVG_POPOUT}</button>
      </div>
    </div>
    <div class="terminal-full"></div>
  </div>`;
}

// Create a card element for any item kind.
function buildCard(item) {
  const state = itemState(item.id);
  const output = terminalOutputs[item.id];
  const hasOutput = output?.lines?.length > 0;
  const isActive = output?.active;
  const isPoppedOut = output?.poppedOut;
  const terminalInfo = { id: item.id, hasOutput, isActive };

  const card = document.createElement('div');
  card.className = 'tool-card';
  card.id = `card-${item.id}`;

  const actionHtml = item.kind === 'setup'
    ? setupActionHtml(item, state)
    : toolActionHtml(item, state, terminalInfo);

  card.innerHTML = `
    <div class="tool-card-main">
      <div class="tool-info">
        <div class="tool-name">${escapeHtml(item.name)} ${statusBadgeHtml(item, state)}</div>
        <div class="tool-desc">${escapeHtml(item.desc || '')}</div>
      </div>
      <div class="tool-action">${actionHtml}</div>
    </div>
    ${item.kind === 'setup' ? deviceCodeBannerHtml(item, state) : ''}
    ${item.kind === 'setup' && item.input && !state.installed ? setupInputFormHtml(item, state) : ''}
    ${terminalInlineHtml(item.id, hasOutput, isPoppedOut)}
  `;

  // Prepend the icon element (built separately so icon_bg never touches innerHTML).
  const main = card.querySelector('.tool-card-main');
  main.insertBefore(buildIcon(item), main.firstChild);

  // Wire up input form live-validation, if present.
  const form = card.querySelector('.setup-input-form');
  if (form) {
    const inputs = Array.from(form.querySelectorAll('.setup-input'));
    const saveBtn = form.querySelector('[data-role="setup-save"]');
    const validate = () => {
      saveBtn.disabled = state.saving || inputs.some(i => !i.value.trim());
    };
    inputs.forEach(i => i.addEventListener('input', validate));
    validate();
  }

  return card;
}

function renderSection(kind, containerId, sectionId, labelId) {
  const container = document.getElementById(containerId);
  const section = document.getElementById(sectionId);
  const items = itemsByKind(kind);

  if (section) {
    section.style.display = items.length === 0 ? 'none' : '';
  }
  if (!container) return;

  container.innerHTML = '';
  items.forEach(item => {
    container.appendChild(buildCard(item));
    if (terminalOutputs[item.id]?.lines?.length > 0) {
      updateTerminalDisplay(item.id);
    }
  });

  // Per-section progress label.
  setSectionProgressLabel(kind, labelId);
}

function setSectionProgressLabel(kind, labelId) {
  const label = document.getElementById(labelId);
  if (!label) return;
  const items = itemsByKind(kind);
  const done = items.filter(i => itemState(i.id).installed).length;
  label.textContent = `${done}/${items.length} ${kind === 'setup' ? 'done' : 'installed'}`;
}

function renderAllCards() {
  renderSection('tool', 'tools-container', 'deps-section', 'deps-progress-label');
  renderSection('app', 'apps-container', 'apps-section', 'apps-progress-label');
  renderSection('setup', 'setup-container', 'setup-section', 'setup-progress-label');
  updateReadyLine();
}

// Re-render a single card in place (used by live events to avoid flicker).
function refreshCard(id) {
  const item = findItem(id);
  if (!item) return;
  const existing = document.getElementById(`card-${id}`);
  if (!existing) { renderAllCards(); return; }
  const fresh = buildCard(item);
  existing.replaceWith(fresh);
  if (terminalOutputs[id]?.lines?.length > 0) {
    updateTerminalDisplay(id);
  }
  updateSectionProgress();
  updateReadyLine();
}

function updateSectionProgress() {
  setSectionProgressLabel('tool', 'deps-progress-label');
  setSectionProgressLabel('app', 'apps-progress-label');
  setSectionProgressLabel('setup', 'setup-progress-label');
}

// Overall "x of y ready" line in the hero area.
function updateReadyLine() {
  const items = allItems();
  const ready = items.filter(i => itemState(i.id).installed).length;
  const el = document.getElementById('ready-line');
  if (el) el.textContent = `${ready} of ${items.length} ready`;
}

// ─── Checking (all status/version data comes from main) ────────────

async function checkAll() {
  const items = allItems();
  items.forEach(i => { itemStates[i.id] = { ...itemState(i.id), status: 'checking', installed: false }; });
  renderAllCards();
  setStatus('Checking...');

  const results = await window.onboard.checkAll();
  applyCheckResults(results);

  setStatus('Ready (drop .onboard file)');

  // Kick off setup polling if there are pending setup steps.
  if (isSetupPending()) {
    startSetupPolling();
  }
}

function applyCheckResults(results) {
  if (!results) return;
  Object.entries(results).forEach(([id, r]) => {
    if (!findItem(id)) return;
    itemStates[id] = {
      ...itemState(id),
      status: 'checked',
      installed: !!r.installed,
      version: r.version ?? null,
      latest: r.latest ?? null,
      hasUpdate: !!r.hasUpdate,
    };
  });
  renderAllCards();
}

async function recheckItem(id) {
  itemStates[id] = { ...itemState(id), status: 'checking' };
  refreshCard(id);
  const r = await window.onboard.checkItem(id);
  if (r) {
    itemStates[id] = {
      ...itemState(id),
      status: 'checked',
      installed: !!r.installed,
      version: r.version ?? null,
      latest: r.latest ?? null,
      hasUpdate: !!r.hasUpdate,
    };
  } else {
    itemStates[id] = { ...itemState(id), status: 'checked' };
  }
  // If a setup step just flipped to done, drop any device-code banner.
  if (itemState(id).installed) {
    itemStates[id].deviceCode = null;
    itemStates[id].polling = false;
  }
  refreshCard(id);
  maybeStopSetupPolling();
  return itemState(id).installed;
}

// ─── Dependency resolution ─────────────────────────────────────────

// depends_on is an array — return the first unmet (not-installed) dep id.
function firstUnmetDep(item) {
  const deps = Array.isArray(item.depends_on) ? item.depends_on : [];
  for (const dep of deps) {
    if (!itemState(dep).installed) return dep;
  }
  return null;
}

// ─── Install / Uninstall / Upgrade (main resolves by id) ───────────

async function installItem(id) {
  const item = findItem(id);
  if (!item) return;

  clearTerminalOutput(id);
  setTerminalActive(id, true);
  itemStates[id] = { ...itemState(id), installing: true };
  refreshCard(id);
  setStatus(`Installing ${item.name}...`);

  const result = await window.onboard.installItem(id);

  itemStates[id] = { ...itemState(id), installing: false };
  setTerminalActive(id, false);

  if (result?.cancelled) {
    setStatus('Installation cancelled');
    refreshCard(id);
    return;
  }

  if (result?.succeeded) {
    await recheckItem(id);
    logActivity('installed', item.name, itemState(id).version);
  } else {
    showError(`Failed to install ${item.name}`, result?.stderr);
    logActivity('failed', `install ${item.name}`);
    refreshCard(id);
  }
}

async function cancelItem(id) {
  await window.onboard.cancelItem(id);
  itemStates[id] = { ...itemState(id), installing: false };
  refreshCard(id);
  setStatus('Cancelled');
}

function requestUninstall(id) {
  const item = findItem(id);
  if (!item) return;
  const noun = item.kind === 'app' ? 'from your Applications folder' : 'from your system';
  const warning = item.kind === 'app'
    ? `This will remove ${item.name} ${noun}.`
    : `This will remove ${item.name} ${noun}. Other tools or apps that depend on it may stop working.`;
  showUninstallModal(id, item.name, warning);
}

async function doUninstall(id) {
  const item = findItem(id);
  if (!item) return;

  clearTerminalOutput(id);
  setTerminalActive(id, true);
  itemStates[id] = { ...itemState(id), installing: true };
  refreshCard(id);
  setStatus(`Uninstalling ${item.name}...`);

  const result = await window.onboard.uninstallItem(id);

  itemStates[id] = { ...itemState(id), installing: false };
  setTerminalActive(id, false);

  if (result?.succeeded) {
    await recheckItem(id);
    logActivity('uninstalled', item.name);
  } else {
    showError(`Failed to uninstall ${item.name}`, result?.stderr);
    logActivity('failed', `uninstall ${item.name}`);
    refreshCard(id);
  }
}

async function upgradeItem(id) {
  const item = findItem(id);
  if (!item) return;

  clearTerminalOutput(id);
  setTerminalActive(id, true);
  itemStates[id] = { ...itemState(id), installing: true };
  refreshCard(id);
  setStatus(`Upgrading ${item.name}...`);

  const result = await window.onboard.upgradeItem(id);

  itemStates[id] = { ...itemState(id), installing: false };
  setTerminalActive(id, false);

  if (result?.succeeded) {
    await recheckItem(id);
    logActivity('upgraded', item.name, itemState(id).version);
  } else {
    showError(`Failed to upgrade ${item.name}`, result?.stderr);
    logActivity('failed', `upgrade ${item.name}`);
    refreshCard(id);
  }
}

// ─── Setup steps ───────────────────────────────────────────────────

async function runSetupAction(id) {
  const item = findItem(id);
  if (!item) return;

  clearTerminalOutput(id);
  setTerminalActive(id, true);
  itemStates[id] = { ...itemState(id), installing: true };
  refreshCard(id);
  setStatus(`Connecting ${item.name}...`);

  const result = await window.onboard.runSetupAction(id);

  itemStates[id] = { ...itemState(id), installing: false };
  setTerminalActive(id, false);

  if (result?.cancelled) {
    setStatus('Cancelled');
    refreshCard(id);
    return;
  }

  if (result?.succeeded) {
    await recheckItem(id);
    if (itemState(id).installed) logActivity('done', item.name);
  } else {
    showError(`Couldn't finish ${item.name}`, result?.stderr);
    logActivity('failed', item.name);
    refreshCard(id);
  }
}

async function submitSetupInput(id, form) {
  const item = findItem(id);
  if (!item) return;

  const values = {};
  form.querySelectorAll('.setup-input').forEach(inp => {
    values[inp.getAttribute('data-input-key')] = inp.value.trim();
  });

  itemStates[id] = { ...itemState(id), saving: true };
  refreshCard(id);

  const result = await window.onboard.submitSetupInput(id, values);

  itemStates[id] = { ...itemState(id), saving: false };

  if (result?.succeeded) {
    await recheckItem(id);
    logActivity('done', item.name);
  } else {
    showError(`Couldn't save ${item.name}`, result?.stderr);
    refreshCard(id);
  }
}

function openSetupUrl(id) {
  window.onboard.openSetupUrl(id);
}

async function runSetupInTerminal(id) {
  const item = findItem(id);
  if (!item) return;
  await window.onboard.runInTerminal(id);
  // While the user signs in externally, show the waiting spinner and poll.
  itemStates[id] = { ...itemState(id), polling: true };
  refreshCard(id);
  startSetupPolling();
}

async function copyDeviceCode(id) {
  const code = itemState(id).deviceCode;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    const btn = document.querySelector(`[data-action="copy-code"][data-id="${cssEscape(id)}"]`);
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = prev; }, 1500);
    }
  } catch (e) {
    // Clipboard blocked — ignore silently.
  }
}

// ─── Setup polling ─────────────────────────────────────────────────

let setupPollingActive = false;

function startSetupPolling() {
  if (setupPollingActive) return;
  if (!isSetupPending()) return;
  setupPollingActive = true;
  window.onboard.setupPollStart();
}

function maybeStopSetupPolling() {
  if (setupPollingActive && !isSetupPending()) {
    setupPollingActive = false;
    window.onboard.setupPollStop();
    // Clear any lingering "waiting" spinners.
    itemsByKind('setup').forEach(i => {
      if (itemState(i.id).polling) {
        itemStates[i.id] = { ...itemState(i.id), polling: false };
        refreshCard(i.id);
      }
    });
  }
}

// ─── Orchestration ("Set up my Mac") ───────────────────────────────

async function startSetupFlow() {
  let plan;
  try {
    plan = await window.onboard.getPlan();
  } catch (err) {
    showError(`Couldn't build a setup plan: ${err.message}`);
    return;
  }
  if (!plan) {
    showError("Couldn't build a setup plan.");
    return;
  }
  showPlanModal(plan);
}

function planItemName(id) {
  return findItem(id)?.name || id;
}

function planListHtml(ids) {
  if (!ids || ids.length === 0) return '<p class="plan-empty">None</p>';
  return `<ul class="plan-list">${ids.map(id => `<li>${escapeHtml(planItemName(id))}</li>`).join('')}</ul>`;
}

function showPlanModal(plan) {
  const bootstrap = plan.bootstrap || [];
  const tools = plan.tools || [];
  const apps = plan.apps || [];
  const setup = plan.setup || [];
  const done = plan.done || [];

  const body = document.getElementById('plan-modal-body');
  const willInstallCount = bootstrap.length + tools.length + apps.length;

  let html = '';
  html += `<p class="plan-summary">${done.length} already set up · ${willInstallCount} to install · ${setup.length} step${setup.length === 1 ? '' : 's'} for you</p>`;

  if (bootstrap.length) {
    const adminNote = plan.needsAdmin
      ? ' <span class="plan-admin-note">needs your password once</span>'
      : '';
    html += `<div class="plan-group"><h4>Prerequisites${adminNote}</h4>${planListHtml(bootstrap)}</div>`;
  }
  if (tools.length) {
    html += `<div class="plan-group"><h4>Tools</h4>${planListHtml(tools)}</div>`;
  }
  if (apps.length) {
    html += `<div class="plan-group"><h4>Apps</h4>${planListHtml(apps)}</div>`;
  }
  if (setup.length) {
    html += `<div class="plan-group"><h4>Then, steps you'll finish</h4>${planListHtml(setup)}</div>`;
  }
  if (willInstallCount === 0 && setup.length === 0) {
    html += `<p class="plan-empty">Everything is already set up. 🎉</p>`;
  }

  body.innerHTML = html;
  document.getElementById('plan-modal').style.display = 'flex';
}

function hidePlanModal() {
  document.getElementById('plan-modal').style.display = 'none';
}

async function confirmStartSetup() {
  hidePlanModal();
  hideSummaryPanel();
  orchestrating = true;
  setHeroBusy(true);
  showPhaseBanner('Starting…');
  setStatus('Setting up your Mac...');

  let result;
  try {
    result = await window.onboard.runAll();
  } catch (err) {
    orchestrating = false;
    setHeroBusy(false);
    hidePhaseBanner();
    showError(`Setup failed: ${err.message}`);
    return;
  }

  orchestrating = false;
  setHeroBusy(false);
  onOrchestrateDone(result?.summary || result || {});
}

function cancelSetupFlow() {
  window.onboard.cancelAll();
  orchestrating = false;
  setHeroBusy(false);
  hidePhaseBanner();
  setStatus('Setup cancelled');
}

const PHASE_LABELS = {
  bootstrap: 'Setting up prerequisites…',
  tools: 'Installing tools…',
  apps: 'Installing apps…',
  setup: 'Waiting on you — finish the setup steps below',
  done: 'Done',
};

function handleOrchestrateProgress(evt) {
  if (!evt) return;
  const { phase, itemId, status, message } = evt;

  // Update the phase banner.
  if (phase && PHASE_LABELS[phase]) {
    showPhaseBanner(PHASE_LABELS[phase]);
  }
  if (phase === 'setup') {
    startSetupPolling();
  }

  // Update the specific card, if this event names one.
  if (itemId && findItem(itemId)) {
    const prev = itemState(itemId);
    switch (status) {
      case 'start':
      case 'running':
        itemStates[itemId] = { ...prev, status: 'checked', installing: true, orchStatus: 'running', orchMessage: null };
        break;
      case 'done':
        itemStates[itemId] = { ...prev, installing: false, installed: true, orchStatus: 'done', orchMessage: null };
        break;
      case 'failed':
        itemStates[itemId] = { ...prev, installing: false, orchStatus: 'failed', orchMessage: message || null };
        break;
      case 'skipped':
        itemStates[itemId] = { ...prev, installing: false, orchStatus: 'skipped', orchMessage: message || null };
        break;
      default:
        break;
    }
    refreshCard(itemId);
    updateSectionProgress();
    updateReadyLine();
    applyOrchStatusDecoration(itemId);
  }
}

// Add a small status marker (spinner/check/red/amber) to a card during orchestration.
function applyOrchStatusDecoration(id) {
  const card = document.getElementById(`card-${id}`);
  if (!card) return;
  const st = itemState(id);
  card.classList.remove('orch-running', 'orch-done', 'orch-failed', 'orch-skipped');
  if (st.orchStatus === 'running') card.classList.add('orch-running');
  else if (st.orchStatus === 'done') card.classList.add('orch-done');
  else if (st.orchStatus === 'failed') card.classList.add('orch-failed');
  else if (st.orchStatus === 'skipped') card.classList.add('orch-skipped');

  // Skipped: surface the message inline.
  let note = card.querySelector('.orch-note');
  if (st.orchStatus === 'skipped' || st.orchStatus === 'failed') {
    if (!note) {
      note = document.createElement('div');
      note.className = 'orch-note';
      card.appendChild(note);
    }
    note.textContent = st.orchMessage || (st.orchStatus === 'skipped' ? 'Skipped' : 'Failed');
  } else if (note) {
    note.remove();
  }
}

function onOrchestrateDone(summary) {
  showPhaseBanner(PHASE_LABELS.done);

  const installed = summary.installed ?? [];
  const failed = summary.failed ?? [];
  const remaining = summary.remaining ?? itemsByKind('setup').filter(i => !itemState(i.id).installed).map(i => i.id);

  const installedCount = Array.isArray(installed) ? installed.length : Number(installed) || 0;
  const failedArr = Array.isArray(failed) ? failed : [];

  const parts = [`Setup finished — ${installedCount} installed`];
  if (failedArr.length) parts.push(`${failedArr.length} failed`);
  logActivity('summary', parts.join(', '));

  showSummaryPanel(installedCount, failedArr, remaining);

  // If setup steps remain, keep polling; otherwise stop.
  if (isSetupPending()) startSetupPolling();
  else maybeStopSetupPolling();
}

// ─── Phase banner ──────────────────────────────────────────────────

function showPhaseBanner(text) {
  const el = document.getElementById('phase-banner');
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
}

function hidePhaseBanner() {
  const el = document.getElementById('phase-banner');
  if (el) el.style.display = 'none';
}

function setHeroBusy(busy) {
  const btn = document.getElementById('setup-mac-btn');
  if (btn) {
    btn.disabled = busy;
    btn.textContent = busy ? 'Setting up…' : 'Set up my Mac';
  }
}

// ─── Summary panel ─────────────────────────────────────────────────

function showSummaryPanel(installedCount, failedArr, remaining) {
  const panel = document.getElementById('summary-panel');
  if (!panel) return;

  let html = `<div class="summary-title">Setup complete</div>`;
  html += `<div class="summary-line summary-ok">Installed ${installedCount} item${installedCount === 1 ? '' : 's'}</div>`;

  if (failedArr.length) {
    const names = failedArr.map(f => {
      const id = typeof f === 'string' ? f : (f.id || f.name);
      return escapeHtml(planItemName(id));
    }).join(', ');
    html += `<div class="summary-line summary-fail">Failed ${failedArr.length}: ${names}</div>`;
  }

  const remainingItems = (remaining || [])
    .map(id => findItem(typeof id === 'string' ? id : id.id))
    .filter(Boolean);
  if (remainingItems.length) {
    html += `<div class="summary-line">Remaining steps for you:</div>`;
    html += `<ul class="summary-remaining">${remainingItems.map(i => `<li>${escapeHtml(i.name)}</li>`).join('')}</ul>`;
  }

  html += `<div class="summary-log-hint">View the full log in the activity popup (click the status text below).</div>`;
  html += `<button class="btn btn-sm" data-action="dismiss-summary">Dismiss</button>`;

  panel.innerHTML = html;
  panel.style.display = 'block';
}

function hideSummaryPanel() {
  const panel = document.getElementById('summary-panel');
  if (panel) panel.style.display = 'none';
}

// ─── Theme ─────────────────────────────────────────────────────────

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);

  const sunIcon = document.getElementById('theme-icon-sun');
  const moonIcon = document.getElementById('theme-icon-moon');
  if (sunIcon && moonIcon) {
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
    if (terminalOutputs[id].lines.length > MAX_TERMINAL_LINES) {
      terminalOutputs[id].lines.shift();
    }
  });
  updateTerminalDisplay(id);

  if (terminalOutputs[id].poppedOut) {
    window.onboard.sendToTerminalWindow(id, data, stream);
  }
}

function updateTerminalDisplay(id) {
  const el = document.getElementById(`terminal-${id}`);
  const output = terminalOutputs[id];
  const hasOutput = output && output.lines.length > 0;
  const isPoppedOut = output?.poppedOut;

  if (!el) return;

  if (!hasOutput || isPoppedOut) {
    el.style.display = 'none';
    return;
  }

  el.style.display = 'block';

  if (output?.expanded) el.classList.add('expanded');
  else el.classList.remove('expanded');

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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

// CSS.escape shim for attribute selectors built from ids.
function cssEscape(str) {
  if (window.CSS && CSS.escape) return CSS.escape(str);
  return String(str).replace(/["\\\]]/g, '\\$&');
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

  el.style.display = 'block';
  el.classList.add('expanded');

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

  const name = findItem(id)?.name || id;
  const existingOutput = terminalOutputs[id].lines.map(l => l.text).join('\n');

  await window.onboard.openTerminalWindow(id, name, existingOutput);
}

function onTerminalWindowClosed(id) {
  if (terminalOutputs[id]) {
    terminalOutputs[id].poppedOut = false;
  }
  updateTerminalDisplay(id);
}

// ─── Activity Log ──────────────────────────────────────────────────

let activityLog = [];
let statusQueue = [];
let statusTimeout = null;

function logActivity(action, name, version = null) {
  const entry = { action, name, version, timestamp: new Date() };
  activityLog.unshift(entry);
  if (activityLog.length > 50) activityLog.pop();

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
    case 'done':
      message = `${name} — done`;
      break;
    case 'summary':
      message = name;  // full sentence passed in
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
  if (statusTimeout) return;

  if (statusQueue.length === 0) {
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
  }, 2500);
}

function setStatusDirect(text) {
  const el = document.getElementById('status-text');
  if (el) el.textContent = text;
}

// ─── UI Helpers ────────────────────────────────────────────────────

function setStatus(text) {
  if (statusTimeout) {
    clearTimeout(statusTimeout);
    statusTimeout = null;
  }
  statusQueue = [];
  const el = document.getElementById('status-text');
  if (el) el.textContent = text;
}

function setStatusLoading(loading) {
  const el = document.getElementById('status-text');
  if (el) {
    if (loading) el.classList.add('loading');
    else el.classList.remove('loading');
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

    if (details && details.trim()) {
      detailsBtn.style.display = 'block';
      detailsTextEl.textContent = details.trim();
      detailsEl.style.display = 'none';
    } else {
      detailsBtn.style.display = 'none';
      detailsEl.style.display = 'none';
    }

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

let pendingUninstall = null;  // item id

function showUninstallModal(id, name, warning) {
  pendingUninstall = id;
  document.getElementById('uninstall-name').textContent = name;
  document.getElementById('uninstall-warning').textContent = warning;
  document.getElementById('uninstall-confirm-input').value = '';
  document.getElementById('uninstall-confirm-btn').disabled = true;
  document.getElementById('uninstall-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('uninstall-confirm-input').focus(), 100);
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
  const id = pendingUninstall;
  hideUninstallModal();
  await doUninstall(id);
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
                 entry.action === 'upgraded' ? '↑' :
                 entry.action === 'done' ? '✓' :
                 entry.action === 'summary' ? '⚑' : '!';
    const className = entry.action === 'failed' ? 'failed' : '';
    const text = entry.action === 'summary'
      ? escapeHtml(entry.name)
      : `${escapeHtml(entry.action)} ${escapeHtml(entry.name)}${entry.version ? ' v' + escapeHtml(entry.version) : ''}`;

    return `<li class="${className}">
      <span class="activity-icon">${icon}</span>
      <span class="activity-text">${text}</span>
      <span class="activity-time">${escapeHtml(timeAgo)}</span>
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
  const filtered = history.filter(h => h.path !== source);
  filtered.unshift({
    path: source,
    name: name || source.split('/').pop(),
    timestamp: Date.now(),
  });
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
    const displayPath = escapeHtml(formatPath(entry.path));
    return `<li data-action="load-history" data-path="${escapeHtml(entry.path)}">
      <span class="config-history-name">${escapeHtml(entry.name)}</span>
      <span class="config-history-path">${displayPath}</span>
    </li>`;
  }).join('');
}

async function loadConfigFromHistory(path) {
  toggleConfigHistory();
  await loadConfig(path);
}

// ─── ASCII Animation ───────────────────────────────────────────────

const FRAME_COUNT = 78;
const ANIMATION_FPS = 15;
let animationFrames = [];
let animationInterval = null;

async function initAsciiAnimation() {
  const el = document.getElementById('ascii-animation');
  if (!el) return;

  for (let i = 1; i <= FRAME_COUNT; i++) {
    const num = String(i).padStart(5, '0');
    try {
      const res = await fetch(`animations/computer/frame_${num}.txt`);
      animationFrames.push(await res.text());
      if (i === 1) el.textContent = animationFrames[0];
    } catch (e) {
      break;
    }
  }

  if (animationFrames.length > 0) {
    let current = 0;
    animationInterval = setInterval(() => {
      current = (current + 1) % animationFrames.length;
      el.textContent = animationFrames[current];
    }, 1000 / ANIMATION_FPS);
  }
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
    if (file && (file.name.endsWith('.onboard') || file.name === 'Brewfile' || file.name.startsWith('Brewfile.'))) {
      const filePath = window.onboard.getFilePath(file);
      await loadConfig(filePath);
    } else if (file) {
      showError('Please drop a .onboard file or a Brewfile');
    }
  });

  window.onboard.onFileOpened(async (filePath) => {
    await loadConfig(filePath);
  });
}

// ─── Delegated event handling ──────────────────────────────────────

// Map data-action → handler. Every action addresses an item by data-id.
function handleDelegatedAction(action, id, el, e) {
  switch (action) {
    case 'install': installItem(id); break;
    case 'cancel': cancelItem(id); break;
    case 'uninstall': requestUninstall(id); break;
    case 'upgrade': upgradeItem(id); break;
    case 'setup-action': runSetupAction(id); break;
    case 'setup-url': openSetupUrl(id); break;
    case 'setup-terminal': runSetupInTerminal(id); break;
    case 'copy-code': copyDeviceCode(id); break;
    case 'open-app': window.onboard.openItemApp(id); break;
    case 'reveal-app': window.onboard.revealItem(id); break;
    case 'show-terminal': showTerminalHistory(id); break;
    case 'toggle-terminal': toggleTerminalExpand(id); break;
    case 'popout-terminal': e.stopPropagation(); popOutTerminal(id); break;
    case 'load-history': loadConfigFromHistory(el.getAttribute('data-path')); break;
    case 'dismiss-summary': hideSummaryPanel(); break;
    default: break;
  }
}

function initDelegation() {
  // Click delegation across the whole app (cards live in multiple containers).
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.getAttribute('data-action');
    // Skip form-submit action (handled by 'submit' listener below).
    if (action === 'setup-input') return;
    const id = el.getAttribute('data-id');
    handleDelegatedAction(action, id, el, e);
  });

  // Setup input form submissions.
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-action="setup-input"]');
    if (!form) return;
    e.preventDefault();
    submitSetupInput(form.getAttribute('data-id'), form);
  });
}

// ─── Initialization ────────────────────────────────────────────────

function initEventStreams() {
  // Stream output → route to inline terminal by ITEM id.
  window.onboard.onStreamOutput((evt) => {
    if (evt && evt.id) {
      appendTerminalOutput(evt.id, evt.data, evt.stream);
    }
  });

  // Live per-item status updates (from setup polling, background checks).
  window.onboard.onItemStatus((evt) => {
    if (!evt || !evt.id || !findItem(evt.id)) return;
    const prev = itemState(evt.id);
    const wasInstalled = prev.installed;
    itemStates[evt.id] = {
      ...prev,
      status: 'checked',
      installed: !!evt.installed,
      version: evt.version ?? prev.version ?? null,
      latest: evt.latest ?? prev.latest ?? null,
      hasUpdate: evt.hasUpdate ?? prev.hasUpdate ?? false,
    };
    // Setup step flipped to done → clear device-code banner + waiting spinner.
    if (!wasInstalled && itemStates[evt.id].installed) {
      itemStates[evt.id].deviceCode = null;
      itemStates[evt.id].polling = false;
    }
    refreshCard(evt.id);
    maybeStopSetupPolling();
  });

  // Orchestration progress → phase banner + per-card status.
  window.onboard.onOrchestrateProgress((evt) => {
    handleOrchestrateProgress(evt);
  });

  // Device code (e.g. GitHub) → banner on the item's card.
  window.onboard.onDeviceCode((evt) => {
    if (!evt || !evt.id || !findItem(evt.id)) return;
    itemStates[evt.id] = { ...itemState(evt.id), deviceCode: evt.code };
    refreshCard(evt.id);
  });

  // Pop-out terminal window closed.
  window.onboard.onTerminalWindowClosed((id) => {
    onTerminalWindowClosed(id);
  });
}

async function init() {
  initTheme();
  initDragDrop();
  initDelegation();
  initUpdater();
  initEventStreams();
  initAsciiAnimation();

  homeDir = await window.onboard.homedir();

  const lastConfig = localStorage.getItem('lastConfigPath');
  if (lastConfig && lastConfig !== 'bundled' && lastConfig.length > 0) {
    const success = await loadConfig(lastConfig);
    if (!success) showEmptyState();
  } else {
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('assisted').hidden = false;
    setStatus('Support-call setup');
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
        ${updateStatus === 'uptodate' ? 'Up to date ✓' : 'v' + escapeHtml(appVersion)}</span>`;
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
  document.getElementById('release-notes-list').innerHTML = notes.map(n => `<li><span class="bullet">•</span><span>${escapeHtml(n)}</span></li>`).join('');

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
