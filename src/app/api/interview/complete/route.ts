import { NextResponse } from 'next/server';
import { getInterviewProvider } from '@/lib/providers';
import { incrementStudyInterviewCount, isMongoStorageAvailable, lockStudy, saveInterview } from '@/lib/kv';
import { StoredInterview } from '@/types';

export async function POST(request: Request) {
  try {
    const storageAvailable = await isMongoStorageAvailable();
    if (!storageAvailable) {
      return NextResponse.json(
        { error: 'MongoDB is not connected. Fix MONGODB_URI before completing interviews.' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { history, studyConfig, participantProfile } = body;
    const studyId = studyConfig?.id || studyConfig?._id || studyConfig?.studyId;

    if (!Array.isArray(history) || !studyConfig || !studyId) {
      return NextResponse.json(
        { error: 'Missing required data' },
        { status: 400 }
      );
    }

    let updatedProfile = participantProfile || { fields: [] };

    const nameField = updatedProfile.fields?.find(
      (field: any) => field.fieldId === 'name'
    );

    const nameMessage = history.find((message: any, index: number) => {
      if (message.role !== 'user') return false;
      const previousMessage = history[index - 1]?.content?.toLowerCase() || '';
      return previousMessage.includes('name');
    });

    const extractedName = nameMessage?.content
      ? nameMessage.content
        .trim()
        .replace(/[^a-zA-Z\s]/g, '')
        .replace(/\s+/g, ' ')
      : null;

    const participantName =
      extractedName ||
      (nameField?.value &&
      nameField.value.trim() !== '' &&
      nameField.value.trim().toLowerCase() !== 'yes'
        ? nameField.value
        : null) ||
      'Participant';

    if (extractedName) {
      updatedProfile = {
        ...updatedProfile,
        fields: [
          ...(updatedProfile.fields || []).filter((field: any) => field.fieldId !== 'name'),
          {
            fieldId: 'name',
            value: extractedName,
            status: 'extracted'
          }
        ]
      };
    }

    const now = Date.now();
    const interviewId = crypto.randomUUID();
    const behaviorData = {
      timePerTopic: {},
      messagesPerTopic: {},
      topicsExplored: [],
      contradictions: []
    };

    const baseInterview: StoredInterview = {
      _id: interviewId,
      id: interviewId,
      studyId,
      studyName: studyConfig.name || 'Unknown Study',
      participantName,
      participantProfile: {
        id: updatedProfile.id || interviewId,
        fields: updatedProfile.fields || [],
        rawContext: updatedProfile.rawContext || '',
        timestamp: updatedProfile.timestamp || now
      },
      transcript: history,
      messages: history,
      history,
      synthesis: null,
      behaviorData,
      status: 'completed',
      createdAt: now,
      completedAt: now
    };

    const saved = await saveInterview(baseInterview);
    if (!saved) {
      return NextResponse.json(
        { error: 'Failed to save interview to MongoDB' },
        { status: 500 }
      );
    }

    await incrementStudyInterviewCount(studyId);
    await lockStudy(studyId);

    try {
      const provider = getInterviewProvider(studyConfig);
      const synthesis = await provider.synthesizeInterview(
        history,
        studyConfig,
        behaviorData,
        baseInterview.participantProfile
      );

      const synthesisSaved = await saveInterview({
        ...baseInterview,
        synthesis
      });

      if (!synthesisSaved) {
        console.warn('Interview saved, but synthesis was not persisted to MongoDB');
      }
    } catch (synthesisError) {
      console.warn('Interview saved, but synthesis failed:', synthesisError);
    }

    return NextResponse.json({
      interviewId
    });
  } catch (error) {
    console.error('Complete Interview Error:', error);
    return NextResponse.json(
      { error: 'Failed to complete interview' },
      { status: 500 }
    );
  }
}
