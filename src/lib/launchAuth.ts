import * as jose from 'jose';

type UnknownRecord = Record<string, unknown>;

let cachedIssuer: string | null = null;
let cachedJwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

function getConfiguredValue(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }

  return undefined;
}

function getLaunchSecrets() {
  return [
    process.env.BHARATTECH_LAUNCH_SECRET,
    process.env.ADMIN_SECRET,
    process.env.SESSION_SECRET,
    process.env.ADMIN_PASSWORD
  ].filter((value): value is string => Boolean(value));
}

function getKeycloakIssuer() {
  const rawUrl = getConfiguredValue(
    'KEYCLOAK_URL',
    'NEXT_PUBLIC_KEYCLOAK_URL',
    'VITE_KEYCLOAK_URL'
  ) || 'https://keycloak-24-0-5-9yaq.onrender.com';
  const realm = getConfiguredValue(
    'KEYCLOAK_REALM',
    'NEXT_PUBLIC_KEYCLOAK_REALM',
    'VITE_KEYCLOAK_REALM'
  ) || 'bharattech';
  const baseUrl = rawUrl.replace(/\/+$/, '');

  if (baseUrl.includes('/realms/')) {
    return baseUrl;
  }

  return `${baseUrl}/realms/${realm}`;
}

function getKeycloakJwks() {
  const issuer = getKeycloakIssuer();

  if (cachedIssuer !== issuer || !cachedJwks) {
    cachedIssuer = issuer;
    cachedJwks = jose.createRemoteJWKSet(
      new URL(`${issuer}/protocol/openid-connect/certs`)
    );
  }

  return { issuer, jwks: cachedJwks };
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? value as UnknownRecord : {};
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(item => asStringArray(item));
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeRole(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^role[\s:_-]+/, '')
    .replace(/[\s_-]+/g, '');
}

function isAdminRole(value: string) {
  const normalized = normalizeRole(value);
  return normalized === 'admin' || normalized === 'superadmin';
}

function collectRoles(payload: jose.JWTPayload) {
  const claims = payload as UnknownRecord;
  const user = asRecord(claims.user);
  const realmAccess = asRecord(claims.realm_access);
  const resourceAccess = asRecord(claims.resource_access);
  const roles = new Set<string>();

  [
    claims.role,
    claims.userRole,
    claims.authority,
    claims.authorities,
    claims.roles,
    claims.groups,
    user.role,
    user.userRole,
    user.roles,
    user.groups,
    realmAccess.roles
  ].forEach(value => {
    asStringArray(value).forEach(role => roles.add(role));
  });

  Object.values(resourceAccess).forEach(clientAccess => {
    asStringArray(asRecord(clientAccess).roles).forEach(role => roles.add(role));
  });

  return Array.from(roles);
}

export function hasAdminRole(payload: jose.JWTPayload) {
  const claims = payload as UnknownRecord;
  const user = asRecord(claims.user);
  const tokenType = String(claims.type || '').toLowerCase();
  const roles = collectRoles(payload);

  return tokenType === 'bharattech-admin-launch' ||
    tokenType === 'openinterviewer-launch' ||
    claims.isAdmin === true ||
    claims.isSuperAdmin === true ||
    user.isAdmin === true ||
    user.isSuperAdmin === true ||
    roles.some(role => {
      if (isAdminRole(role)) return true;

      return role
        .split('/')
        .filter(Boolean)
        .some(segment => isAdminRole(segment));
    });
}

async function verifySharedSecretToken(token: string) {
  for (const secret of getLaunchSecrets()) {
    try {
      const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(secret));
      if (hasAdminRole(payload)) {
        return true;
      }
    } catch {
      // Try the next configured secret.
    }
  }

  return false;
}

async function verifyKeycloakToken(token: string) {
  try {
    const { issuer, jwks } = getKeycloakJwks();
    const { payload } = await jose.jwtVerify(token, jwks, { issuer });
    return hasAdminRole(payload);
  } catch {
    return false;
  }
}

export async function verifyLaunchToken(token: string) {
  const cleanToken = token.trim();
  if (!cleanToken) return false;

  if (await verifySharedSecretToken(cleanToken)) {
    return true;
  }

  return verifyKeycloakToken(cleanToken);
}
