'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { useStore } from '@/store';
import { InterviewMessage, InterviewPhase } from '@/types';
import ReactMarkdown from 'react-markdown';
import {
  Send,
  Loader2,
  Bot,
  ArrowRight,
  MessageSquare,
  CheckCircle,
  User
} from 'lucide-react';
import { data } from 'framer-motion/m';

// Phase display labels
const phaseLabels: Record<InterviewPhase, string> = {
  background: 'Getting to know you',
  'core-questions': 'Core Questions',
  exploration: 'Exploring further',
  feedback: 'Your feedback',
  'wrap-up': 'Wrapping up'
};

const TERMINATION_STORAGE_PREFIX = 'openinterviewer:terminated:';

function getTerminationStorageKey(token: string | null | undefined) {
  return token ? `${TERMINATION_STORAGE_PREFIX}${token}` : null;
}

function readStoredTermination(token: string | null | undefined) {
  if (typeof window === 'undefined') return null;

  const key = getTerminationStorageKey(token);
  try {
    return key ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function storeTermination(token: string | null | undefined, reason: string) {
  if (typeof window === 'undefined') return;

  const key = getTerminationStorageKey(token);
  try {
    if (key) {
      window.localStorage.setItem(key, reason);
    }
  } catch {
    // If localStorage is unavailable, the in-memory termination screen still applies.
  }
}

function persistTerminationToServer(token: string | null | undefined, reason: string) {
  if (!token || typeof window === 'undefined') return;

  const state = useStore.getState();
  const body = JSON.stringify({
    token,
    reason,
    history: state.interviewHistory,
    participantProfile: state.participantProfile,
    behaviorData: state.behaviorData
  });

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon('/api/participant-token/terminate', blob);
      return;
    }
  } catch {
    // Fall through to fetch.
  }

  fetch('/api/participant-token/terminate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true
  }).catch((error) => {
    console.error('Failed to persist participant termination:', error);
  });
}

