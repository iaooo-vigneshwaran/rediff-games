import Fastify from 'fastify';

export const fixtures = Object.freeze({
  alice: Buffer.from('games-local:alice:v1').toString('base64url'),
  bob: Buffer.from('games-local:bob:v1').toString('base64url'),
  user1: Buffer.from('games-local:user1:v1').toString('base64url'),
  user2: Buffer.from('games-local:user2:v1').toString('base64url'),
  user3: Buffer.from('games-local:user3:v1').toString('base64url'),
  expired: Buffer.from('games-local:expired:v1').toString('base64url'),
  unavailable: Buffer.from('games-local:unavailable:v1').toString('base64url'),
});

// Replace this adapter once Rediff supplies its request and response contract.
export async function stubValidator(cookies) {
  const token = cookies.games_dev_session;
  if (token === fixtures.unavailable) throw new Error('Simulated validator outage');
  for (const name of ['alice', 'bob', 'user1', 'user2', 'user3']) {
    if (token === fixtures[name]) return { id: `demo-${name}`, name: name === 'alice' ? 'Alice' : name === 'bob' ? 'Bob' : name };
  }
  return null;
}

export function selectCookies(header = '', names) {
  const selected = Object.create(null);
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (!names.includes(name)) continue;
    // Reject ambiguous duplicate credentials; preserve values without decoding.
    if (Object.hasOwn(selected, name)) return null;
    selected[name] = part.slice(separator + 1).trim();
  }
  return names.every(name => selected[name]) ? selected : null;
}

export function buildApp({ env = process.env, validator } = {}) {
  const stub = env.AUTH_MODE === 'stub';
  if (stub && env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
    throw new Error('Stub authentication requires NODE_ENV=development or test');
  }
  if (!stub && env.AUTH_MODE !== 'rediff') throw new Error('Set AUTH_MODE to stub or rediff');
  if (!stub && !validator) throw new Error('Rediff validation API contract has not been configured');
  const names = (env.AUTH_COOKIE_NAMES || (stub ? 'games_dev_session' : '')).split(',').map(s => s.trim()).filter(Boolean);
  if (!names.length || (stub && names.join(',') !== 'games_dev_session')) throw new Error('Invalid authentication cookie configuration');
  const validate = validator || stubValidator;
  const app = Fastify({ logger: false, bodyLimit: 1024 });
  app.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });
  app.get('/api/auth/session', async (request, reply) => {
    const cookies = selectCookies(request.headers.cookie, names);
    if (!cookies) return reply.code(401).send({ authenticated: false, user: null });
    try {
      const user = await validate(cookies);
      if (!user) return reply.code(401).send({ authenticated: false, user: null });
      if (typeof user.id !== 'string' || typeof user.name !== 'string' || !user.id || !user.name) throw new Error('Invalid identity');
      return { authenticated: true, user: { id: user.id, name: user.name } };
    } catch {
      return reply.code(503).send({ error: 'Authentication service temporarily unavailable' });
    }
  });
  return app;
}
