// Clear only the host-scoped development cookie created by /auth/login.
// Real Rediff logout will replace this page once its contract is available.
document.cookie = `games_dev_session=; Path=/; SameSite=Lax; Max-Age=0${location.protocol === 'https:' ? '; Secure' : ''}`;
location.replace('/');