const InterviewChat: React.FC = () => {
  const router = useRouter();
  const params = useParams();
  const tokenFromUrl = params.token as string;
  const [warnings, setWarnings] = useState(0);

  const triggerWarning = () => {
    setWarnings((prev) => {
      const newWarnings = prev + 1;

      alert(`Copy/Paste is not allowed. Warning ${newWarnings}/3`);

      if (newWarnings >= 3) {
        alert("Too many violations. Interview will be submitted.");
        router.push("/synthesis");
      }

      return newWarnings;
    });
  };

  const {
    studyConfig,
    participantProfile,
    questionProgress,
    interviewHistory,
    addMessage,
    setStep,
    isAiThinking,
    setAiThinking,
    contextEntries,
    appendContext,
    setInterviewPhase,
    markQuestionAsked,
    completeInterview,
    updateProfileField,
    setProfileRawContext,
    participantToken,
    setParticipantToken,
    viewMode
  } = useStore();

  useEffect(() => {
    console.log("Current participantToken:", participantToken);
  }, [participantToken]);

  useEffect(() => {
  if (tokenFromUrl && participantToken !== tokenFromUrl) {
    setParticipantToken(tokenFromUrl);
  }
}, [participantToken, tokenFromUrl, setParticipantToken]);

  useEffect(() => {
    const token = tokenFromUrl || participantToken;
    const storedTermination = readStoredTermination(token);

    if (!storedTermination) return;

    terminatedRef.current = true;
    interviewActiveRef.current = false;
    setTerminationReason(storedTermination);
    setAiThinking(false);
    completeInterview();
  }, [participantToken, tokenFromUrl, setAiThinking, completeInterview]);


  const [input, setInput] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [showFinishOption, setShowFinishOption] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [terminationReason, setTerminationReason] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const greetingSent = useRef(false);
  const interviewActiveRef = useRef(false);
  const terminatedRef = useRef(false);

  const [onboardingStep, setOnboardingStep] = useState<
    "start" | "name" | "done"
  >("start");

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [interviewHistory, isAiThinking]);

  // Show finish option
  useEffect(() => {
    if (questionProgress.currentPhase !== 'background') {
      setShowFinishOption(true);
    }
  }, [questionProgress.currentPhase]);

  useEffect(() => {
    interviewActiveRef.current =
      viewMode === 'participant' &&
      onboardingStep !== 'start' &&
      !isFinishing &&
      !terminationReason;
  }, [viewMode, onboardingStep, isFinishing, terminationReason]);

  const terminateInterview = (reason: string) => {
    if (terminatedRef.current) return;

    terminatedRef.current = true;
    interviewActiveRef.current = false;
    storeTermination(tokenFromUrl || participantToken, reason);
    persistTerminationToServer(tokenFromUrl || participantToken, reason);
    setTerminationReason(reason);
    setAiThinking(false);
    completeInterview();
  };

  const requestInterviewFullscreen = async () => {
    if (typeof document === 'undefined') return;
    if (document.fullscreenElement) return;

    try {
      await document.documentElement.requestFullscreen?.();
    } catch (error) {
      console.warn('Fullscreen request was blocked by the browser:', error);
    }
  };

  useEffect(() => {
    if (viewMode !== 'participant') return;

    const terminateIfActive = (reason: string) => {
      if (interviewActiveRef.current) {
        terminateInterview(reason);
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        terminateIfActive('The interview was terminated because the tab was switched or minimized.');
      }
    };

    const handleBlur = () => {
      window.setTimeout(() => {
        if (!document.hasFocus()) {
          terminateIfActive('The interview was terminated because the browser window lost focus.');
        }
      }, 200);
    };

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        terminateIfActive('The interview was terminated because fullscreen mode was exited.');
      }
    };

    const handleBlockedClipboardAction = (event: Event) => {
      event.preventDefault();
      terminateIfActive('The interview was terminated because copy, paste, or content transfer actions are not allowed.');
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const blockedShortcut = (event.ctrlKey || event.metaKey) && ['a', 'c', 'v', 'x'].includes(key);

      if (blockedShortcut) {
        event.preventDefault();
        terminateIfActive('The interview was terminated because keyboard copy/paste shortcuts are not allowed.');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('copy', handleBlockedClipboardAction);
    document.addEventListener('cut', handleBlockedClipboardAction);
    document.addEventListener('paste', handleBlockedClipboardAction);
    document.addEventListener('drop', handleBlockedClipboardAction);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('copy', handleBlockedClipboardAction);
      document.removeEventListener('cut', handleBlockedClipboardAction);
      document.removeEventListener('paste', handleBlockedClipboardAction);
      document.removeEventListener('drop', handleBlockedClipboardAction);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleBlur);
    };
  }, [viewMode, onboardingStep, isFinishing, terminationReason, participantToken, tokenFromUrl]);

  // useEffect(() => {

  //     if (viewMode !== "participant") return;
  //   const handleKeyDown = (e: KeyboardEvent) => {
  //     if (
  //       e.ctrlKey &&
  //       ["c", "v", "x", "a"].includes(e.key.toLowerCase())
  //     ) {
  //       e.preventDefault();
  //       triggerWarning();
  //     }
  //   };

  //   const handlePaste = (e: ClipboardEvent) => {
  //     e.preventDefault();
  //     triggerWarning();
  //   };

  //   const handleCopy = (e: ClipboardEvent) => {
  //     e.preventDefault();
  //     triggerWarning();
  //   };

  //   const handleDrop = (e: DragEvent) => {
  //     e.preventDefault();
  //     triggerWarning();
  //   };

  //   const disableRightClick = (e: MouseEvent) => {
  //     e.preventDefault();
  //     triggerWarning();
  //   };

  //   const handleVisibilityChange = () => {
  //     if (document.hidden) {
  //       setWarnings((prev) => {
  //         const newWarnings = prev + 1;

  //         if (newWarnings === 1) {
  //           alert("Warning: Switching tabs is not allowed during the interview.");
  //         }

  //         if (newWarnings >= 2) {
  //           alert("You switched tabs again. The interview will now be submitted.");
  //           router.push("/synthesis");
  //         }

  //         return newWarnings;
  //       });
  //     }
  //   };

  //   document.addEventListener("visibilitychange", handleVisibilityChange);

  //   document.addEventListener("keydown", handleKeyDown);
  //   document.addEventListener("paste", handlePaste);
  //   document.addEventListener("copy", handleCopy);
  //   document.addEventListener("drop", handleDrop);
  //   document.addEventListener("contextmenu", disableRightClick);

  //   return () => {
  //     document.removeEventListener("keydown", handleKeyDown);
  //     document.removeEventListener("paste", handlePaste);
  //     document.removeEventListener("copy", handleCopy);
  //     document.removeEventListener("drop", handleDrop);
  //     document.removeEventListener("contextmenu", disableRightClick);
  //     document.removeEventListener("visibilitychange", handleVisibilityChange);
  //   };

  // }, []);

  // 🔥 ADD THIS EFFECT RIGHT HERE
  useEffect(() => {
    if (viewMode !== 'participant') {
      setAiThinking(false);
    }
  }, [viewMode]);

  // Greeting initialization (AI starts the interview)
  useEffect(() => {
    const startInterview = async () => {

      if (greetingSent.current) return;   // ✅ stop second call
      greetingSent.current = true;

      if (!studyConfig) return;
      if (!participantToken) return;
      if (readStoredTermination(tokenFromUrl || participantToken)) return;
      if (viewMode !== "participant") return;
      if (interviewHistory.length > 0) return; // ✅ prevents duplicate greeting

      try {
        setAiThinking(true);

        addMessage({
          id: `msg-${Date.now()}`,
          role: "ai",
          content: "Should we begin the interview?",
          timestamp: Date.now()
        });

      } catch (error) {
        console.error("Greeting error:", error);
      } finally {
        setAiThinking(false);
      }
    };

    startInterview();
  }, [studyConfig, participantToken, tokenFromUrl, viewMode]);

  const handleSend = async (textOverride?: string) => {

    const text = textOverride || input;
    if (!text.trim()) return;
    if (terminationReason) return;

    // ✅ ADD USER MESSAGE FIRST (IMPORTANT)
    const userMsg: InterviewMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now()
    };

    addMessage(userMsg);
    setInput("");

    // 🔥 STEP 0: Start confirmation
    if (onboardingStep === "start") {
      const positive = ["yes", "y", "ok", "sure", "start"];

      if (positive.some(p => text.toLowerCase().includes(p))) {
        await requestInterviewFullscreen();

        addMessage({
          id: `msg-${Date.now()}`,
          role: "ai",
          content: "What is your name?",
          timestamp: Date.now()
        });

        setOnboardingStep("name");
      } else {
        addMessage({
          id: `msg-${Date.now()}`,
          role: "ai",
          content: "No problem. Let me know when you're ready.",
          timestamp: Date.now()
        });
      }

      return;
    }

    // 🔥 STEP 1: Name
    if (onboardingStep === "name") {
      const name = text.trim();

      // 🔥 Force correct state update
      const currentState = useStore.getState();

      useStore.setState((state: any) => ({
        participantProfile: {
          ...state.participantProfile,
          fields: [
            ...(state.participantProfile?.fields || []).filter(
              (f: any) => f.fieldId !== "name"
            ),
            {
              fieldId: "name",
              value: name,
              status: "extracted"
            }
          ]
        }
      }));

      addMessage({
        id: `msg-${Date.now()}`,
        role: "ai",
        content: `Nice to meet you, ${name}! Let's begin.\n\nCan you tell me about your skillset?`,
        timestamp: Date.now()
      });

      appendContext("User name captured", "system");

      setOnboardingStep("done");
      return;
    }
 
    if (onboardingStep !== "done") return;

    console.log("participantToken at send:", participantToken);

    if (isFinishing) return;
    if (!studyConfig) return;

    appendContext(text, 'text');
    setAiThinking(true);

    try {
      const currentContext =
        Array.isArray(contextEntries)
          ? contextEntries.map((e: any) => e.text).join('\n')
          : '';

      const latestHistory = useStore.getState().interviewHistory;
      const updatedHistory = latestHistory;

      const latestProfile = useStore.getState().participantProfile;

      const res = await fetch("/api/interview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${participantToken}`
        },
        body: JSON.stringify({
          history: updatedHistory,
          studyConfig,
          participantProfile: latestProfile, 
          questionProgress,
          currentContext
        })
      });

      const response = await res.json();
      response.shouldConclude = response.shouldConclude === true || response.shouldConclude === "true";

      console.log("FULL FRONTEND RESPONSE:", response);
      
        addMessage({
          id: `msg-${Date.now()}`,
          role: "ai",
          content: response.message,
          timestamp: Date.now()
        });

      console.log("TYPE OF shouldConclude:", typeof response.shouldConclude);
      console.log("VALUE:", response.shouldConclude);

      if (response.profileUpdates?.length) {
        response.profileUpdates.forEach((update: any) => {
          if (update.fieldId === "name") return;
          updateProfileField(update.fieldId, update.value, update.status);
        });
      }

      if (response.participantProfile) {
        useStore.setState({
          participantProfile: response.participantProfile
        });
      }

      if (response.phaseTransition) {
        setInterviewPhase(response.phaseTransition);
      }

      if (response.questionAddressed !== null && response.questionAddressed !== undefined) {
        markQuestionAsked(response.questionAddressed);
      }

      const msg = response.message?.toLowerCase() || "";

      const isClosingMessage =
        msg.includes("conclude") ||
        msg.includes("concludes") ||
        msg.includes("thank you for your time") ||
        msg.includes("that concludes our interview") ||
        msg.includes("interview is complete");

      console.log("CHECK TRIGGER:", {
        shouldConclude: response.shouldConclude,
        isClosingMessage
      });

      console.log("🚨 FINAL CHECK:", {
        shouldConclude: response.shouldConclude,
        isClosingMessage,
        message: response.message
      });

      if (response.shouldConclude || isClosingMessage) {
        console.log("🔥 ENTERED COMPLETE BLOCK");

        setIsFinishing(true);     // 🔥 show loader immediately
        completeInterview();      // lock input

        const finalHistory = useStore.getState().interviewHistory;

        const currentProfile = useStore.getState().participantProfile;

        console.log("🔥 CALLING /complete API");

        const completeResponse = await fetch('/api/interview/complete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${participantToken}`
          },
          body: JSON.stringify({
            history: finalHistory,
            studyConfig,
            participantProfile: currentProfile,
            studyId: studyConfig.id
          })
        });

        console.log("COMPLETE RES STATUS:", completeResponse.status);

        if (!completeResponse.ok) {
          const error = await completeResponse.json().catch(() => ({}));
          throw new Error(error.error || 'Failed to save completed interview');
        }

        const { interviewId } = await completeResponse.json();
        const redirectUrl = `/p/${participantToken}/complete${interviewId ? `?interviewId=${interviewId}` : ''}`;
        router.replace(redirectUrl);
      }

    } catch (error) {
      console.error('Interview error:', error);
      setIsFinishing(false);

      addMessage({
        id: `msg-${Date.now()}`,
        role: 'ai',
        content: "Something went wrong. Let's continue.",
        timestamp: Date.now()
      });
    } finally {
      setAiThinking(false);
    }
  };


  if (!studyConfig) {
    return (
      <div className="min-h-screen bg-stone-900 flex items-center justify-center">
        <p className="text-stone-400">No study configured.</p>
      </div>
    );
  }

