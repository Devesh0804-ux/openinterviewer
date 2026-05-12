// POST /api/auth - Researcher login
// Uses signed JWT session tokens for security

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  createSessionToken,
  verifySessionToken,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME
} from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { password } = body as { password: string };

    // Validate password is provided
    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'Password is required' },
        { status: 400 }
      );
    }

    // Get the configured password
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      // SECURITY: Never allow access without ADMIN_PASSWORD configured
      console.error('ADMIN_PASSWORD not configured - authentication disabled');
      return NextResponse.json(
        { error: 'Authentication not configured. Set ADMIN_PASSWORD environment variable.' },
        { status: 500 }
      );
    }

    // Check password
    if (password !== adminPassword) {
      return NextResponse.json(
        { error: 'Invalid password' },
        { status: 401 }
      );
    }

    // Create signed session token
    const sessionToken = await createSessionToken();

    // Set auth cookie with signed token
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions());

    return NextResponse.json({ success: true });
    
  } catch (error) {
    console.error('Auth API error:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}

// GET /api/auth - Check authentication status
export async function GET() {
  try {
    const cookieStore = await cookies();
    const authCookie = cookieStore.get(SESSION_COOKIE_NAME);

    if (!authCookie?.value) {
      return NextResponse.json({ authenticated: false });
    }

    // Verify the token is valid (not just that it exists)
    const isValid = await verifySessionToken(authCookie.value);

    return NextResponse.json({ authenticated: isValid });
  } catch (error) {
    return NextResponse.json({ authenticated: false });
  }
}

// DELETE /api/auth - Logout
export async function DELETE() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE_NAME);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Logout failed' },
      { status: 500 }
    );
  }
}
