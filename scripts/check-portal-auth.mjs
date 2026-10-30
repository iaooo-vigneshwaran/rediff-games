import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../portal/assets/portal.js', import.meta.url), 'utf8');
for (const status of [200, 401, 503, 'network']) {
  const name = { textContent: 'Checking login…' };
  const login = { hidden: true };
  const logout = { hidden: true };
  const context = vm.createContext({
    document: { getElementById: id => id === 'account-name' ? name : id === 'login-link' ? login : logout },
    fetch: async (url, options) => {
      assert.equal(url, '/api/auth/session');
      assert.equal(options.credentials, 'same-origin');
      if (status === 'network') throw new Error('offline');
      return { status, ok: status === 200, json: async () => ({ authenticated: true, user: { name: '<Verified Alice>' } }) };
    },
  });
  await new vm.Script(`(async () => { ${source}\n })()`).runInContext(context);
  assert.equal(login.hidden, status !== 401);
  assert.equal(logout.hidden, status !== 200);
  if (status === 200) assert.equal(name.textContent, '<Verified Alice>');
  else if (status === 401) assert.equal(name.textContent, '');
  else assert.match(name.textContent, /Unable to verify/);
}
console.log('Portal authenticated, anonymous, outage and network states: passed');
