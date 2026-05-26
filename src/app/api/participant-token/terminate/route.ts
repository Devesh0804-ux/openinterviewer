export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import {
  getParticipantToken,
  incrementStudyInterviewCount,
  lockStudy,
  saveInterview,
  terminateParticipantToken
} from '@/lib/kv';
import { InterviewMessage, StoredInterview } from '@/types';

function normalizeHistory(value: unknown): InterviewMessage[] {
  return Array.isArray(value) ? value as InterviewMessage[] : [];
}

function getParticipantName(history: InterviewMessage[], participantProfile: any) {
  const nameField = participantProfile?.fields?.find(
    (field: any) => field.fieldId === 'name' && typeof field.value === 'string' && field.value.trim()
  );

  if (nameField?.value) {
    return nameField.value.trim();
  }

  const nameMessage = history.find((message: any, index: number) => {
    if (message.role !== 'user') return false;
    const previousMessage = history[index - 1]?.content?.toLowerCase() || '';
    return previousMessage.includes('name');
  });

  return nameMessage?.content?.trim() || 'Terminated Participant';
}

async function saveTerminatedInterview(token: string, tokenData: NonNullable<Awaited<ReturnType<typeof getParticipantToken>>>, reason: string, body: any) {
  const now = Date.now();
  const history = normalizeHistory(body.history);
  const transcript = history.length
    ? history
    : [{
        id: `termination-${now}`,
        role: 'system',
        content: reason,
        timestamp: now
      } as InterviewMessage];
  const participantProfile = body.participantProfile || {
    id: `terminated-${token}`,
    fields: [],
    rawContext: '',
    timestamp: now
  };

  const interview: StoredInterview & { token?: string; terminationReason?: string } = {
    id: `terminated-${token}`,
    token,
    studyId: tokenData.studyId,
    studyName: tokenData.studyConfig.name || 'Unknown Study',
    participantName: getParticipantName(transcript, participantProfile),
    participantProfile: {
      id: participantProfile.id || `terminated-${token}`,
      fields: Array.isArray(participantProfile.fields) ? participantProfile.fields : [],
      rawContext: participantProfile.rawContext || '',
      timestamp: participantProfile.timestamp || now
    },
    transcript,
    messages: transcript,
    history: transcript,
    synthesis: {
      statedPreferences: [],
      revealedPreferences: [],
      themes: [],
      contradictions: [],
      keyInsights: [],
      bottomLine: `Interview terminated: ${reason}`
    },
    behaviorData: body.behaviorData || {
      timePerTopic: {},
      messagesPerTopic: {},
      topicsExplored: [],
      contradictions: []
    },
    terminationReason: reason,
    createdAt: now,
    completedAt: now,
    status: 'terminated'
  };

  const saved = await saveInterview(interview);
  if (saved) {
    await incrementStudyInterviewCount(tokenData.studyId);
    await lockStudy(tokenData.studyId);
  }
}

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
      try {
        await saveTerminatedInterview(
          token,
          tokenData,
          tokenData.terminationReason || reason,
          body
        );
      } catch (interviewError) {
        console.error('Failed to save already-terminated interview:', interviewError);
      }

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

    try {
      await saveTerminatedInterview(token, tokenData, reason, body);
    } catch (interviewError) {
      console.error('Failed to save terminated interview:', interviewError);
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