const totalQuestions = studyConfig?.coreQuestions?.length ?? 0;
  const questionsCompleted = questionProgress.questionsAsked.length;
  const isComplete = isFinishing || Boolean(terminationReason);

  const getProgressDisplay = () => {
    if (questionProgress.currentPhase === 'background') {
      return phaseLabels.background;
    }
    if (questionProgress.currentPhase === 'core-questions') {
      return `Question ${Math.min(questionsCompleted + 1, totalQuestions)} of ${totalQuestions}`;
    }
    return phaseLabels[questionProgress.currentPhase];
  };

  if (isFinishing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-200 text-stone-950">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={36} className="animate-spin text-stone-700" />
          <p className="text-sm text-stone-600">
            Generating your interview analysis...
          </p>
        </div>
      </div>
    );
  }

  if (terminationReason) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-200 px-4 text-stone-950">
        <div className="w-full max-w-md rounded-2xl border border-stone-300 bg-stone-50 p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold">Interview Terminated</h1>
          <p className="mt-3 text-sm leading-6 text-stone-700">
            {terminationReason}
          </p>
          <p className="mt-3 text-xs text-stone-500">
            Please contact the research team if you need a new participant link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] flex-col bg-stone-200">
      {/* Header */}
      <div className="min-h-16 flex items-center justify-between px-4 sm:px-6 py-3 border-b border-stone-300 bg-stone-100/95 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          {/* Logo */}
          <Image
            src="/bharattech-logo.png"
            alt="BharatTech"
            width={40}
            height={40}
            className="w-9 h-9 sm:w-10 sm:h-10 object-contain flex-shrink-0"
          />
          <div className="min-w-0">
            <h1 className="font-semibold text-sm sm:text-base text-stone-950 truncate">{studyConfig.name}</h1>
            <p className="text-xs text-stone-600">{getProgressDisplay()}</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4">
        {interviewHistory.map(msg => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[92%] sm:max-w-[80%] rounded-2xl p-3 sm:p-4 ${
                msg.role === 'user'
                  ? 'bg-stone-800 border border-stone-700 text-stone-50 rounded-br-md'
                  : 'bg-stone-50 border border-stone-300 text-stone-950 rounded-bl-md shadow-sm'
              }`}
            >
              <ReactMarkdown
                className={`text-sm sm:text-base leading-7 font-medium ${
                  msg.role === 'user'
                    ? 'text-stone-50 [&_*]:text-stone-50'
                    : 'text-stone-950 [&_*]:text-stone-950'
                }`}
              >
                {msg.content}
              </ReactMarkdown>
            </div>
          </div>
        ))}

        {isAiThinking && (
          <div className="flex justify-start">
            <div className="bg-stone-50 border border-stone-300 shadow-sm rounded-2xl p-4 text-stone-700">
              <Loader2 size={16} className="animate-spin" />
              <span className="ml-2 text-sm">Thinking...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {!isComplete && !isFinishing && (
        <div className="p-3 sm:p-4 border-t border-stone-300 bg-stone-100/95">
          <div className="flex gap-2 sm:gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isAiThinking && handleSend()}
              placeholder="Type your response..."
              disabled={isAiThinking}
              className="min-w-0 flex-1 px-3 sm:px-4 py-3 bg-stone-50 border border-stone-400 text-stone-950 rounded-xl placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-stone-500"
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isAiThinking}
              className="p-3 bg-stone-800 hover:bg-stone-700 text-white rounded-xl flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default InterviewChat;
