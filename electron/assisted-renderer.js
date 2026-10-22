const hostSelect = document.getElementById("assistant-host");
hostSelect.value =
  localStorage.getItem("assisted-host") === "claude" ? "claude" : "chatgpt";
const promptArea = document.getElementById("assisted-prompt");
const primary = document.getElementById("continue-assistant");
const feedback = document.getElementById("assisted-feedback");
let observedSetup = null;
let nextAction = null;
let actionRunning = false;
function updatePrompt() {
  promptArea.value = setupPrompt(hostSelect.value, observedSetup);
}
function setupRow(title, detail, action, callback) {
  const row = document.createElement("div");
  row.className = "assisted-row";
  const content = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = title;
  const text = document.createElement("p");
  text.textContent = detail;
  content.append(name, text);
  row.append(content);
  if (action) {
    const button = document.createElement("button");
    button.className = "assisted-link";
    button.textContent = action;
    button.onclick = () => perform(callback);
    row.append(button);
  }
  return row;
}
async function perform(action) {
  if (actionRunning) return;
  actionRunning = true;
  primary.disabled = true;
  hostSelect.disabled = true;
  feedback.textContent = "";
  try {
    await action();
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    actionRunning = false;
    hostSelect.disabled = false;
    await refreshAssisted();
  }
}
async function continueInAssistant() {
  const result = await window.onboard.assistedPrompt(hostSelect.value);
  promptArea.value = result.prompt;
  await window.onboard.assistedOpen(hostSelect.value);
  feedback.textContent =
    "Prompt copied. Paste it into your assistant and send.";
}
async function refreshAssisted() {
  const refresh = document.getElementById("refresh-assisted");
  refresh.disabled = true;
  try {
    observedSetup = await window.onboard.assistedStatus();
    const s = observedSetup,
      ft = s.fieldTheory,
      host = hostSelect.value;
    const hostName = host === "claude" ? "Claude" : "ChatGPT";
    const list = document.getElementById("assisted-status");
    list.replaceChildren();
    const missing = [];
    let readyCount = 0;
    const add = (name, detail, ready, label, action) => {
      list.append(setupRow(name, detail, label, action));
      if (ready) readyCount++;
    };
    const act = (action) => () => window.onboard.assistedAction(action);
    add(
      hostName,
      s.apps[host]
        ? "Installed. Computer use is checked in your assistant."
        : "Not installed.",
      s.apps[host],
      s.apps[host] ? "Open" : "Download",
      () => window.onboard.assistedOpen(host),
    );
    if (!s.apps[host])
      missing.push(
        s.homebrewAvailable
          ? [
              "Install " + hostName,
              "We’ll install your assistant using Homebrew. Your other apps stay as they are.",
              "Install " + hostName,
              async () => {
                feedback.textContent =
                  "Installing… This may take a few minutes.";
                await window.onboard.assistedInstall(host);
                feedback.textContent = "Installed.";
              },
            ]
          : [
              "Get " + hostName,
              "Download the desktop app, then return here.",
              "Download " + hostName,
              () => window.onboard.assistedOpen(host),
            ],
      );
    add(
      "Field Theory",
      s.apps.fieldTheory ? "Installed." : "Not installed.",
      s.apps.fieldTheory,
      "Open",
      () => window.onboard.assistedOpen("fieldTheory"),
    );
    if (!s.apps.fieldTheory)
      missing.push([
        "Get Field Theory",
        "Install the preview app for recording and local transcription.",
        "Download Field Theory",
        () => window.onboard.assistedOpen("fieldTheoryPreview"),
      ]);
    else if (!ft)
      missing.push([
        "Open Field Theory",
        "Open the setup preview so we can check your account and recording setup.",
        "Open Field Theory",
        () => window.onboard.assistedOpen("fieldTheory"),
      ]);
    if (!ft)
      add("Recording setup", s.fieldTheoryError, false, "Get preview", () =>
        window.onboard.assistedOpen("fieldTheoryPreview"),
      );
    if (ft) {
      add(
        "Account",
        ft.account.signedIn
          ? "Signed in."
          : "Sign in securely in Field Theory.",
        ft.account.signedIn === true,
        "Account",
        act("open-account"),
      );
      if (!ft.account.signedIn)
        missing.push([
          "Connect your account",
          "Sign in inside Field Theory. Come back here when you’re done.",
          "Sign in to Field Theory",
          act("open-account"),
        ]);
      const engine = ft.parakeet.engines.find(
        (e) => e.engine === ft.parakeet.activeEngine,
      );
      const modelReady =
        ft.parakeet.runtimeInstalled === true &&
        engine?.verified === true &&
        !engine.needsReinstall &&
        !engine.hasError;
      add(
        "Local transcription",
        modelReady
          ? "Parakeet is verified."
          : ft.setup.parakeetPreparing
            ? "Preparing Parakeet…"
            : "Parakeet needs preparation.",
        modelReady,
        "Settings",
        act("open-transcription"),
      );
      if (!modelReady)
        missing.push(
          ft.setup.parakeetPreparing
            ? [
                "Preparing transcription",
                "You can continue in your assistant while Parakeet finishes.",
                "Continue in " + hostName,
                continueInAssistant,
              ]
            : [
                "Prepare local transcription",
                "Field Theory will download and check Parakeet on this Mac.",
                "Set up transcription",
                act("prepare-parakeet"),
              ],
        );
      const permissionsReady =
        ft.permissions.microphone === "granted" &&
        ft.permissions.screen === "granted" &&
        ft.permissions.accessibility === true;
      add(
        "Recording access",
        "Microphone: " +
          (ft.permissions.microphone || "unknown") +
          " · Call audio: " +
          (ft.permissions.screen || "unknown") +
          " · Paste access: " +
          (ft.permissions.accessibility ? "allowed" : "not confirmed"),
        permissionsReady,
        "Permissions",
        act("open-permissions"),
      );
      if (!permissionsReady)
        missing.push([
          "Allow recording access",
          "Field Theory will guide you through the permissions that are missing.",
          "Review permissions",
          act("open-permissions"),
        ]);
      const sources = {
        "microphone-and-system-audio": "Your voice and the call",
        microphone: "Your microphone",
        "system-audio": "Sound from your call",
      };
      add(
        "Recording shortcut",
        (ft.recording.hotkey || "Not set") +
          " · " +
          (sources[ft.recording.source] || "Check your audio source"),
        false,
        "Settings",
        act("open-transcription"),
      );
    }
    add(
      "Final test",
      "Record a short instruction, check the transcript, then try computer use with your assistant.",
      false,
    );
    const next = missing[0] || [
      "Try it with your assistant",
      "Your local setup is in place. Paste the prompt to check recording and computer use together.",
      "Continue in " + hostName,
      continueInAssistant,
    ];
    document.getElementById("next-title").textContent = next[0];
    document.getElementById("next-description").textContent = next[1];
    primary.textContent = next[2];
    nextAction = next[3];
    primary.disabled = actionRunning;
    document.getElementById("ready-summary").textContent = readyCount
      ? "Already set up · " + readyCount + " checks"
      : "Setup details";
    updatePrompt();
  } catch (error) {
    feedback.textContent = error.message;
    primary.disabled = false;
    primary.textContent = "Try again";
    nextAction = refreshAssisted;
  } finally {
    refresh.disabled = false;
  }
}
hostSelect.onchange = () => {
  localStorage.setItem("assisted-host", hostSelect.value);
  updatePrompt();
  refreshAssisted();
};
primary.onclick = () => perform(nextAction);
document.getElementById("refresh-assisted").onclick = refreshAssisted;
document.getElementById("preview-help").onclick = (event) => {
  event.preventDefault();
  window.onboard.openExternal(
    "https://onboard-assisted-setup-afar1.vercel.app/#plugin",
  );
};
document.getElementById("open-builder").onclick = () =>
  loadConfig("bundled:builder");
updatePrompt();
refreshAssisted();
window.addEventListener("focus", () => {
  if (!document.getElementById("assisted").hidden && !actionRunning)
    refreshAssisted();
});
function showAssistedSetup() {
  if (orchestrating) return;
  window.onboard.setupPollStop();
  document.getElementById("main-content").style.display = "none";
  document.getElementById("empty-state").style.display = "none";
  document.getElementById("assisted").hidden = false;
  localStorage.removeItem("lastConfigPath");
  refreshAssisted();
}
