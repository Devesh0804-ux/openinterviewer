import { Mistral } from '@mistralai/mistralai';
import { buildAggregateSynthesisPrompt, buildInterviewSystemPrompt } from '../prompts';

import {
  StudyConfig,
  InterviewMessage,
  AIInterviewResponse,
  ParticipantProfile,
  QuestionProgress,
  SynthesisResult,
  BehaviorData,
  AggregateSynthesisResult,
  MISTRAL_SYNTHESIS_MODEL
} from '@/types';

import {
  AIProvider,
  defaultInterviewResponse,
  defaultSynthesisResult,
  cleanJSON
} from '../ai';

const apiKey = process.env.MISTRAL_API_KEY;
const client = apiKey ? new Mistral({ apiKey }) : null;
const SYNTHESIS_TIMEOUT_MS = 15000;

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

function deterministicSynthesisResult(
  history: InterviewMessage[],
  studyConfig: StudyConfig,
  participantProfile: ParticipantProfile | null
): SynthesisResult {
  const userAnswers = (history || [])
    .filter(message => message.role === 'user' && message.content)
    .map(message => message.content.trim());
  const combinedAnswers = userAnswers.join(' ').replace(/\s+/g, ' ').trim();
  const evidence = combinedAnswers.slice(0, 260) || 'The participant completed the interview but provided limited detail.';
  const topicSeeds = [
    ...(studyConfig.topicAreas || []),
    ...(studyConfig.coreQuestions || []).slice(0, 3)
  ];
  const uniqueTopics = Array.from(new Set(topicSeeds.map(topic => topic.trim()).filter(Boolean))).slice(0, 5);
  const themes = (uniqueTopics.length ? uniqueTopics : ['Participant experience'])
    .map(topic => ({
      theme: topic,
      evidence,
      frequency: Math.max(1, Math.min(userAnswers.length, 5))
    }));
  const profileFields = participantProfile?.fields || [];
  const profileValue = (key: string) => {
    const match = profileFields.find(field =>
      field.fieldId?.toLowerCase().includes(key) && field.value
    );
    return match?.value || undefined;
  };

  return {
    statedPreferences: userAnswers.slice(0, 3),
    revealedPreferences: [
      'The participant emphasized the areas they chose to describe in most detail.'
    ],
    themes,
    contradictions: [],
    keyInsights: [
      combinedAnswers
        ? `The participant connected the study topic to concrete work experiences: ${combinedAnswers.slice(0, 220)}${combinedAnswers.length > 220 ? '...' : ''}`
        : 'The interview contains limited participant detail and should be reviewed manually.',
      studyConfig.researchQuestion
        ? `Responses should be interpreted against the research question: ${studyConfig.researchQuestion}`
        : 'Responses provide qualitative context for the configured study.'
    ],
    bottomLine: combinedAnswers
      ? `The interview suggests that ${studyConfig.researchQuestion || studyConfig.name} is experienced through practical tradeoffs, participant context, and the specific examples the participant chose to share.`
      : 'The interview completed, but the transcript has limited detail for analysis.',
    extractedProfile: {
      role: profileValue('role'),
      industry: profileValue('industry'),
      ai_frequency: profileValue('frequency'),
      comfort_level: profileValue('comfort'),
      years_experience: profileValue('experience')
    }
  };
}

function normalizeAggregateThemes(value: unknown): AggregateSynthesisResult['commonThemes'] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);

  return values.map((item) => {
    if (typeof item === 'string') {
      return {
        theme: item,
        frequency: 1,
        representativeQuotes: []
      };
    }

    const record = item as Record<string, unknown>;
    return {
      theme: stringifyInsight(record.theme || record.name || record.title || record.topic),
      frequency: Number(record.frequency) || 1,
      representativeQuotes: normalizeStringArray(record.representativeQuotes || record.quotes || record.evidence)
    };
  }).filter(theme => theme.theme);
}

