'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import Link from "next/link";
import { StoredInterview, StoredStudy } from '@/types';
import { useStore } from '@/store';
import { getAllInterviews, exportAllInterviews, getStudyInterviews, getAllStudies } from '@/services/storageService';
import {
  Loader2,
  FileText,
  Download,
  Eye,
  Clock,
  MessageSquare,
  Lightbulb,
  ArrowLeft,
  FolderOpen,
  LogOut,
  Filter,
  BookOpen,
  Copy,
  Check,
  Mail
} from 'lucide-react';

const Dashboard: React.FC = () => {
  const router = useRouter();
  const [interviews, setInterviews] = useState<StoredInterview[]>([]);
  const [studies, setStudies] = useState<StoredStudy[]>([]);
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [participantEmail, setParticipantEmail] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const { viewMode } = useStore();
  const loadedStudies = React.useRef(false);
  const loadedInterviews = React.useRef(false);

  const generateLink = async () => {

    if (!selectedStudyId) {
      alert("Please select a study first.");
      return;
    }

    // Call your existing token generation API
    const res = await fetch('/api/participant-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studyId: selectedStudyId })
    });

    if (!res.ok) {
      const error = await res.json();
      console.error(error);
      throw Error("Failed to generate token");
    }

    const data = await res.json();
    const fullLink = `${window.location.origin}/p/${data.token}`;
    setLink(fullLink);
    setLinkCopied(false);
    setEmailStatus(null);
  };

  const handleCopyLink = async () => {
    if (!link) return;

    try {
      await navigator.clipboard.writeText(link);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setEmailStatus({ type: 'error', message: 'Could not copy link. Select the link and copy it manually.' });
    }
  };

  const handleSendEmail = async () => {
    if (!link) {
      setEmailStatus({ type: 'error', message: 'Generate an interview link before sending email.' });
      return;
    }

    if (!participantEmail.trim()) {
      setEmailStatus({ type: 'error', message: 'Enter at least one participant email.' });
      return;
    }

    const emailList = participantEmail
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);

    if (emailList.length === 0) {
      setEmailStatus({ type: 'error', message: 'Enter at least one valid email address.' });
      return;
    }

    setEmailSending(true);
    setEmailStatus(null);

    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          emails: emailList,
          link: link
        })
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setEmailStatus({ type: 'success', message: `Email sent to ${emailList.length} participant${emailList.length === 1 ? '' : 's'}.` });
        setParticipantEmail("");
      } else {
        setEmailStatus({ type: 'error', message: data.error || "Failed to send email." });
      }
    } catch (error) {
      console.error(error);
      setEmailStatus({ type: 'error', message: "Error sending email. Please try again." });
    } finally {
      setEmailSending(false);
    }
  };


  // Load studies on mount
  useEffect(() => {
    loadStudies();
  }, []);

  // Load interviews when study filter changes
  useEffect(() => {
    loadInterviews(selectedStudyId);
  }, [selectedStudyId]);

  useEffect(() => {

    const handleNewInterview = () => {
      loadInterviews(selectedStudyId);
    };

    window.addEventListener("interviewCompleted", handleNewInterview);

    return () => {
      window.removeEventListener("interviewCompleted", handleNewInterview);
    };

  }, [selectedStudyId]);

  const loadStudies = async () => {
    try {
      const { studies: data } = await getAllStudies();
      setStudies(data);
    } catch (error) {
      console.error('Error loading studies:', error);
    }
  };

  const loadInterviews = async (studyId: string | null, showLoader = true) => {
    if (loadedInterviews.current && !studyId) return;
    if (showLoader) setLoading(true);

    try {
      const data = studyId
        ? await getStudyInterviews(studyId)
        : await getAllInterviews();

      setInterviews(data);
    } catch (error) {
      console.error('Error loading interviews:', error);
    } finally {
      if (showLoader) setLoading(false);
    }
  };

  const handleExportAll = async () => {
    setExporting(true);
    try {
      const blob = await exportAllInterviews();
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `interviews-export-${Date.now()}.zip`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Error exporting:', error);
    } finally {
      setExporting(false);
    }
  };

  const handleViewInterview = (id: string) => {
    router.push(`/dashboard/interview/${id}`);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth', { method: 'DELETE' });
      router.push('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const toTimestamp = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value instanceof Date) {
      const timestamp = value.getTime();
      return Number.isFinite(timestamp) ? timestamp : null;
    }
    if (typeof value === 'string') {
      const timestamp = new Date(value).getTime();
      return Number.isFinite(timestamp) ? timestamp : null;
    }
    return null;
  };

  const formatDuration = (start: unknown, end: unknown) => {
    const startTime = toTimestamp(start);
    const endTime = toTimestamp(end);
    if (!startTime || !endTime || endTime < startTime) return '0 min';

    const minutes = Math.round((endTime - startTime) / 1000 / 60);
    return `${minutes} min`;
  };

  const formatDate = (value: unknown) => {
    const timestamp = toTimestamp(value);
    if (!timestamp) return 'Unknown date';

    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getProfileSummary = (interview: StoredInterview) => {
    const fields = Array.isArray(interview.participantProfile?.fields)
      ? interview.participantProfile.fields
      : [];

    return fields
      .filter(f => f.status === 'extracted' && f.value)
      .slice(0, 3)
      .map(f => f.value)
      .join(' • ');
  };

  const getMessageCount = (interview: StoredInterview) => {
    if (Array.isArray(interview.messages)) return interview.messages.length;
    if (Array.isArray(interview.transcript)) return interview.transcript.length;
    if (Array.isArray(interview.history)) return interview.history.length;
    return 0;
  };

  const getStatus = (interview: StoredInterview) => (
    interview.status || (interview.completedAt ? 'completed' : 'in_progress')
  );

  const getStatusBadgeClass = (interview: StoredInterview) => {
    const status = getStatus(interview);

    if (status === 'terminated') {
      return 'bg-red-900/40 text-red-300 border border-red-800/60';
    }

    if (status === 'completed') {
      return 'bg-stone-700 text-stone-300';
    }

    return 'bg-stone-600 text-stone-200';
  };

  return (
    <div className="min-h-screen bg-stone-900 px-4 py-5 sm:p-6 lg:p-8">
      <div className="w-full max-w-5xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-stone-700 flex items-center justify-center flex-shrink-0">
                <FolderOpen className="text-stone-300" size={20} />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl sm:text-3xl font-bold leading-tight text-white break-words">Interview Dashboard</h1>
                <p className="text-stone-400">
                  {interviews.length} interview{interviews.length !== 1 ? 's' : ''} collected
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:justify-end">
              <button
                onClick={() => router.push('/studies')}
                className="px-3 sm:px-4 py-2 text-sm bg-stone-700 hover:bg-stone-600 text-stone-300 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <BookOpen size={16} />
                My Studies
              </button>
              <button
                onClick={() => router.push('/setup')}
                className="px-3 sm:px-4 py-2 text-sm bg-stone-700 hover:bg-stone-600 text-stone-300 rounded-xl transition-colors flex items-center justify-center gap-2"
              >

                <ArrowLeft size={16} />
                Back to Setup
              </button>
              {interviews.length > 0 && (
                <button
                  onClick={handleExportAll}
                  disabled={exporting}
                  className="px-3 sm:px-4 py-2 text-sm bg-stone-600 hover:bg-stone-500 text-white rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {exporting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Download size={16} />
                  )}
                  Export All
                </button>
              )}
              <button
                onClick={handleLogout}
                className="px-3 sm:px-4 py-2 text-sm border border-stone-600 text-stone-400 hover:bg-stone-700 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <LogOut size={16} />
                Logout
              </button>
            </div>
          </div>
        </motion.div>

        {/* Generate Participant Link */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-8 bg-stone-800/50 border border-stone-700 rounded-xl p-4 sm:p-6"
        >
          <h2 className="text-white font-semibold mb-4">Invite Participant</h2>

          <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap">
            <button
              onClick={generateLink}
              disabled={!selectedStudyId}
              className="px-4 py-2 bg-stone-600 hover:bg-stone-500 text-white rounded-xl disabled:opacity-50"
            >
              Generate Interview Link
            </button>

            {link && (
              <>
                <input
                  value={link}
                  readOnly
                  className="w-full min-w-0 sm:flex-1 px-3 py-2 bg-stone-900 border border-stone-600 text-stone-300 rounded-xl"
                />

                <button
                  onClick={handleCopyLink}
                  className="px-4 py-2 bg-stone-700 text-stone-300 rounded-xl"
                >
                  {linkCopied ? (
                    <Check size={16} className="inline-block mr-1 text-green-400" />
                  ) : (
                    <Copy size={16} className="inline-block mr-1" />
                  )}
                  {linkCopied ? 'Copied!' : 'Copy'}
                </button>

                <input
                  type="email"
                  placeholder="Participant email"
                  value={participantEmail}
                  onChange={(e) => setParticipantEmail(e.target.value)}
                  className="w-full sm:w-auto px-3 py-2 bg-stone-900 border border-stone-600 text-stone-300 rounded-xl"
                />

                <button
                  onClick={handleSendEmail}
                  disabled={emailSending}
                  className="px-4 py-2 bg-stone-600 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {emailSending ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                  {emailSending ? 'Sending...' : 'Send via Email'}
                </button>
              </>
            )}
          </div>

          {emailStatus && (
            <p className={`mt-3 text-sm ${emailStatus.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
              {emailStatus.message}
            </p>
          )}
        </motion.div>

        {/* Warning */}
        {warning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-6 p-4 bg-stone-800 border border-stone-600 rounded-xl text-stone-300 text-sm"
          >
            {warning}
          </motion.div>
        )}

        {/* Study Filter */}
        {studies.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-6 flex flex-wrap items-center gap-3"
          >
            <Filter size={16} className="text-stone-500" />
            <select
              value={selectedStudyId || ''}
              onChange={(e) => setSelectedStudyId(e.target.value || null)}
              className="w-full sm:w-auto min-w-0 px-4 py-2 bg-stone-800 border border-stone-700 rounded-xl text-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-500"
            >
              <option value="">All Studies</option>
              {studies.map((study) => (
                <option key={study.id} value={study.id}>
                  {study.config.name} ({study.interviewCount} interviews)
                </option>
              ))}
            </select>
            {selectedStudyId && (
              <button
                onClick={() => setSelectedStudyId(null)}
                className="text-sm text-stone-500 hover:text-stone-400"
              >
                Clear filter
              </button>
            )}
          </motion.div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={48} className="animate-spin text-stone-400" />
          </div>
        ) : interviews.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-stone-800/50 rounded-2xl border border-stone-700 p-6 sm:p-12 text-center"
          >
            <div className="w-16 h-16 rounded-full bg-stone-800 flex items-center justify-center mx-auto mb-4">
              <FileText size={32} className="text-stone-500" />
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">No Interviews Yet</h2>
            <p className="text-stone-400 mb-6">
              Interviews will appear here. Share participant links to start collecting data.
            </p>
            <div className="flex flex-col items-center gap-4">
              <button
                onClick={generateLink}
                className="px-6 py-3 bg-stone-600 hover:bg-stone-500 text-white rounded-xl transition-colors"
              >
                Generate Participant Link
              </button>

              {link && (
                <div className="w-full max-w-lg bg-stone-800 border border-stone-700 rounded-xl p-4 text-sm text-stone-300 break-all">
                  {link}
                  <button
                    onClick={handleCopyLink}
                    className="mt-3 px-4 py-2 bg-stone-700 hover:bg-stone-600 text-white rounded-lg"
                  >
                    {linkCopied ? 'Copied!' : 'Copy Link'}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        ) : (
          <div className="space-y-4">
            {interviews.map((interview, index) => (
              <motion.div
                key={interview.id || interview._id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-stone-800/50 rounded-xl border border-stone-700 p-4 sm:p-6 hover:border-stone-600 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
                      <h3 className="font-semibold text-white break-words">
                        {interview.participantName || "Unknown Participant"}
                      </h3>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${getStatusBadgeClass(interview)}`}>
                        {getStatus(interview).replace('_', ' ')}
                      </span>
                    </div>

                    {/* Participant info */}
                    {getProfileSummary(interview) && (
                      <div className="text-sm text-stone-400 mb-3">
                        {getProfileSummary(interview)}
                      </div>
                    )}

                    {/* Key insight */}
                    {interview.synthesis?.bottomLine && (
                      <div className="flex items-start gap-2 text-sm text-stone-300 bg-stone-800 rounded-lg p-3 mb-3">
                        <Lightbulb size={16} className="text-stone-400 flex-shrink-0 mt-0.5" />
                        <span className="line-clamp-2">{interview.synthesis.bottomLine}</span>
                      </div>
                    )}

                    {/* Stats */}
                    <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs text-stone-500">
                      <div className="flex items-center gap-1">
                        <Clock size={12} />
                        {formatDuration(interview.createdAt, interview.completedAt)}
                      </div>
                      <div className="flex items-center gap-1">
                        <MessageSquare size={12} />
                        {getMessageCount(interview)} messages
                      </div>
                      <div>
                        {formatDate(interview.createdAt)}
                      </div>
                    </div>
                  </div>
                  <Link
                    href={`/dashboard/interview/${interview.id || interview._id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="p-2 text-stone-400 hover:text-stone-300 transition-colors"
                  >
                    <Eye size={20} />
                  </Link>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
