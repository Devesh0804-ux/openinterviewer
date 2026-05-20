// POST /api/interview - Generate one clean AI interview turn.
// Server-side only - API keys never sent to client.

import { NextResponse } from 'next/server';
import { getInterviewProvider } from '@/lib/providers';
import {
  StudyConfig,
  ParticipantProfile,
  InterviewMessage,
  QuestionProgress
} from '@/types';

const MAX_MESSAGE_LENGTH = 5000;

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function cleanMessage(value: unknown) {
  return String(value || '')
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .replace(/\r/g, '')
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

function getShortAcknowledgement(message: string) {
  const firstStatement = cleanMessage(message)
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .find(line => !line.includes('?') && line.length <= 180);

  if (!firstStatement) return 'Thank you for sharing that.';

  return firstStatement
    .replace(/^[-*\d.)\s]+/, '')
    .trim();
}

function extractFirstQuestion(message: string, fallback: string) {
  const text = cleanMessage(message);
  const match = text.match(/[^?]*\?/);
  const question = match?.[0]?.replace(/^[-*\d.)\s]+/, '').trim();
  return question && question.length >= 12 ? question : fallback;
}

function buildCoreQuestionTurn(aiMessage: string, nextQuestion: string) {
  const normalizedMessage = normalizeText(aiMessage);
  const normalizedQuestion = normalizeText(nextQuestion);

  if (normalizedMessage === normalizedQuestion) return nextQuestion;

  const acknowledgement = getShortAcknowledgement(aiMessage);
  return `${acknowledgement}\n\n${nextQuestion}`;
}

function getNextCoreQuestion(studyConfig: StudyConfig, questionProgress?: QuestionProgress) {
  const coreQuestions = studyConfig?.coreQuestions || [];
  const askedIndexes = new Set(questionProgress?.questionsAsked || []);
  const nextIndex = coreQuestions.findIndex((_, index) => !askedIndexes.has(index));

  if (nextIndex === -1) {
    return {
      index: null,
      question: null,
      total: coreQuestions.length
    };
  }

  return {
    index: nextIndex,
    question: coreQuestions[nextIndex],
    total: coreQuestions.length
  };
}

export async function POST(request: Request) {
  try {
    // TEMP: participant verification is currently relaxed in this app.
    const body = await request.json();

    const {
      history,
      studyConfig,
      participantProfile,
      questionProgress,
      currentContext
    }: {
      history: InterviewMessage[];
      studyConfig: StudyConfig;
      participantProfile: ParticipantProfile | null;
      questionProgress: QuestionProgress;
      currentContext: string;
    } = body;

    if (!Array.isArray(history) || !studyConfig) {
      return NextResponse.json(
        { error: 'Missing interview history or study configuration' },
        { status: 400 }
      );
    }

    const { index: nextQuestionIndex, question: nextQuestion, total } =
      getNextCoreQuestion(studyConfig, questionProgress);
    const participantAnswerCount = history.filter(message => message.role === 'user').length;
    const provider = getInterviewProvider(studyConfig);

    const result = await provider.generateInterviewResponse(
      history.slice(-20),
      studyConfig,
      participantProfile,
      questionProgress,
      currentContext
    );

    const nameField = participantProfile?.fields?.find(
      (field: any) => field.fieldId === 'name'
    );
    const extractedName = nameField?.value || null;

    if (extractedName) {
      result.profileUpdates = [
        ...(result.profileUpdates || []),
        {
          fieldId: 'name',
          value: extractedName,
          status: 'extracted'
        }
      ];
    }

    let updatedProfile = participantProfile;

    if (participantProfile && result.profileUpdates?.length) {
      updatedProfile = {
        ...participantProfile,
        fields: participantProfile.fields.map((field: any) => {
          const update = result.profileUpdates.find(
            (item: any) => item.fieldId === field.fieldId
          );

          if (!update) {
            return {
              ...field,
              status: field.status || 'pending'
            };
          }

          return {
            ...field,
            value: update.value ?? field.value,
            status: update.status
          };
        })
      };
    }

    let shouldConclude = Boolean(result.shouldConclude);
    let finalMessage: string;
    let questionAddressed: number | null = null;
    let phaseTransition: QuestionProgress['currentPhase'] | null = null;

    if (nextQuestion && nextQuestionIndex !== null) {
      finalMessage = buildCoreQuestionTurn(result.message, nextQuestion);
      questionAddressed = nextQuestionIndex;
      phaseTransition = nextQuestionIndex + 1 >= total ? 'exploration' : 'core-questions';
      shouldConclude = false;
    } else {
      const explorationFallback = 'Looking back, what feels most important for someone else to understand about this experience?';
      finalMessage = extractFirstQuestion(result.message, explorationFallback);
      phaseTransition = participantAnswerCount >= Math.max(total + 3, 8)
        ? 'wrap-up'
        : 'exploration';
      shouldConclude = phaseTransition === 'wrap-up';
    }

    const closingText = cleanMessage(finalMessage).toLowerCase();
    if (
      closingText.includes('concludes our interview') ||
      closingText.includes('this concludes') ||
      closingText.includes('thank you for your time')
    ) {
      shouldConclude = true;
      phaseTransition = 'wrap-up';
    }

    if (shouldConclude) {
      finalMessage = 'Thank you for your time and valuable insights. This concludes the interview.';
    }

    const updatedHistory = history.slice(-20);
    const last = updatedHistory[updatedHistory.length - 1];

    if (!last || last.role !== 'ai' || last.content !== finalMessage) {
      updatedHistory.push({
        id: `msg-${Date.now()}`,
        role: 'ai',
        content: finalMessage,
        timestamp: Date.now()
      });
    }

    return NextResponse.json({
      ...result,
      message: finalMessage,
      questionAddressed,
      phaseTransition,
      shouldConclude,
      history: updatedHistory,
      participantProfile: updatedProfile
    });
  } catch (error) {
    console.error('Interview API error:', error);
    return NextResponse.json(
      { error: 'Failed to generate interview response' },
      { status: 500 }
    );
  }
}
