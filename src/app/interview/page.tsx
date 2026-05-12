'use client';

import { useEffect } from 'react';
import InterviewChat from '@/components/InterviewChat';
import { useStore } from '@/store';

export default function InterviewPage() {
  const { setViewMode, setAiThinking } = useStore();

  useEffect(() => {
    setViewMode('participant');
    setAiThinking(false); // force reset spinner
  }, []);

  return <InterviewChat />;
}