function normalizeDivergentViews(value: unknown): AggregateSynthesisResult['divergentViews'] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);

  return values.map((item) => {
    const record = typeof item === 'string'
      ? { topic: item, viewA: '', viewB: '' }
      : item as Record<string, unknown>;

    return {
      topic: stringifyInsight(record.topic || record.theme || record.area),
      viewA: stringifyInsight(record.viewA || record.perspectiveA || record.firstView),
      viewB: stringifyInsight(record.viewB || record.perspectiveB || record.secondView)
    };
  }).filter(view => view.topic);
}

function normalizeAggregateResult(value: unknown): Omit<AggregateSynthesisResult, 'studyId' | 'interviewCount' | 'generatedAt'> {
  const result = (value || {}) as Partial<AggregateSynthesisResult> & Record<string, unknown>;

  return {
    commonThemes: normalizeAggregateThemes(result.commonThemes),
    divergentViews: normalizeDivergentViews(result.divergentViews),
    keyFindings: normalizeStringArray(result.keyFindings),
    researchImplications: normalizeStringArray(result.researchImplications),
    bottomLine: normalizeBottomLine(result.bottomLine)
  };
}

function deterministicAggregate(
  studyConfig: StudyConfig,
  syntheses: SynthesisResult[],
  interviewCount: number
): Omit<AggregateSynthesisResult, 'studyId' | 'interviewCount' | 'generatedAt'> {
  const themeCounts = new Map<string, { frequency: number; evidence: string[] }>();
  const findings = new Set<string>();
  const implications = new Set<string>();
  const contradictions = new Set<string>();

  syntheses.forEach((synthesis) => {
    synthesis.themes?.forEach((theme) => {
      if (!theme.theme) return;
      const current = themeCounts.get(theme.theme) || { frequency: 0, evidence: [] };
      current.frequency += Number(theme.frequency) || 1;
      if (theme.evidence) current.evidence.push(theme.evidence);
      themeCounts.set(theme.theme, current);
    });

    synthesis.keyInsights?.forEach((insight) => {
      if (insight && !/analysis pending/i.test(insight)) findings.add(insight);
    });
    synthesis.contradictions?.forEach((contradiction) => {
      if (contradiction) contradictions.add(contradiction);
    });
  });

  if (studyConfig.researchQuestion) {
    implications.add(`The interviews provide evidence for the research question: ${studyConfig.researchQuestion}`);
  }

  const commonThemes = Array.from(themeCounts.entries())
    .sort((a, b) => b[1].frequency - a[1].frequency)
    .slice(0, 6)
    .map(([theme, data]) => ({
      theme,
      frequency: data.frequency,
      representativeQuotes: data.evidence.slice(0, 3)
    }));

  const divergentViews = Array.from(contradictions)
    .slice(0, 4)
    .map((contradiction) => ({
      topic: 'Tension or contradiction',
      viewA: contradiction,
      viewB: 'Other participants may frame this differently or place less emphasis on it.'
    }));

  const keyFindings = Array.from(findings).slice(0, 8);

  return {
    commonThemes,
    divergentViews,
    keyFindings: keyFindings.length
      ? keyFindings
      : commonThemes.map(theme => `${theme.theme} emerged as a recurring pattern across interviews.`),
    researchImplications: Array.from(implications),
    bottomLine: `Across ${interviewCount} interview${interviewCount === 1 ? '' : 's'}, participants repeatedly surfaced ${commonThemes.slice(0, 3).map(t => t.theme).join(', ') || 'several related themes'}, suggesting that ${studyConfig.researchQuestion || 'the study question'} should be interpreted through both shared patterns and individual tensions.`
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
- Ask exactly ONE question in "message"
- Do not list multiple questions
- Do not repeat earlier questions from the conversation
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
          const askedIndexes = new Set(questionProgress?.questionsAsked || []);
          const nextCoreQuestion = coreQuestions.find((_, index) => !askedIndexes.has(index)) || null;

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
      Next Question Focus: ${nextCoreQuestion || "Ask one concise exploratory follow-up based only on the participant's latest answer."}

      Interviewing Rules:
      - Ask only the next question focus above, or one concise exploratory follow-up if there is no next core question.
      - Never include more than one question in the message.
      - Never copy or list previous questions.`
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
    const fallback = deterministicSynthesisResult(history, studyConfig, participantProfile);

    if (!this.client) {
      console.error("Mistral API key missing");
      return fallback;
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

      const response = await Promise.race([
        this.client.chat.complete({
          model:
            this.model ||
            studyConfig.aiModel ||
            process.env.MISTRAL_MODEL ||
            'mistral-large-latest',

          messages: [
            { role: "user", content: synthesisPrompt }
          ],

          temperature: 0.3
        }),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), SYNTHESIS_TIMEOUT_MS);
        })
      ]);

      if (!response) {
        console.warn("Mistral Synthesis timed out; using transcript fallback.");
        return fallback;
      }

      const raw = response.choices?.[0]?.message?.content || "";

      try {
        const rawString = typeof raw === 'string' ? raw : JSON.stringify(raw);
        const parsed = normalizeSynthesisResult(JSON.parse(cleanJSON(rawString)));
        if (
          parsed.keyInsights.some(insight => /analysis pending/i.test(insight)) ||
          /synthesis in progress/i.test(parsed.bottomLine)
        ) {
          return fallback;
        }
        return {
          ...fallback,
          ...parsed,
          statedPreferences: parsed.statedPreferences.length ? parsed.statedPreferences : fallback.statedPreferences,
          revealedPreferences: parsed.revealedPreferences.length ? parsed.revealedPreferences : fallback.revealedPreferences,
          themes: parsed.themes.length ? parsed.themes : fallback.themes,
          keyInsights: parsed.keyInsights.length ? parsed.keyInsights : fallback.keyInsights,
          bottomLine: parsed.bottomLine || fallback.bottomLine
        };
      } catch (parseError) {
        console.error("Mistral Synthesis JSON Parse Error:", raw);
        return fallback;
      }

    } catch (error) {
      console.error("Mistral Synthesis Error:", error);
      return fallback;
    }
  }


  async synthesizeAggregate(
    studyConfig: StudyConfig,
    syntheses: SynthesisResult[],
    interviewCount: number
  ): Promise<Omit<AggregateSynthesisResult, 'studyId' | 'interviewCount' | 'generatedAt'>> {
    const fallback = deterministicAggregate(studyConfig, syntheses, interviewCount);

    if (!this.client) {
      console.error("Mistral API key missing");
      return fallback;
    }

    try {
      const prompt = `${buildAggregateSynthesisPrompt(studyConfig, syntheses, interviewCount)}

Return ONLY valid JSON in this exact shape:
{
  "commonThemes": [
    {
      "theme": string,
      "frequency": number,
      "representativeQuotes": string[]
    }
  ],
  "divergentViews": [
    {
      "topic": string,
      "viewA": string,
      "viewB": string
    }
  ],
  "keyFindings": string[],
  "researchImplications": string[],
  "bottomLine": string
}

Rules:
- No markdown
- No explanation outside JSON
- Use concrete findings from the interview syntheses
- Do not return placeholder text such as "analysis pending"`;

      const response = await this.client.chat.complete({
        model:
          this.model ||
          studyConfig.aiModel ||
          process.env.MISTRAL_MODEL ||
          MISTRAL_SYNTHESIS_MODEL,

        messages: [
          { role: "user", content: prompt }
        ],

        temperature: 0.2
      });

      const raw = response.choices?.[0]?.message?.content || "";
      const rawString = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const parsed = normalizeAggregateResult(JSON.parse(cleanJSON(rawString)));

      if (
        parsed.keyFindings.some(finding => /analysis pending/i.test(finding)) ||
        /synthesis in progress/i.test(parsed.bottomLine)
      ) {
        return fallback;
      }

      return {
        ...fallback,
        ...parsed,
        commonThemes: parsed.commonThemes.length ? parsed.commonThemes : fallback.commonThemes,
        keyFindings: parsed.keyFindings.length ? parsed.keyFindings : fallback.keyFindings,
        researchImplications: parsed.researchImplications.length ? parsed.researchImplications : fallback.researchImplications,
        bottomLine: parsed.bottomLine || fallback.bottomLine
      };
    } catch (error) {
      console.error("Mistral Aggregate Synthesis Error:", error);
      return fallback;
    }
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
