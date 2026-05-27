import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as jose from 'jose';
import { verifyLaunchToken } from '@/lib/launchAuth';

const SESSION_COOKIE_NAME = 'research-auth';

// Routes that require authentication
const protectedRoutes = ['/dashboard', '/studies'];
const SESSION_DURATION = 60 * 60 * 24 * 7; // 7 days in seconds
const LAUNCH_TOKEN_PARAM = 'bt_token';
const LEGACY_LAUNCH_TOKEN_PARAM = 'launchToken';

// Verify session token in edge middleware
async function verifySession(token: string, request: NextRequest): Promise<boolean> {
  if (!token) {
    return false;
  }

  // Use SESSION_SECRET if available, fall back to ADMIN_PASSWORD
  // This must match the secret used in src/lib/auth.ts
  const secret = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) {
    return false;
  }

  try {
    const secretKey = new TextEncoder().encode(secret);
    const { payload } = await jose.jwtVerify(token, secretKey);

    // Check that it's a session token
    if (payload.type !== 'session') {
      return false;
    }

    return true;
  } catch (error) {
    // Token invalid, expired, or tampered with
    return false;
  }
}

async function createSessionToken(): Promise<string | null> {
  const secret = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) return null;

  return new jose.SignJWT({ type: 'session' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION}s`)
    .sign(new TextEncoder().encode(secret));
}

function getSessionCookieOptions() {
  const embeddedInBharatTech = process.env.OPENINTERVIEWER_EMBEDDED === 'true';

  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || embeddedInBharatTech,
    sameSite: embeddedInBharatTech ? 'none' as const : 'lax' as const,
    maxAge: SESSION_DURATION,
    path: '/',
  };
}

async function consumeBharatTechLaunchToken(request: NextRequest) {
  const launchToken =
    request.nextUrl.searchParams.get(LAUNCH_TOKEN_PARAM) ||
    request.nextUrl.searchParams.get(LEGACY_LAUNCH_TOKEN_PARAM);
  if (!launchToken) return null;

  const isValidLaunch = await verifyLaunchToken(launchToken);
  const sessionToken = isValidLaunch ? await createSessionToken() : null;
  if (!sessionToken) return null;

  const cleanUrl = request.nextUrl.clone();
  if (cleanUrl.pathname === '/login') {
    cleanUrl.pathname = '/dashboard';
  }
  cleanUrl.searchParams.delete(LAUNCH_TOKEN_PARAM);
  cleanUrl.searchParams.delete(LEGACY_LAUNCH_TOKEN_PARAM);
  cleanUrl.searchParams.set('mode', 'admin');

  const response = NextResponse.redirect(cleanUrl);
  response.cookies.set(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions());
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const launchResponse = await consumeBharatTechLaunchToken(request);
  if (launchResponse) {
    return launchResponse;
  }

  // Check if this is a protected route
  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route));

  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  // Get auth cookie
  const authCookie = request.cookies.get(SESSION_COOKIE_NAME);

  if (!authCookie?.value) {
    // No cookie - redirect to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Verify the token is valid (not just that it exists)
  const isValid = await verifySession(authCookie.value, request);

  if (!isValid) {
    // Invalid token - clear cookie and redirect to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
