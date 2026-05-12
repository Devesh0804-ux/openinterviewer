import { Mistral } from '@mistralai/mistralai';
import { buildInterviewSystemPrompt } from '../prompts';

import {
  StudyConfig,
  InterviewMessage,
  AIInterviewResponse,
  ParticipantProfile,
  QuestionProgress,
  SynthesisResult,
  BehaviorData,
  AggregateSynthesisResult
} from '@/types';

import {
  AIProvider,
  defaultInterviewResponse,
  defaultSynthesisResult,
  defaultAggregateSynthesisResult,
  cleanJSON
} from '../ai';

const apiKey = process.env.MISTRAL_API_KEY;
const client = apiKey ? new Mistral({ apiKey }) : null;

function stringifyInsight(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(stringifyInsight).filter(Boolean).join('; ');
  }

  const record = value as Record<string, unknown>;
  return Object.entries(record)
    .map(([key, entry]) => `${key}: ${stringifyInsight(entry)}`)
    .filter(Boolean)
    .join('; ');
}

function normalizeStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(stringifyInsight).filter(Boolean);
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map(stringifyInsight)
      .filter(Boolean);
  }
  return [stringifyInsight(value)].filter(Boolean);
}

function normalizeThemes(value: unknown): SynthesisResult['themes'] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);

  return values.map((item) => {
    if (typeof item === 'string') {
      return {
        theme: item,
        evidence: '',
        frequency: 1
      };
    }

    const record = item as Record<string, unknown>;
    return {
      theme: stringifyInsight(record.theme || record.name || record.title || record.topic),
      evidence: stringifyInsight(record.evidence || record.description || record.summary),
      frequency: Number(record.frequency) || 1
    };
  }).filter(theme => theme.theme);
}

function normalizeBottomLine(value: unknown): string {
  if (!value) return defaultSynthesisResult.bottomLine;
  if (typeof value === 'string') return value;

  const record = value as Record<string, unknown>;
  return stringifyInsight(record.summary || record.bottomLine || record.insight || value);
}

function normalizeSynthesisResult(value: unknown): SynthesisResult {
  const result = (value || {}) as Partial<SynthesisResult> & Record<string, unknown>;

  return {
    statedPreferences: normalizeStringArray(result.statedPreferences),
    revealedPreferences: normalizeStringArray(result.revealedPreferences),
    themes: normalizeThemes(result.themes),
    contradictions: normalizeStringArray(result.contradictions),
    keyInsights: normalizeStringArray(result.keyInsights),
    bottomLine: normalizeBottomLine(result.bottomLine),
    extractedProfile: result.extractedProfile as SynthesisResult['extractedProfile']
  };
}

export class MistralProvider implements AIProvider {

  private model?: string;
  private client: Mistral | null;

  constructor(model?: string) {
    this.model = model;
    const apiKey = process.env.MISTRAL_API_KEY;
    this.client = apiKey ? new Mistral({ apiKey }) : null;
  }

  // ============================================
  // INTERVIEW RESPONSE
  // ============================================

