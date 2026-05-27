// POST /api/auth/launch - Exchange a BharatTech LMS launch token for an admin session.

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  createSessionToken,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME
} from '@/lib/auth';
import { verifyLaunchToken } from '@/lib/launchAuth';

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
