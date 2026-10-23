const { test } = require('node:test');
const assert = require('node:assert/strict');
const { projectStatus, register } = require('./assisted-setup');
const { setupPrompt } = require('./setup-prompt');
test('local readiness report excludes account credentials, transcript content and model errors', () => {
  const snapshot = projectStatus({ account: { signedIn: true, email: 'private@example.test', token: 'secret' }, transcript: 'private call', parakeet: { engines: [{ engine: 'parakeet', verified: false, lastError: 'private path or token' }] } });
  assert.equal(snapshot.account.signedIn, true);
  assert.equal(snapshot.parakeet.engines[0].hasError, true);
  const prompt = setupPrompt('claude', snapshot);
  for (const secret of ['private@example.test', 'private call', 'private path or token', '"token"']) assert.ok(!prompt.includes(secret));
});
test('missing readiness stays unknown rather than being reported as ready', () => {
  const snapshot = projectStatus({});
  assert.equal(snapshot.account.signedIn, null);
  assert.equal(snapshot.permissions.accessibility, null);
  assert.equal(snapshot.parakeet.runtimeInstalled, null);
  assert.deepEqual(snapshot.parakeet.engines, []);
});
test('setup prompt waits for clipboard completion and reports clipboard failures', async (t) => {
  t.mock.method(require('fs').promises, 'readFile', async () => { throw new Error('No helper in this test'); });
  const handlers = new Map();
  let completeCopy;
  const copied = new Promise((resolve) => { completeCopy = resolve; });
  const clipboard = { writeText: () => copied };
  register({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, clipboard });
  let completed = false;
  const result = handlers.get('assisted:prompt')(null, 'claude').then((value) => { completed = true; return value; });
  await new Promise(setImmediate);
  assert.equal(completed, false);
  completeCopy();
  assert.match((await result).prompt, /Claude/i);
  clipboard.writeText = async () => { throw new Error('Clipboard unavailable'); };
  await assert.rejects(handlers.get('assisted:prompt')(null, 'claude'), /Clipboard unavailable/);
});