  async generateInterviewResponse(
    history: InterviewMessage[],
    studyConfig: StudyConfig,
    participantProfile: ParticipantProfile | null,
    questionProgress: QuestionProgress,
    currentContext: string
  ): Promise<AIInterviewResponse> {

    if (!this.client) {
      console.error("Mistral API key missing");
      return defaultInterviewResponse;
    }

    try {

      const systemPrompt = `
      ${buildInterviewSystemPrompt(
        studyConfig,
        participantProfile || {} as ParticipantProfile,
        questionProgress,
        currentContext
      )}

You MUST respond ONLY with valid JSON in this exact format:

{
  "message": string,
  "questionAddressed": number | null,
  "phaseTransition": "background" | "core-questions" | "exploration" | "feedback" | "wrap-up" | null,
  "profileUpdates": [],
  "shouldConclude": boolean
}

Rules:
- No markdown
- No explanations
- No text outside JSON
- Always include all required fields
`;

      const cleanedHistory: any[] = (history || [])
        .slice(-10) // 🔥 reduce from 20 → 10
        .filter(msg => msg?.content && typeof msg.content === "string")
        .map(msg => ({
          role: msg.role === "ai" ? "assistant" : "user",
          content: String(msg.content).slice(0, 500) // 🔥 limit size
        }));

      if (!cleanedHistory.length) {
        return {
          message: "Let's continue. Could you tell me more?",
          questionAddressed: null,
          phaseTransition: null,
          profileUpdates: [],
          shouldConclude: false
        };
      }

          const coreQuestions = studyConfig?.coreQuestions ?? [];

          const totalQuestionsAsked = questionProgress?.questionsAsked?.length || 0;

          if (totalQuestionsAsked >= 12) {
            return {
              message: "Thank you for your time and insights. This concludes the interview.",
              questionAddressed: null,
              phaseTransition: "wrap-up",
              profileUpdates: [],
              shouldConclude: true
            };
          }


      const response = await this.client.chat.complete({
        model:
          this.model ||
          studyConfig.aiModel ||
          process.env.MISTRAL_MODEL ||
          "mistral-large-latest",

        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: `Phase: ${questionProgress?.currentPhase || "background"}
      Questions Completed: ${questionProgress?.questionsAsked?.length || 0}
      Total Questions: ${coreQuestions.length}
      Core Questions: ${
              coreQuestions.length > 0
                ? coreQuestions.join(" | ")
                : "No predefined questions"
            }`
          },
          ...cleanedHistory
        ],

        temperature: 0.2
      });

      const content = response.choices?.[0]?.message?.content || "";

      let raw =
        typeof content === "string"
          ? content
          : JSON.stringify(content || "");

      raw = raw.replace(/```json/g, "").replace(/```/g, "").trim();
      if (!raw || raw.length < 5) {
        return {
          message: "Could you elaborate a bit more?",
          questionAddressed: null,
          phaseTransition: null,
          profileUpdates: [],
          shouldConclude: false
        };
      }

