// POST /api/synthesis/aggregate - Generate aggregate synthesis across interviews
// Server-side only - requires authenticated session
// Analyzes all interviews for a study to find cross-participant patterns

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getInterviewProvider } from '@/lib/providers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getStudy, getStudyInterviews, isKVAvailable } from '@/lib/kv';
import { AggregateSynthesisResult, SynthesisResult } from '@/types';

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

function hasUsableSynthesis(synthesis: SynthesisResult | null | undefined): synthesis is SynthesisResult {
  if (!synthesis) return false;

  const hasRealKeyInsights = synthesis.keyInsights?.some(
    insight => insight && !/analysis pending/i.test(insight)
  );
  const hasRealBottomLine = Boolean(
    synthesis.bottomLine &&
    !/synthesis in progress|analysis pending/i.test(synthesis.bottomLine)
  );

  return Boolean(hasRealKeyInsights || hasRealBottomLine || synthesis.themes?.length);
}

export async function POST(request: Request) {
  try {
    // Verify researcher authentication
    const auth = await verifyAuth();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    // Check storage availability
    const kvAvailable = await isKVAvailable();
    if (!kvAvailable) {
      return NextResponse.json(
        { error: 'Storage not configured. Set MONGODB_URI to enable this feature.' },
        { status: 503 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { studyId } = body as { studyId: string };

    if (!studyId) {
      return NextResponse.json(
        { error: 'Missing required field: studyId' },
        { status: 400 }
      );
    }

    // Fetch study to get config
    const study = await getStudy(studyId);
    if (!study) {
      return NextResponse.json(
        { error: 'Study not found' },
        { status: 404 }
      );
    }

    // Fetch all interviews for this study
    const interviews = await getStudyInterviews(studyId);

    if (interviews.length < 2) {
      return NextResponse.json(
        { error: 'Need at least 2 interviews to generate aggregate synthesis' },
        { status: 400 }
      );
    }

    // Extract synthesis results from interviews
    const syntheses: SynthesisResult[] = interviews
      .map((i: any) => i.synthesis)
      .filter(hasUsableSynthesis);

    if (syntheses.length < 2) {
      return NextResponse.json(
        { error: 'Need at least 2 interviews with completed analysis results. Open individual interview details first if analysis is still pending.' },
        { status: 400 }
      );
    }

    // Get the configured AI provider
    // Priority: studyConfig.aiProvider > env.AI_PROVIDER > 'gemini'
    const provider = getInterviewProvider(study.config);

    // Generate aggregate synthesis
    const aggregateResult = await provider.synthesizeAggregate(
      study.config,
      syntheses,
      interviews.length
    );

    // Build full result with metadata
    const fullResult: AggregateSynthesisResult = {
      studyId,
      interviewCount: interviews.length,
      ...aggregateResult,
      generatedAt: Date.now()
    };

    return NextResponse.json({ synthesis: fullResult });
  } catch (error) {
    console.error('Aggregate synthesis API error:', error);
    return NextResponse.json(
      { error: 'Failed to generate aggregate synthesis' },
      { status: 500 }
    );
  }
}
