// GET /api/interviews/[id]

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getInterview } from '@/lib/kv';
import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    const authCookie = cookieStore.get(SESSION_COOKIE_NAME);

    if (!authCookie?.value) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const isValid = await verifySessionToken(authCookie.value);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Session expired or invalid' },
        { status: 401 }
      );
    }

    const { id } = params;

    if (!id) {
      return NextResponse.json(
        { error: 'Missing interview ID' },
        { status: 400 }
      );
    }

    const interview = await getInterview(params.id);

    if (!interview) {
      return NextResponse.json(
        { error: 'Not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ interview });
  } catch (error) {
    console.error('Get interview API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch interview' },
      { status: 500 }
    );
  }
}
