// POST /api/auth/launch - Exchange a BharatTech LMS launch token for an admin session.

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import * as jose from 'jose';
import {
  createSessionToken,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME
} from '@/lib/auth';

function getLaunchSecrets() {
  return [
    process.env.BHARATTECH_LAUNCH_SECRET,
    process.env.ADMIN_SECRET,
    process.env.SESSION_SECRET,
    process.env.ADMIN_PASSWORD
  ].filter((value): value is string => Boolean(value));
}

function hasAdminRole(payload: jose.JWTPayload) {
  const nestedUser = payload.user && typeof payload.user === 'object'
    ? payload.user as Record<string, unknown>
    : {};
  const role = String(payload.role || payload.userRole || nestedUser.role || '').toLowerCase();
  const roles = Array.isArray(payload.roles)
    ? payload.roles.map(item => String(item).toLowerCase())
    : Array.isArray(nestedUser.roles)
      ? nestedUser.roles.map(item => String(item).toLowerCase())
      : [];

  return payload.type === 'bharattech-admin-launch' ||
    payload.type === 'openinterviewer-launch' ||
    payload.isAdmin === true ||
    payload.isSuperAdmin === true ||
    nestedUser.isAdmin === true ||
    nestedUser.isSuperAdmin === true ||
    role === 'admin' ||
    role === 'superadmin' ||
    roles.includes('admin') ||
    roles.includes('superadmin');
}

async function verifyLaunchToken(token: string) {
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

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body.launchToken === 'string'
      ? body.launchToken.trim()
      : typeof body.bt_token === 'string'
        ? body.bt_token.trim()
        : '';

    if (!token) {
      return NextResponse.json(
        { error: 'Launch token is required' },
        { status: 400 }
      );
    }

    const isValid = await verifyLaunchToken(token);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid or unauthorized launch token' },
        { status: 401 }
      );
    }

    const sessionToken = await createSessionToken();
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions());

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Launch auth error:', error);
    return NextResponse.json(
      { error: 'Failed to authenticate launch token' },
      { status: 500 }
    );
  }
}
