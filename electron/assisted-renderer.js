const hostSelect = document.getElementById('assistant-host');
hostSelect.value = localStorage.getItem('assisted-host') === 'claude' ? 'claude' : 'chatgpt';
const promptArea = document.getElementById('assisted-prompt');
let observedSetup = null;
function updatePrompt() { promptArea.value = setupPrompt(hostSelect.value, observedSetup); }
hostSelect.addEventListener('change', () => { localStorage.setItem('assisted-host', hostSelect.value); updatePrompt(); refreshAssisted(); });
function setupRow(title, detail, action, callback) {
  const row = document.createElement('div'); row.className = 'assisted-row';
  const content = document.createElement('div');
  const name = document.createElement('strong'); name.textContent = title;
  const text = document.createElement('p'); text.textContent = detail;
  content.append(name, text); row.append(content);
  if (action) { const button = document.createElement('button'); button.className = 'btn btn-sm'; button.textContent = action; button.onclick = callback; row.append(button); }
  return row;
}
async function refreshAssisted() {
  const button = document.getElementById('refresh-assisted'); button.disabled = true;
  try {
    observedSetup = await window.onboard.assistedStatus();
    const list = document.getElementById('assisted-status'); list.replaceChildren();
    const host = hostSelect.value;
    list.append(setupRow(host === 'claude' ? 'Claude' : 'ChatGPT', observedSetup.apps[host] ? 'Installed. Sign-in and computer use still need checking in the assistant.' : 'Not installed. Download the desktop app to continue.', observedSetup.apps[host] ? 'Open' : 'Download', () => window.onboard.assistedOpen(host)));
    if (!observedSetup.apps[host] && observedSetup.homebrewAvailable) {
      list.append(setupRow('Install with Homebrew', 'Install only your selected assistant. Builder is optional.', 'Install', async () => {
        const feedback = document.getElementById('assisted-feedback'); feedback.textContent = 'Installing your assistant… This can take a few minutes.';
        try { await window.onboard.assistedInstall(host); feedback.textContent = 'Installed. Sign in and enable computer use in your assistant.'; await refreshAssisted(); }
        catch(error) { feedback.textContent = error.message; }
      }));
    }
    list.append(setupRow('Field Theory', observedSetup.apps.fieldTheory ? 'Installed. Check account, model, and recording access below.' : 'Not installed. Download and open Field Theory.', observedSetup.apps.fieldTheory ? 'Open' : 'Download', () => window.onboard.assistedOpen('fieldTheory')));
    if (observedSetup.fieldTheory) {
      const ft = observedSetup.fieldTheory;
      const act = async action => { try { await window.onboard.assistedAction(action); await refreshAssisted(); } catch (error) { document.getElementById('assisted-feedback').textContent = error.message; } };
      list.append(setupRow('Field Theory account', ft.account.signedIn === true ? 'Signed in.' : ft.account.signedIn === false ? 'Sign in inside Field Theory. Keep verification codes out of the chat.' : 'Not checked.', 'Account', () => act('open-account')));
      const engine = ft.parakeet.engines.find(e => e.engine === ft.parakeet.activeEngine);
      list.append(setupRow('Local transcription', ft.setup.parakeetPreparing ? 'Preparing Parakeet. You can return here to check progress.' : engine?.verified ? 'Parakeet model verified. A real recording still needs testing.' : 'Parakeet needs preparation or verification.', 'Set up', () => act('prepare-parakeet')));
      list.append(setupRow('Recording access', 'Microphone: ' + (ft.permissions.microphone || 'not checked') + '. Call audio: ' + (ft.permissions.screen || 'not checked') + '. Automatic paste: ' + (ft.permissions.accessibility === true ? 'allowed' : 'not confirmed') + '.', 'Permissions', () => act('open-permissions')));
      list.append(setupRow('Recording shortcut', (ft.recording.hotkey || 'Check in Field Theory') + ' · Audio source: ' + (ft.recording.source || 'not checked') + '. Existing preferences are preserved.', 'Settings', () => act('open-transcription')));
    } else list.append(setupRow('Recording and account', observedSetup.fieldTheoryError));
    list.append(setupRow('Computer use', 'Not verified here. Your assistant must demonstrate a harmless click or typing action.'));
    updatePrompt();
  } catch (error) { document.getElementById('assisted-feedback').textContent = error.message; }
  finally { button.disabled = false; }
}
document.getElementById('refresh-assisted').onclick = refreshAssisted;
document.getElementById('continue-assistant').onclick = async () => {
  const button = document.getElementById('continue-assistant'); button.disabled = true;
  try {
    const result = await window.onboard.assistedPrompt(hostSelect.value); promptArea.value = result.prompt;
    await window.onboard.assistedOpen(hostSelect.value);
    document.getElementById('assisted-feedback').textContent = 'Prompt copied. Paste it into your assistant and send to continue.';
  } catch (error) { document.getElementById('assisted-feedback').textContent = error.message; }
  finally { button.disabled = false; }
};
document.getElementById('open-builder').onclick = () => loadConfig('bundled:builder');
updatePrompt(); refreshAssisted();
// Refresh only when the user returns from permissions or sign-in, never continuously.
window.addEventListener('focus', () => { if (!document.getElementById('assisted').hidden) refreshAssisted(); });

function showAssistedSetup() { if (orchestrating) { document.getElementById('assisted-feedback').textContent = 'Wait for the current installation to finish.'; return; } window.onboard.setupPollStop(); document.getElementById('main-content').style.display = 'none'; document.getElementById('empty-state').style.display = 'none'; document.getElementById('assisted').hidden = false; localStorage.removeItem('lastConfigPath'); refreshAssisted(); }
