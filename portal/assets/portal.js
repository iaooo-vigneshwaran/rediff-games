const name = document.getElementById('account-name');
const login = document.getElementById('login-link');
const logout = document.getElementById('logout-link');

try {
  const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 401) {
    name.textContent = '';
    login.hidden = false;
    logout.hidden = true;
  } else {
    if (!response.ok) throw new Error('Session check failed');
    const result = await response.json();
    if (!result.authenticated || typeof result.user?.name !== 'string') throw new Error('Invalid session response');
    name.textContent = result.user.name;
    login.hidden = true;
    logout.hidden = false;
  }
} catch {
  name.textContent = 'Unable to verify your login. Please try again.';
  login.hidden = true;
  logout.hidden = true;
}
