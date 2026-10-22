const { test } = require('node:test');
const assert = require('node:assert/strict');
const { projectStatus } = require('./assisted-setup');
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
