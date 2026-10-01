import assert from 'node:assert/strict';
import test from 'node:test';
import { browserTargets, createHarness } from './harness.mjs';

for (const browserName of browserTargets()) {
  test(`loads the extension against the HTTPS GCP mock in ${browserName}`, async (t) => {
    let harness;
    const errors = [];
    try {
      harness = await createHarness(browserName);
      const snapshot = await harness.snapshotConsole();
      assert.equal(snapshot.origin, 'https://console.cloud.google.com');
      assert.equal(snapshot.title, 'GCP Console mock');
      assert.equal(snapshot.topBar.exists, true);
      assert.equal(snapshot.topBar.display, 'none');
      assert.ok(
        harness.mockRequests.some(
          (request) =>
            request.scheme === 'https' && request.host === 'console.cloud.google.com' && request.method === 'CONNECT',
        ),
      );
      await harness.openNativePanel();
      assert.equal(await harness.nativePanelOpen(), true, `${browserName} native panel did not remain open`);
    } catch (error) {
      errors.push(error);
      try {
        await harness?.captureFailure(t);
      } catch (diagnosticError) {
        errors.push(diagnosticError);
      }
    } finally {
      try {
        await harness?.close();
      } catch (cleanupError) {
        errors.push(cleanupError);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Smoke test and cleanup failed');
  });
}
