export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getParticipantToken, terminateParticipantToken } from '@/lib/kv';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const reason = typeof body.reason === 'string'
      ? body.reason.trim()
      : 'The interview was terminated because a restricted action was detected.';

    if (!token) {
      return NextResponse.json(
        { error: 'Participant token is required' },
        { status: 400 }
      );
    }

    const tokenData = await getParticipantToken(token);
    if (!tokenData) {
      return NextResponse.json(
        { error: 'Invalid or expired participant token' },
        { status: 404 }
      );
    }

    if (tokenData.terminatedAt) {
      return NextResponse.json({
        success: true,
        alreadyTerminated: true,
        terminationReason: tokenData.terminationReason,
        terminatedAt: tokenData.terminatedAt
      });
    }

    const saved = await terminateParticipantToken(token, reason);
    if (!saved) {
      return NextResponse.json(
        { error: 'Failed to terminate participant token' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Participant termination error:', error);
    return NextResponse.json(
      { error: 'Failed to terminate participant token' },
      { status: 500 }
    );
  }
}
