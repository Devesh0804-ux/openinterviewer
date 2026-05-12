import {
  InterviewMessage,
  StudyConfig,
  BehaviorData,
  ParticipantProfile,
  SynthesisResult
} from '@/types';

export async function synthesizeInterview(
  history: InterviewMessage[],
  studyConfig: StudyConfig,
  behaviorData: BehaviorData,
  participantProfile: ParticipantProfile | null,
  participantToken?: string | null
): Promise<SynthesisResult> {

  const res = await fetch('/api/synthesis', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(participantToken && {
        Authorization: `Bearer ${participantToken}`
      })
    },
    body: JSON.stringify({
      history,
      studyConfig,
      behaviorData,
      participantProfile
    })
  });

  if (!res.ok) {
    throw new Error('Synthesis failed');
  }

  return res.json();
}