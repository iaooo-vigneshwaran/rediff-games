import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp, fixtures, selectCookies } from '../app.js';

const env = { NODE_ENV: 'test', AUTH_MODE: 'stub' };

test('stub requires explicit non-production configuration', () => {
  assert.throws(() => buildApp({ env: {} }));
  assert.throws(() => buildApp({ env: { AUTH_MODE: 'stub', NODE_ENV: 'production' } }));
  assert.throws(() => buildApp({ env: { AUTH_MODE: 'rediff' } }));
});

test('cookie allowlist preserves values and rejects duplicates or missing credentials', () => {
  assert.deepEqual({ ...selectCookies('other=secret; Rm=abc%3D; Rsc=xyz==', ['Rm', 'Rsc']) }, { Rm: 'abc%3D', Rsc: 'xyz==' });
  assert.equal(selectCookies('Rm=a; Rm=b', ['Rm']), null);
  assert.equal(selectCookies('Rm=a', ['Rm', 'Rsc']), null);
});

test('session endpoint handles valid, missing, invalid, expired and unavailable sessions', async t => {
  const app = buildApp({ env });
  t.after(() => app.close());
  for (const [token, status] of [[null, 401], ['forged', 401], [fixtures.expired, 401], [fixtures.unavailable, 503], [fixtures.alice, 200], [fixtures.bob, 200], [fixtures.user1, 200], [fixtures.user2, 200], [fixtures.user3, 200]]) {
    const response = await app.inject({ url: '/api/auth/session', headers: token ? { cookie: `games_dev_session=${token}; unrelated=private` } : {} });
    assert.equal(response.statusCode, status);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.ok(!response.body.includes('private'));
    if (status === 200) {
      const username = ['alice', 'bob', 'user1', 'user2', 'user3'].find(name => fixtures[name] === token);
      assert.deepEqual(response.json().user, {
        id: `demo-${username}`,
        name: username === 'alice' ? 'Alice' : username === 'bob' ? 'Bob' : username,
      });
    }
    if (status === 401) assert.deepEqual(response.json(), { authenticated: false, user: null });
  }
});

test('adapter receives only selected cookies and only normalized identity leaves backend', async t => {
  let received;
  const app = buildApp({ env: { AUTH_MODE: 'rediff', AUTH_COOKIE_NAMES: 'Rm,Rsc' }, validator: async cookies => {
    received = cookies;
    return { id: '123', name: 'Verified name', secret: 'upstream-secret' };
  } });
  t.after(() => app.close());
  const response = await app.inject({ url: '/api/auth/session', headers: { cookie: 'Rm=opaque%3D; Rsc=other; Rlo=Untrusted; analytics=ignored' } });
  assert.deepEqual({ ...received }, { Rm: 'opaque%3D', Rsc: 'other' });
  assert.deepEqual(response.json(), { authenticated: true, user: { id: '123', name: 'Verified name' } });
});

test('bad upstream identity is treated as outage, not valid login', async t => {
  const app = buildApp({ env, validator: async () => ({ name: 'Unverified' }) });
  t.after(() => app.close());
  const response = await app.inject({ url: '/api/auth/session', headers: { cookie: 'games_dev_session=x' } });
  assert.equal(response.statusCode, 503);
});
