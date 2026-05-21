// POST /api/synthesis/aggregate - Generate aggregate synthesis across interviews
// Server-side only - requires authenticated session
// Analyzes all interviews for a study to find cross-participant patterns

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getInterviewProvider } from '@/lib/providers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getStudy, getStudyInterviews, isKVAvailable, saveInterview } from '@/lib/kv';
import { AggregateSynthesisResult, StoredInterview, SynthesisResult } from '@/types';

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

function getTranscript(interview: StoredInterview) {
  return Array.isArray(interview.transcript) && interview.transcript.length
    ? interview.transcript
    : Array.isArray(interview.messages) && interview.messages.length
      ? interview.messages
      : Array.isArray(interview.history)
        ? interview.history
        : [];
}

function getProfileValue(interview: StoredInterview, fieldName: string) {
  const field = interview.participantProfile?.fields?.find((item: any) => {
    const key = `${item?.fieldId || item?.id || item?.label || ''}`.toLowerCase();
    return key.includes(fieldName) && item?.value;
  });

  return typeof field?.value === 'string' ? field.value.trim() : null;
}

function getParticipantName(interview: StoredInterview, fallbackIndex: number) {
  return interview.participantName ||
    getProfileValue(interview, 'name') ||
    `Participant ${fallbackIndex + 1}`;
}

function countMatches(text: string, patterns: RegExp[]) {
  return patterns.reduce((count, pattern) => count + (text.match(pattern)?.length || 0), 0);
}

function buildParticipantComparison(interviews: StoredInterview[]): AggregateSynthesisResult['participantComparisons'] {
  const scoredParticipants = interviews.map((interview, index) => {
    const transcript = getTranscript(interview);
    const userMessages = transcript.filter((message: any) => message.role === 'user');
    const answerText = userMessages.map((message: any) => String(message.content || '')).join(' ');
    const words = answerText.split(/\s+/).filter(Boolean);
    const averageAnswerLength = userMessages.length ? words.length / userMessages.length : 0;
    const concreteExampleCount = countMatches(answerText, [
      /\bproject\b/gi,
      /\bexample\b/gi,
      /\brecently\b/gi,
      /\bbuilt\b/gi,
      /\bused\b/gi,
      /\bworked\b/gi,
      /\bdeployed\b/gi,
      /\bdebug\b/gi,
      /\bpython\b/gi,
      /\bmern\b/gi,
      /\bapi\b/gi,
      /\buser\b/gi
    ]);
    const reflectionCount = countMatches(answerText, [
      /\bbecause\b/gi,
      /\bhowever\b/gi,
      /\bchallenge\b/gi,
      /\bprefer\b/gi,
      /\blearn\b/gi,
      /\bvalidate\b/gi,
      /\bunderstand\b/gi,
      /\bdecision\b/gi
    ]);
    const synthesisStrength = [
      ...(interview.synthesis?.keyInsights || []),
      ...(interview.synthesis?.themes || []).map(theme => theme.theme),
      interview.synthesis?.bottomLine || ''
    ].join(' ').length;

    const score = Math.min(100, Math.round(
      Math.min(words.length, 500) * 0.08 +
      Math.min(averageAnswerLength, 120) * 0.2 +
      Math.min(concreteExampleCount, 12) * 4 +
      Math.min(reflectionCount, 12) * 3 +
      Math.min(synthesisStrength / 40, 15)
    ));

    const strengths: string[] = [];
    const gaps: string[] = [];

    if (words.length >= 120) {
      strengths.push('Gave detailed responses with enough material for analysis.');
    } else {
      gaps.push('Responses were brief, giving less evidence for comparison.');
    }

    if (concreteExampleCount >= 3) {
      strengths.push('Used concrete examples, tools, or project references.');
    } else {
      gaps.push('Could have improved by giving more concrete examples.');
    }

    if (reflectionCount >= 2) {
      strengths.push('Explained reasoning, tradeoffs, or challenges behind their answers.');
    } else {
      gaps.push('Could have added more reflection on why choices or challenges mattered.');
    }

    if ((interview.synthesis?.themes?.length || 0) >= 2) {
      strengths.push('Produced multiple analyzable themes.');
    }

    return {
      participantName: getParticipantName(interview, index),
      rank: 0,
      score,
      strengths: strengths.length ? strengths : ['Completed the interview and provided usable responses.'],
      gaps: gaps.length ? gaps : ['No major response-quality gaps were detected.'],
      summary: ''
    };
  });

  return scoredParticipants
    .sort((a, b) => b.score - a.score)
    .map((participant, index, participants) => {
      const leader = index === 0 && participants.length > 1;
      const summary = leader
        ? `${participant.participantName} provided the strongest interview evidence because their answers were more detailed, specific, and easier to connect to the research question.`
        : `${participant.participantName} contributed useful data, but their evidence was comparatively ${participant.score < 50 ? 'lighter and would benefit from more detail' : 'less rich than the top-ranked response'}.`;

      return {
        ...participant,
        rank: index + 1,
        summary
      };
    });
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

    // Get the configured AI provider
    // Priority: studyConfig.aiProvider > env.AI_PROVIDER > 'gemini'
    const provider = getInterviewProvider(study.config);

    // Generate or repair missing per-interview analyses before aggregating.
    const analyzedInterviews = await Promise.all(
      interviews.map(async (interview) => {
        if (hasUsableSynthesis(interview.synthesis)) return interview;

        const transcript = getTranscript(interview);
        if (!transcript.length) return interview;

        const synthesis = await provider.synthesizeInterview(
          transcript,
          study.config,
          interview.behaviorData || {
            timePerTopic: {},
            messagesPerTopic: {},
            topicsExplored: [],
            contradictions: []
          },
          interview.participantProfile || null
        );

        const repairedInterview = {
          ...interview,
          transcript,
          messages: Array.isArray(interview.messages) && interview.messages.length
            ? interview.messages
            : transcript,
          history: Array.isArray(interview.history) && interview.history.length
            ? interview.history
            : transcript,
          synthesis
        };

        await saveInterview(repairedInterview);
        return repairedInterview;
      })
    );

    // Extract synthesis results from all analyzed interviews.
    const syntheses: SynthesisResult[] = analyzedInterviews
      .map((i: any) => i.synthesis)
      .filter(hasUsableSynthesis);

    if (syntheses.length < 2) {
      return NextResponse.json(
        { error: 'Need at least 2 interviews with completed analysis results. Open individual interview details first if analysis is still pending.' },
        { status: 400 }
      );
    }

    // Generate aggregate synthesis
    const aggregateResult = await provider.synthesizeAggregate(
      study.config,
      syntheses,
      interviews.length
    );
    const participantComparisons = buildParticipantComparison(analyzedInterviews);
    const topParticipantSummary = participantComparisons?.length
      ? `${participantComparisons[0].participantName} performed best in terms of interview response quality, with a score of ${participantComparisons[0].score}/100. ${participantComparisons[0].strengths[0]}`
      : undefined;

    // Build full result with metadata
    const fullResult: AggregateSynthesisResult = {
      studyId,
      interviewCount: interviews.length,
      ...aggregateResult,
      participantComparisons,
      topParticipantSummary,
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