      try {
        const rawString = typeof raw === "string" ? raw : JSON.stringify(raw);
        const parsed = JSON.parse(cleanJSON(rawString));

        if (!parsed?.message) {
          return {
            message: "Could you tell me a bit more about that?",
            questionAddressed: null,
            phaseTransition: null,
            profileUpdates: [],
            shouldConclude: false
          };
        }

        let cleanMessage = parsed.message || "";

        cleanMessage = cleanMessage
          .replace(/```json/g, "")
          .replace(/```/g, "")
          .trim();

        return {
          message: cleanMessage,
          questionAddressed: parsed.questionAddressed ?? null,
          phaseTransition: parsed.phaseTransition ?? null,
          profileUpdates: Array.isArray(parsed.profileUpdates)
            ? parsed.profileUpdates.filter(
                (p: any) =>
                  p &&
                  typeof p.fieldId === "string" &&
                  p.fieldId.length > 0 &&
                  p.value !== undefined
              )
            : [],
          shouldConclude: parsed.shouldConclude ?? false
        };

      } catch (parseError) {
        console.error("Mistral JSON Parse Error:", raw);

        // 🔒 Safe fallback instead of freezing interview
        return {
          message: "Could you tell me a bit more about that?",
          questionAddressed: null,
          phaseTransition: null,
          profileUpdates: [],
          shouldConclude: false
        };
      }

    } catch (error) {
      console.error("Mistral Interview Error:", error instanceof Error ? error.message : String(error));
      return defaultInterviewResponse;
    }
  }

  // ============================================
  // GREETING
  // ============================================

  async getInterviewGreeting(studyConfig: StudyConfig): Promise<string> {
    return `Hello! I'm an AI assistant helping with the "${studyConfig.name}" study. Let's get started.`;
  }

  // ============================================
  // RAW RESPONSE
  // ============================================

  async generateRawResponse(extractionPrompt: string): Promise<unknown> {
    if (!this.client) {
      console.error("Mistral API key missing");
      return null;
    }
    
    try {
      const response = await this.client.chat.complete({
        model:
          this.model ||
          process.env.MISTRAL_MODEL ||
          'mistral-large-latest',

        messages: [
          { role: "user", content: extractionPrompt }
        ],

        temperature: 0.7
      });

      const raw = response.choices?.[0]?.message?.content || "";

      try {
        const rawString = typeof raw === 'string' ? raw : JSON.stringify(raw);
        return JSON.parse(cleanJSON(rawString));
      } catch (parseError) {
        console.error("Mistral Raw Response JSON Parse Error:", raw);
        return raw;
      }
    } catch (error) {
      console.error("Mistral Raw Response Error:", error);
      return null;
    }
  }

  // ============================================
  // SYNTHESIS
  // ============================================

  async synthesizeInterview(
    history: InterviewMessage[],
    studyConfig: StudyConfig,
    behaviorData: BehaviorData,
    participantProfile: ParticipantProfile | null
  ): Promise<SynthesisResult> {

    if (!this.client) {
      console.error("Mistral API key missing");
      return defaultSynthesisResult;
    }

    try {

      const synthesisPrompt = `
  You are an expert research analyst.

  Analyze the following interview transcript and return ONLY valid JSON.

  Return this exact JSON structure. Arrays must be arrays of strings. Themes must be objects.

  {
    "statedPreferences": string[],
    "revealedPreferences": string[],
    "themes": [
      {
        "theme": string,
        "evidence": string,
        "frequency": number
      }
    ],
    "contradictions": string[],
    "keyInsights": string[],
    "bottomLine": string,
    "extractedProfile": {
      "role": string | null,
      "industry": string | null,
      "ai_frequency": string | null,
      "comfort_level": string | null,
      "years_experience": string | null
    }
  }

  Rules:
  - No markdown
  - No explanation
  - No text outside JSON
  - If a profile field is not mentioned, return null
  - frequency should be numeric

  Transcript:
  ${history
    .slice(-20) // 🔥 limit history
    .map(m => `${m.role.toUpperCase()}: ${m.content.slice(0, 300)}`)
    .join("\n")}
  `;

      const response = await this.client.chat.complete({
        model:
          this.model ||
          studyConfig.aiModel ||
          process.env.MISTRAL_MODEL ||
          'mistral-large-latest',

        messages: [
          { role: "user", content: synthesisPrompt }
        ],

        temperature: 0.3
      });

      const raw = response.choices?.[0]?.message?.content || "";

      try {
        const rawString = typeof raw === 'string' ? raw : JSON.stringify(raw);
        return normalizeSynthesisResult(JSON.parse(cleanJSON(rawString)));
      } catch (parseError) {
        console.error("Mistral Synthesis JSON Parse Error:", raw);
        return defaultSynthesisResult;
      }

    } catch (error) {
      console.error("Mistral Synthesis Error:", error);
      return defaultSynthesisResult;
    }
  }


  async synthesizeAggregate(
    studyConfig: StudyConfig,
    syntheses: SynthesisResult[],
    interviewCount: number
  ): Promise<Omit<AggregateSynthesisResult, 'studyId' | 'interviewCount' | 'generatedAt'>> {

    // You can later implement aggregate AI logic here
    return defaultAggregateSynthesisResult;
  }

  // ============================================
  // FOLLOW-UP STUDY
  // ============================================

  async generateFollowupStudy(
    parentConfig: StudyConfig,
    synthesis: AggregateSynthesisResult
  ): Promise<{ name: string; researchQuestion: string; coreQuestions: string[] }> {

    return {
      name: `Follow-up: ${parentConfig.name}`,
      researchQuestion: "Deepening insights from initial interviews",
      coreQuestions: []
    };
  }
}


// Optional helper if still used elsewhere
export async function generateMistralResponse(
  messages: any[],
  model?: string
) {
  if (!client){
    throw new Error("MISTRAL_API_KEY is not configured.");
  }

  const selectedModel =
    model ||
    process.env.MISTRAL_MODEL ||
    'mistral-large-latest';

  const response = await client.chat.complete({
    model: selectedModel,
    messages,
    temperature: 0.7
  });

  return response.choices?.[0]?.message?.content || "";
}
