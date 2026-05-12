// POST /api/demo/seed - Seed demo data to storage
// Protected: Requires authenticated admin session

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';
import { deleteInterview, deleteStudy, saveStudy, saveInterview, isKVAvailable, getAllStudies } from '@/lib/kv';
import { DEMO_STUDIES, DEMO_INTERVIEWS, DEMO_AGGREGATE_SYNTHESIS } from '@/lib/demoData';

// Verify admin session
async function verifyAuth() {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (!authCookie?.value) {
    return { authorized: false, error: 'Unauthorized' };
  }

  const isValid = await verifySessionToken(authCookie.value);
  if (!isValid) {
    return { authorized: false, error: 'Session expired or invalid' };
  }

  return { authorized: true };
}

export async function POST() {
  try {
    // Check authentication
    const auth = await verifyAuth();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    // Check storage availability
    const kvAvailable = await isKVAvailable();
    if (!kvAvailable) {
      return NextResponse.json(
        { error: 'Storage not configured. Please set MONGODB_URI first.' },
        { status: 503 }
      );
    }

    // Check if demo data already exists
    const existingStudies = await getAllStudies();
    const demoExists = existingStudies.some(s => s.id.startsWith('demo-'));
    if (demoExists) {
      return NextResponse.json(
        { error: 'Demo data already loaded. Clear it first if you want to reload.' },
        { status: 409 }
      );
    }

    // Seed studies
    let studiesSeeded = 0;
    for (const study of DEMO_STUDIES) {
      const success = await saveStudy(study);
      if (success) studiesSeeded++;
    }

    // Seed interviews
    let interviewsSeeded = 0;
    for (const interview of DEMO_INTERVIEWS) {
      const success = await saveInterview(interview);
      if (success) interviewsSeeded++;
    }

    return NextResponse.json({
      success: true,
      message: 'Demo data loaded successfully',
      data: {
        studiesSeeded,
        interviewsSeeded,
        aggregateSynthesisAvailable: true
      }
    });
  } catch (error) {
    console.error('Demo seed error:', error);
    return NextResponse.json(
      { error: 'Failed to seed demo data' },
      { status: 500 }
    );
  }
}

// DELETE /api/demo/seed - Clear demo data from storage
export async function DELETE() {
  try {
    // Check authentication
    const auth = await verifyAuth();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    // Check storage availability
    const kvAvailable = await isKVAvailable();
    if (!kvAvailable) {
      return NextResponse.json(
        { error: 'Storage not configured.' },
        { status: 503 }
      );
    }

    // Delete demo studies
    let studiesDeleted = 0;
    let interviewsDeleted = 0;
    for (const interview of DEMO_INTERVIEWS) {
      if (await deleteInterview(interview.id, interview.studyId)) {
        interviewsDeleted++;
      }
    }

    for (const study of DEMO_STUDIES) {
      const result = await deleteStudy(study.id);
      if (result.success) {
        studiesDeleted++;
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Demo data cleared',
      data: {
        studiesDeleted,
        interviewsDeleted
      }
    });
  } catch (error) {
    console.error('Demo clear error:', error);
    return NextResponse.json(
      { error: 'Failed to clear demo data' },
      { status: 500 }
    );
  }
}
