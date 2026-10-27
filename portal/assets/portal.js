const name = document.getElementById('account-name');
const login = document.getElementById('login-link');
const logout = document.getElementById('logout-button');

async function clearOldSolitaireCache() {
  try {
    const registration = await navigator.serviceWorker?.getRegistration('/solitaire/');
    await registration?.unregister();
    const keys = await caches?.keys();
    await Promise.all(keys.filter((key) => key.startsWith('solitaire-')).map((key) => caches.delete(key)));
  } catch {
    // A blocked cache API must not prevent logout.
  }
}

try {
  const response = await fetch('/oauth2/userinfo', { credentials: 'same-origin', cache: 'no-store' });
  if (response.ok) {
    const user = await response.json();
    name.textContent = user.preferredUsername || user.email || 'Signed in';
    login.hidden = true;
    logout.hidden = false;
  }
} catch {
  // The portal stays usable if the session service is unavailable.
}

logout.addEventListener('click', async () => {
  logout.disabled = true;
  await clearOldSolitaireCache();

  try {
    const response = await fetch('/auth/config', { cache: 'no-store' });
    if (!response.ok) throw new Error('Authentication configuration is unavailable.');
    const { issuer, clientId } = await response.json();
    const identityLogout = new URL(`${issuer}/protocol/openid-connect/logout`);
    identityLogout.searchParams.set('client_id', clientId);
    identityLogout.searchParams.set('post_logout_redirect_uri', `${location.origin}/`);
    const appLogout = new URL('/oauth2/sign_out', location.origin);
    appLogout.searchParams.set('rd', identityLogout.toString());
    location.assign(appLogout.toString());
  } catch {
    location.assign('/oauth2/sign_out?rd=/');
  }
});
