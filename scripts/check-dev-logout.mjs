import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../portal/assets/dev-logout.js', import.meta.url), 'utf8');
for (const protocol of ['http:', 'https:']) {
  const document = { cookie: 'games_dev_session=existing' };
  let destination;
  vm.runInNewContext(source, { document, location: { protocol, replace(value) { destination = value; } } });
  assert.equal(document.cookie, `games_dev_session=; Path=/; SameSite=Lax; Max-Age=0${protocol === 'https:' ? '; Secure' : ''}`);
  assert.equal(destination, '/');
}
const home = await readFile(new URL('../portal/index.html', import.meta.url), 'utf8');
assert.match(home, /id="logout-link" href="\/auth\/logout" hidden/);
console.log('Logout clears development cookie on HTTP/HTTPS and returns to homepage: passed');
