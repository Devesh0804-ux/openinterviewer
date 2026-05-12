// AI Provider Factory
// Returns the appropriate provider based on study or environment configuration

import { MistralProvider } from "./mistral";
import { GeminiProvider } from "./gemini";
import { ClaudeProvider } from "./claude";
import { AIProvider } from "../ai";
import { StudyConfig } from "@/types";

export type ProviderType = "gemini" | "claude" | "mistral";

// Validate provider safely
function resolveProviderType(studyConfig?: StudyConfig): ProviderType {
  const envProvider = process.env.AI_PROVIDER;

  const provider =
    studyConfig?.aiProvider ||
    (envProvider === "gemini" ||
    envProvider === "claude" ||
    envProvider === "mistral"
      ? envProvider
      : undefined) ||
    "mistral";

  return provider;
}

// Provider priority:
// 1. studyConfig.aiProvider
// 2. process.env.AI_PROVIDER
// 3. default = gemini
export function getInterviewProvider(
  studyConfig?: StudyConfig
): AIProvider {

  const providerType = resolveProviderType(studyConfig);
  const model = studyConfig?.aiModel;

  switch (providerType) {

    case "claude":
      return new ClaudeProvider(model);

    case "mistral":
      return new MistralProvider(model);

    case "gemini":
    default:
      return new GeminiProvider(model);
  }
}

// Explicit exports
export { GeminiProvider } from "./gemini";
export { ClaudeProvider } from "./claude";
export { MistralProvider } from "./mistral";
