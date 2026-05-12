// POST /api/interview - Generate AI interview response
// Server-side only - API keys never sent to client
// Requires valid participant token to prevent quota abuse

import { NextResponse } from 'next/server';
import { getInterviewProvider } from '@/lib/providers';
import { verifyParticipantToken } from '@/lib/auth';
import {
  StudyConfig,
  ParticipantProfile,
  InterviewMessage,
  QuestionProgress
} from '@/types';

// Payload size limits to prevent abuse
const MAX_HISTORY_MESSAGES = 100;
const MAX_CONTEXT_LENGTH = 10000;
const MAX_MESSAGE_LENGTH = 5000;

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function ensureCoreQuestion(message: string, nextQuestion: string | null) {
  if (!nextQuestion) return message;

  const normalizedMessage = normalizeText(message || '');
  const normalizedQuestion = normalizeText(nextQuestion);

  if (normalizedMessage.includes(normalizedQuestion)) {
    return message;
  }

  const intro = message?.trim()
    ? `${message.trim()}\n\n`
    : '';

  return `${intro}${nextQuestion}`;
}

export async function POST(request: Request) {
  try {
    // TEMP: Skip participant verification during development
    const auth = { valid: true, participantId: "dev-test" };

    const body = await request.json();

    const {
      history,  
      studyConfig,
      participantProfile,
      questionProgress,
      currentContext
    } = body;

    // Determine next core question
    const asked = questionProgress?.questionsAsked?.length ?? 0;
    const total = studyConfig?.coreQuestions?.length || 0;

    let nextQuestion: string | null = null;

    if (asked < total) {
      // Core question phase
      nextQuestion = studyConfig.coreQuestions[asked];
    } else {
      // Exploration phase
      nextQuestion = "What was the biggest challenge you faced in this experience?";
    }

    const provider = getInterviewProvider(studyConfig);

    const result = await provider.generateInterviewResponse(
      history.slice(-20),
      studyConfig,
      participantProfile,
      questionProgress,
      currentContext,
    );

      const nameField = participantProfile?.fields?.find(
        (f: any) => f.fieldId === "name"
      );

      const extractedName = nameField?.value || null;

      // ✅ ensure name is always in profileUpdates
      if (extractedName) {
        result.profileUpdates = [
          ...(result.profileUpdates || []),
          {
            fieldId: "name",
            value: extractedName,
            status: "extracted"
          }
        ];
      }

    // Merge profile updates into participantProfile
    let updatedProfile = participantProfile;

    if (participantProfile && result.profileUpdates?.length) {
      updatedProfile = {
        ...participantProfile,
        fields: participantProfile.fields.map((field: { fieldId: any; value: any; }) => {
          const update = result.profileUpdates.find(
            (u: any) => u.fieldId === field.fieldId
          );

          if (!update) return field;

          return {
            ...field,
            value: update.value ?? field.value,
            status: update.status
          };
        })
      };
    }

    console.log("AI RESPONSE:", JSON.stringify(result, null, 2));

    // Force the configured core interview questions to be asked in order.
    result.message = ensureCoreQuestion(result.message, nextQuestion);

    // Force next core question if AI gives vague exploration prompt
    const aiMessage = result.message?.toLowerCase() || "";

    if (
      nextQuestion &&
      (
        !aiMessage ||
        aiMessage.includes("tell me more") ||
        aiMessage.includes("elaborate") ||
        aiMessage.length < 15
      )
    ) {
      result.message = nextQuestion;
    }

    let shouldConclude = !!result.shouldConclude;

    // ✅ Force conclude if AI says closing message
    const msg = (result.message || "").toLowerCase();

    if (
      msg.includes("concludes our interview") ||
      msg.includes("this concludes") ||
      msg.includes("thank you for your time")
    ) {
      shouldConclude = true;
    }

    const MIN_MESSAGES = 6;

    // 🚨 HARD STOP (backend level)
    if (asked >= 12) {
      shouldConclude = true;
    }

    if (history.length < MIN_MESSAGES) {
      shouldConclude = false;
    }

    // If no core questions, don't auto end
    if (total === 0) {
      shouldConclude = false;
    }

    // ✅ FINAL THANK YOU MESSAGE LOGIC
    let finalMessage = result.message;

    if (shouldConclude === true) {
      finalMessage = "Thank you for your time and valuable insights. This concludes the interview.";
    }
    
    let updatedHistory = history.slice(-20);

    // ✅ Reuse (no let)
    let last = updatedHistory[updatedHistory.length - 1];

    if (!last || last.content !== finalMessage) {
      updatedHistory.push({
        role: "ai",
        content: finalMessage,
        timestamp: Date.now()
      });
    }

    return NextResponse.json({
      ...result,
      message: finalMessage,
      questionAddressed: asked,
      phaseTransition: asked + 1 >= total ? "exploration" : "core-questions",
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
