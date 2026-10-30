// Public development fixtures only. Real Rediff login will replace this page.
const users = [
  { username: 'alice', password: 'test', token: 'games-local:alice:v1' },
  { username: 'bob', password: 'test', token: 'games-local:bob:v1' },
  { username: 'user1', password: 'test', token: 'games-local:user1:v1' },
  { username: 'user2', password: 'test', token: 'games-local:user2:v1' },
  { username: 'user3', password: 'test', token: 'games-local:user3:v1' },
];
const form = document.getElementById('login-form');
const error = document.getElementById('login-error');

function returnDestination() {
  // NGINX appends the original URI verbatim; retain its complete query string.
  const raw = location.search.startsWith('?return=') ? location.search.slice(8) : '/';
  try {
    const destination = new URL(raw, location.origin);
    const safe = destination.origin === location.origin && /^\/(?:$|(?:chess|checkers|backgammon|solitaire|sudoku)\/)/.test(destination.pathname);
    return safe ? destination.href : '/';
  } catch {
    return '/';
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const username = form.elements.username.value.trim();
  const password = form.elements.password.value;
  const user = users.find(candidate => candidate.username === username && candidate.password === password);
  if (!user) {
    error.textContent = 'Incorrect username or password.';
    error.hidden = false;
    return;
  }
  error.hidden = true;
  const value = btoa(user.token).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  document.cookie = `games_dev_session=${value}; Path=/; SameSite=Lax; Max-Age=3600${location.protocol === 'https:' ? '; Secure' : ''}`;
  location.assign(returnDestination());
});
// Keep submission disabled until the handler is attached to avoid posting passwords.
form.querySelector('button[type="submit"]').disabled = false;
