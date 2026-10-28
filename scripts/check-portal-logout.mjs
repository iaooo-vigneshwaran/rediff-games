// Check the real portal handler, including the nested OIDC logout redirect.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../portal/assets/portal.js', import.meta.url), 'utf8');
const origin = 'http://localhost:8080';
const issuer = 'http://sso.localhost:9000/application/o/rediff-sso/';

async function checkLogout(discoveryAvailable) {
  let handler;
  let destination;
  const elements = new Map();
  const context = vm.createContext({
    URL,
    navigator: {},
    caches: { keys: async () => [] },
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, {
          addEventListener(event, callback) { handler = callback; },
        });
        return elements.get(id);
      },
    },
    location: { origin, assign(url) { destination = String(url); } },
    async fetch(url) {
      if (url === '/oauth2/userinfo') return { ok: false };
      if (url === '/auth/config') return {
        ok: true, json: async () => ({ issuer, clientId: 'games-web' }),
      };
      assert.equal(url, `${issuer}.well-known/openid-configuration`);
      return {
        ok: discoveryAvailable,
        json: async () => ({ issuer, end_session_endpoint: `${issuer}end-session/` }),
      };
    },
  });
  await new vm.Script(`(async () => { ${source}\n })()`).runInContext(context);
  await handler();
  const signOut = new URL(destination, origin);
  assert.equal(signOut.pathname, '/oauth2/sign_out');
  if (discoveryAvailable) {
    const redirect = signOut.searchParams.get('rd');
    // OAuth2 Proxy searches the decoded rd string for this literal placeholder.
    assert.ok(redirect.includes('id_token_hint={id_token}'));
    const endSession = new URL(redirect);
    assert.equal(endSession.origin, new URL(issuer).origin);
    assert.equal(endSession.searchParams.get('client_id'), 'games-web');
    assert.equal(endSession.searchParams.get('post_logout_redirect_uri'), `${origin}/`);
  } else {
    assert.equal(signOut.searchParams.get('rd'), '/');
  }
}

await checkLogout(true);
await checkLogout(false);
console.log('Portal OIDC logout redirect and discovery-failure fallback: passed');
