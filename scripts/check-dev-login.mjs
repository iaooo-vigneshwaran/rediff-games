import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../portal/assets/dev-login.js', import.meta.url), 'utf8');
function setup(query = '', protocol = 'http:') {
  let handler, destination;
  const error = { hidden: true, textContent: '' };
  const button = { disabled: true };
  const form = {
    elements: { username: { value: '' }, password: { value: '' } },
    addEventListener: (event, callback) => { assert.equal(event, 'submit'); handler = callback; },
    querySelector: () => button,
  };
  const document = { getElementById: id => id === 'login-form' ? form : error };
  vm.runInNewContext(source, { URL, btoa, document, location: { search: query, origin: `${protocol}//localhost`, protocol, assign: value => { destination = value; } } });
  assert.equal(button.disabled, false);
  return { form, error, document, destination: () => destination, submit(username, password) {
    form.elements.username.value = username;
    form.elements.password.value = password;
    let prevented = false;
    handler({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  } };
}
for (const [query, expected] of [
  ['?return=/chess/?invite=abc&mode=friend', 'http://localhost/chess/?invite=abc&mode=friend'],
  ['?return=//evil.example/chess/', '/'],
  ['?return=/auth/login', '/'],
  ['?return=http://[', '/'],
  ['?return=/sudoku/', 'http://localhost/sudoku/'],
  ['', 'http://localhost/'],
]) {
  const page = setup(query);
  page.submit('alice', 'test');
  assert.equal(page.destination(), expected);
  const token = Buffer.from('games-local:alice:v1').toString('base64url');
  assert.equal(page.document.cookie, `games_dev_session=${token}; Path=/; SameSite=Lax; Max-Age=3600`);
}
for (const [username, password] of [['alice', 'wrong'], ['unknown', 'test'], ['toString', 'anything'], ['bob', 'alice123']]) {
  const page = setup();
  page.submit(username, password);
  assert.equal(page.document.cookie, undefined);
  assert.equal(page.destination(), undefined);
  assert.equal(page.error.hidden, false);
  assert.match(page.error.textContent, /Incorrect/);
  // A subsequent correct entry can recover without reloading the page.
  page.submit('bob', 'test');
  assert.equal(page.error.hidden, true);
  assert.match(page.document.cookie, new RegExp(Buffer.from('games-local:bob:v1').toString('base64url')));
}
for (const username of ['alice', 'bob', 'user1', 'user2', 'user3']) {
  const page = setup();
  page.submit(username, 'test');
  const token = Buffer.from(`games-local:${username}:v1`).toString('base64url');
  assert.equal(page.document.cookie, `games_dev_session=${token}; Path=/; SameSite=Lax; Max-Age=3600`);
  assert.equal(page.destination(), 'http://localhost/');
}
const secure = setup('', 'https:');
secure.submit('alice', 'test');
assert.ok(secure.document.cookie.endsWith('; Secure'));
console.log('Login credential matching, failure recovery, cookie fixtures, HTTPS and safe return URLs: passed');
