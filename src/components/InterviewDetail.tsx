'use client';

import React, { useEffect, useState } from 'react';
import { useRef } from 'react';
import jsPDF from "jspdf";
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { StoredInterview } from '@/types';
import ReactMarkdown from 'react-markdown';
import {
  Loader2,
  ArrowLeft,
  Download,
  Clock,
  MessageSquare,
  User,
  Bot,
  Target,
  TrendingUp,
  Lightbulb,
  AlertTriangle
} from 'lucide-react';

interface InterviewDetailProps {
  interviewId: string;
}

const InterviewDetail: React.FC<InterviewDetailProps> = ({ interviewId }) => {
  const router = useRouter();
  const loaded = useRef(false);
  const [interview, setInterview] = useState<StoredInterview | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'transcript' | 'analysis'>('transcript');

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    loadInterview();
  }, [interviewId]);

  const loadInterview = async () => {
  setLoading(true);
  try {
    const res = await fetch(`/api/interviews/${interviewId}`, {
      cache: "no-store"
    });

    if (!res.ok) {
      throw new Error('Failed to fetch interview');
    }

    const data = await res.json();
    setInterview(data.interview || data);
  } catch (error) {
    console.error('Error loading interview:', error);
    setInterview(null);
  } finally {
    setLoading(false);
  }
};


  const handleDownloadJSON = () => {
    if (!interview) return;

    const doc = new jsPDF();

    const jsonText = JSON.stringify(interview, null, 2);

    const lines = doc.splitTextToSize(jsonText, 180);

    doc.text(lines, 10, 10);

    doc.save(`interview-${interview.id}.pdf`);
    };

  const handleDownloadTranscript = () => {
    if (!interview) return;

    const nameField = interview.participantProfile?.fields?.find(
      (f: any) => f.fieldId?.toLowerCase().includes("name")
    );

    const participantName =
      interview.participantProfile?.fields?.find(
        (f: any) => f.fieldId === "name"
      )?.value || "Participant";

    const doc = new jsPDF();
    let y = 20;
    let pageNumber = 1;

    // ===== LOGO =====
    const logo = "/bharattech-logo.png";

    doc.addImage(logo, "PNG", 10, 10, 45, 20);

    // ===== HEADER =====
    doc.setFontSize(18);
    doc.text("Interview Research Report", 65, 20);

    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(
      `Generated on ${new Date().toLocaleDateString()}`,
      65,
      27
    );

    y = 40;

    // Divider
    doc.setDrawColor(200);
    doc.line(10, y, 200, y);

    y += 10;

    // ===== PARTICIPANT NAME (HEADER) =====

    // add to PDF
    doc.setFontSize(16);
    doc.setTextColor(0);
    doc.text(`Participant: ${participantName}`, 10, y);

    y += 10;

    // Divider
    doc.setDrawColor(220);
    doc.line(10, y, 200, y);

    y += 10;

    // ===== ANALYSIS =====

    if (interview.synthesis) {

      doc.setFontSize(14);
      doc.text("Analysis", 10, y);

      y += 8;

      doc.setFontSize(11);

      const insight = doc.splitTextToSize(
        interview.synthesis.bottomLine,
        180
      );

      doc.text("Key Insight:", 10, y);
      y += 6;

      doc.text(insight, 10, y);

      y += insight.length * 6 + 6;

      interview.synthesis.keyInsights?.forEach((item) => {

        const lines = doc.splitTextToSize(`• ${item}`, 180);

        if (y + lines.length * 6 > 280) {
          doc.addPage();
          pageNumber++;
          y = 20;
        }

        doc.text(lines, 10, y);

        y += lines.length * 6;
      });

      y += 10;

      doc.line(10, y, 200, y);

      y += 10;
    }

    // ===== TRANSCRIPT =====

    doc.setFontSize(14);
    doc.text("Interview Transcript", 10, y);

    y += 10;

    doc.setFontSize(11);

    interface Message {
      role: 'user' | 'assistant';
      content: string;
    }

      interview.messages?.forEach((msg: Message) => {

        const role = msg.role === "user" ? "Participant" : "Interviewer";

        const lines = doc.splitTextToSize(`${role}: ${msg.content}`, 180);

        if (y + lines.length * 6 > 280) {

          doc.setFontSize(9);
          doc.text(`Page ${pageNumber}`, 180, 290);

          doc.addPage();
          pageNumber++;

          y = 20;
        }

        doc.text(lines, 10, y);

        y += lines.length * 6 + 3;
      });

    // ===== FINAL PAGE NUMBER =====

    doc.setFontSize(9);
    doc.text(`Page ${pageNumber}`, 180, 290);

    doc.save(`research-report-${interview._id}.pdf`);
  };

  const toValidDate = (value: unknown): Date | null => {
    if (!value) return null;
    const date = new Date(value as string | number | Date);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const formatDuration = (start: unknown, end: unknown) => {
    const startDate = toValidDate(start);
    const endDate = toValidDate(end);

    if (!startDate || !endDate) return 'Unknown duration';

    const diff = endDate.getTime() - startDate.getTime();

    return `${Math.max(0, Math.round(diff / 1000 / 60))} minutes`;
  };

  const formatDate = (value: unknown) => {
    const date = toValidDate(value);
    if (!date) return 'Unknown date';

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const isPlaceholderAnalysis = (value: unknown) => {
    return typeof value === 'string' &&
      /analysis pending|synthesis in progress|no .* extracted yet/i.test(value);
  };


  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 size={48} className="animate-spin text-gray-500" />
      </div>
    );
  }

  if (!interview) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-5 sm:p-8">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Interview Not Found</h1>
          <p className="text-gray-500 mb-4">This interview may have been deleted.</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const nameField = interview?.participantProfile?.fields?.find(
    (f: any) => f.fieldId === "name"
  );

  const participantName = nameField?.value || "Participant";
  const synthesis = interview.synthesis;
  const statedPreferences = (synthesis?.statedPreferences || [])
    .filter(item => !isPlaceholderAnalysis(item));
  const revealedPreferences = (synthesis?.revealedPreferences || [])
    .filter(item => !isPlaceholderAnalysis(item));
  const themes = (synthesis?.themes || [])
    .filter(theme => !isPlaceholderAnalysis(theme.theme) && !isPlaceholderAnalysis(theme.evidence));
  const contradictions = synthesis?.contradictions || [];
  const keyInsights = (synthesis?.keyInsights || [])
    .filter(item => !isPlaceholderAnalysis(item));
  const bottomLine = synthesis?.bottomLine && !isPlaceholderAnalysis(synthesis.bottomLine)
    ? synthesis.bottomLine
    : keyInsights[0] || 'Analysis is being regenerated from the interview transcript.';

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-5 sm:p-6 lg:p-8">
      <div className="w-full max-w-5xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <button
            onClick={() => router.push('/dashboard')}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-4 transition-colors"
          >
            <ArrowLeft size={18} />
            Back to Dashboard
          </button>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2 break-words">{interview.studyName}</h1>
              <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-sm text-gray-500">
                <div className="flex items-center gap-1">
                  <Clock size={14} />
                  {formatDuration(interview.createdAt, interview.completedAt)}
                </div>
                <div className="flex items-center gap-1">
                  <MessageSquare size={14} />
                  {interview.messages?.length ?? 0} messages
                </div>
                <div>
                  {formatDate(interview.createdAt)}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleDownloadTranscript}
                className="w-full sm:w-auto px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white shadow-sm rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <Download size={16} />
                Download Report
              </button>
            </div>
          </div>
        </motion.div>

        {/* Participant Name */}
        <div className="mb-6 text-lg font-medium text-gray-900">
          Participant Name: {participantName}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('transcript')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'transcript'
                ? 'bg-blue-50 border border-blue-200 text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Transcript
          </button>
          <button
            onClick={() => setActiveTab('analysis')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'analysis'
                ? 'bg-blue-50 border border-blue-200 text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Analysis
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'transcript' ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition"
          >
            <div className="space-y-4">
              {interview.messages?.map((msg: any, i: number) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[92%] sm:max-w-[80%] rounded-2xl p-3 sm:p-4 ${
                      msg.role === 'user'
                        ? 'bg-blue-50 border border-blue-200 text-gray-900 rounded-br-md'
                        : 'bg-gray-100 border border-gray-200 text-gray-900 rounded-bl-md'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2 text-xs text-gray-500">
                      {msg.role === 'assistant' ? (
                        <>
                          <Bot size={14} />
                          Interviewer
                        </>
                      ) : (
                        <>
                          <User size={14} />
                          Participant
                        </>
                      )}
                    </div>

                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown
                        className="
                          text-sm sm:text-base 
                          leading-7 
                          font-medium 
                          text-gray-900 
                          [&_*]:text-gray-900
                        "
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              ))}

            </div>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {synthesis ? (
              <>
                {/* Key Insight */}
                <div className="bg-blue-50 border border-blue-200 text-gray-900 rounded-xl p-4 sm:p-6">
                  <div className="flex items-center gap-2 mb-2 text-gray-500">
                    <Target size={18} />
                    <span className="text-sm font-medium uppercase tracking-wider">
                      Key Insight
                    </span>
                  </div>
                  <p className="text-lg sm:text-xl font-medium break-words">{bottomLine}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Stated vs Revealed */}
                  <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition">
                    <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <TrendingUp size={18} className="text-gray-500" />
                      Stated vs Revealed
                    </h3>

                    <div className="space-y-4">
                      <div>
                        <div className="text-xs font-medium text-gray-500 uppercase mb-2">
                          What they said
                        </div>
                        <div className="space-y-1">
                          {statedPreferences.length > 0 ? statedPreferences.map((item, i) => (
                            <div
                              key={i}
                              className="text-sm bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg"
                            >
                              {item}
                            </div>
                          )) : (
                            <div className="text-sm text-gray-500">No stated preferences extracted yet.</div>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-medium text-gray-500 uppercase mb-2">
                          What behavior revealed
                        </div>
                        <div className="space-y-1">
                          {revealedPreferences.length > 0 ? revealedPreferences.map((item, i) => (
                            <div
                              key={i}
                              className="text-sm bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg"
                            >
                              {item}
                            </div>
                          )) : (
                            <div className="text-sm text-gray-500">No revealed preferences extracted yet.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Themes */}
                  <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition">
                    <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <Lightbulb size={18} className="text-gray-500" />
                      Key Themes
                    </h3>

                    <div className="space-y-3">
                      {themes.length > 0 ? themes.map((theme, i) => (
                        <div key={i} className="border-b border-gray-200 pb-3 last:border-0">
                          <div className="font-medium text-gray-900">{theme.theme}</div>
                          <div className="text-sm text-gray-500 mt-1">{theme.evidence}</div>
                        </div>
                      )) : (
                        <div className="text-sm text-gray-500">No themes extracted yet.</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Contradictions */}
                {contradictions.length > 0 && (
                  <div className="bg-white border border-gray-200 shadow-sm rounded-xl p-4 sm:p-6">
                    <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <AlertTriangle size={18} className="text-gray-500" />
                      Potential Contradictions
                    </h3>
                    <ul className="space-y-2">
                      {contradictions.map((c, i) => (
                        <li key={i} className="text-gray-700 text-sm">
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Key Insights */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition">
                  <h3 className="font-semibold text-gray-900 mb-4">
                    Additional Insights
                  </h3>
                  <ul className="space-y-2">
                    {keyInsights.length > 0 ? keyInsights.map((insight, i) => (
                      <li key={i} className="flex items-start gap-2 text-gray-700">
                        <span className="text-gray-500 mt-1">-</span>
                        {insight}
                      </li>
                    )) : (
                      <li className="text-gray-500">No additional insights generated yet.</li>
                    )}
                  </ul>
                </div>
              </>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <p className="text-gray-500">
                  No analysis available for this interview.
                </p>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default InterviewDetail;
