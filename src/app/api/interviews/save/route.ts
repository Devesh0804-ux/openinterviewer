// POST /api/interviews/save - Save completed interview
// Validates participant token or admin session for security
// Server-side validation ensures data integrity

import { NextResponse } from 'next/server';
import { saveInterview, isMongoStorageAvailable, incrementStudyInterviewCount, lockStudy } from '@/lib/kv';
import { verifyParticipantToken } from '@/lib/auth';
import { StoredInterview } from '@/types';

export async function POST(request: Request) {
  try {
    // Verify participant token or admin session (for researcher preview)
    const auth = await verifyParticipantToken(request);
    if (!auth.valid) {
      return NextResponse.json(
        { error: 'Valid participant token or admin session required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const clientData = body as Partial<StoredInterview>;
    // Fix studyId if frontend sends _id
    if (!clientData.studyId && (clientData as any)._id) {
      clientData.studyId = String((clientData as any)._id);
    }

    // Ensure interview ID exists (server-side safety)
    if (!clientData.id) {
      clientData.id = crypto.randomUUID();
    }

    // Validate studyId matches the token's studyId (skip for admin sessions)
    if (!auth.isAdmin && auth.studyId && clientData.studyId && auth.studyId !== clientData.studyId) {
      return NextResponse.json(
        { error: 'Study ID mismatch - token is for a different study' },
        { status: 403 }
      );
    }

    // allow transcript OR messages OR history
    const transcript =
      clientData.transcript ||
      clientData.messages ||
      clientData.history;

    if (!clientData.id || !clientData.studyId || !transcript) {
      return NextResponse.json(
        { error: 'Missing required fields: id, studyId, transcript/messages/history' },
        { status: 400 }
      );
    }

    // Validate transcript is a non-empty array
    if (!Array.isArray(transcript) || transcript.length === 0) {
      return NextResponse.json(
        { error: 'Invalid transcript: must be a non-empty array' },
        { status: 400 }
      );
    }

    // Validate studyId format (alphanumeric with hyphens)
    if (!/^[a-zA-Z0-9-]+$/.test(clientData.studyId)) {
      return NextResponse.json(
        { error: 'Invalid studyId format' },
        { status: 400 }
      );
    }

    // Validate id format
    if (!/^[a-zA-Z0-9-]+$/.test(clientData.id)) {
      return NextResponse.json(
        { error: 'Invalid interview id format' },
        { status: 400 }
      );
    }

    // Build the interview with server-controlled fields
    const now = Date.now();
    const defaultProfile = {
      id: clientData.id,
      fields: [],
      rawContext: '',
      timestamp: now
    };
    const interview: StoredInterview = {
      id: clientData.id,
      studyId: clientData.studyId,
      studyName: clientData.studyName || 'Unknown Study',
      participantProfile: clientData.participantProfile || defaultProfile,
      transcript,
      synthesis: clientData.synthesis || null,
      behaviorData: clientData.behaviorData || {
        timePerTopic: {},
        messagesPerTopic: {},
        topicsExplored: [],
        contradictions: []
      },
      createdAt: clientData.createdAt && clientData.createdAt < now
        ? clientData.createdAt
        : now,
      completedAt: now,
      status: 'completed'
    };

    const storageAvailable = await isMongoStorageAvailable();
    if (!storageAvailable) {
      return NextResponse.json(
        { error: 'MongoDB is not connected. Fix MONGODB_URI before saving interviews.' },
        { status: 503 }
      );
    }

    const saved = await saveInterview(interview);
    if (!saved) {
      return NextResponse.json(
        { error: 'Failed to save interview' },
        { status: 500 }
      );
    }

    try {
      await incrementStudyInterviewCount(interview.studyId);
      await lockStudy(interview.studyId);
    } catch (studyUpdateError) {
      console.warn('Failed to update study metadata:', studyUpdateError);
    }

    return NextResponse.json({
      success: true,
      id: interview.id
    });

  } catch (error) {
    console.error('Save interview API error:', error);
    return NextResponse.json(
      { error: 'Failed to save interview' },
      { status: 500 }
    );
  }
}
