// GET /api/interviews/[id]

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getInterview, getStudy, saveInterview } from '@/lib/kv';
import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getInterviewProvider } from '@/lib/providers';
import { StoredInterview, StudyConfig, SynthesisResult } from '@/types';

function hasUsableSynthesis(synthesis: SynthesisResult | null | undefined) {
  if (!synthesis) return false;

  const hasRealText = [
    synthesis.bottomLine,
    ...(synthesis.keyInsights || []),
    ...(synthesis.statedPreferences || []),
    ...(synthesis.revealedPreferences || []),
    ...(synthesis.themes || []).map(theme => `${theme.theme} ${theme.evidence}`)
  ].some(value => value && !/analysis pending|synthesis in progress|no .* extracted yet/i.test(value));

  return hasRealText;
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

async function getStudyConfig(interview: StoredInterview): Promise<StudyConfig> {
  const study = await getStudy(interview.studyId);
  if (study?.config) return study.config;

  return {
    id: interview.studyId,
    name: interview.studyName || 'Interview Study',
    description: '',
    researchQuestion: interview.studyName || 'Understand participant experience',
    coreQuestions: [],
    topicAreas: [],
    profileSchema: [],
    aiBehavior: 'standard',
    consentText: '',
    createdAt: interview.createdAt || Date.now()
  };
}

async function ensureInterviewAnalysis(interview: StoredInterview) {
  if (hasUsableSynthesis(interview.synthesis)) return interview;

  const transcript = getTranscript(interview);
  if (!transcript.length) return interview;

  try {
    const studyConfig = await getStudyConfig(interview);
    const provider = getInterviewProvider(studyConfig);
    const synthesis = await provider.synthesizeInterview(
      transcript,
      studyConfig,
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
  } catch (error) {
    console.warn('Failed to repair interview synthesis:', error);
    return interview;
  }
}

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

    const repairedInterview = await ensureInterviewAnalysis(interview);

    return NextResponse.json({ interview: repairedInterview });
  } catch (error) {
    console.error('Get interview API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch interview' },
      { status: 500 }
    );
  }
}
