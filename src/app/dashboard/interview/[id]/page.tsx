'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useStore } from '@/store';
import InterviewDetail from '@/components/InterviewDetail';

export default function InterviewDetailPage() {

  const params = useParams();
  const router = useRouter();
  const { viewMode } = useStore();

  const id = params.id as string;

  useEffect(() => {
    // Only admin allowed
    if (viewMode !== 'admin' && viewMode !== 'researcher') {
      router.replace('/dashboard');
    }
  }, [viewMode]);

  if (viewMode !== 'admin' && viewMode !== 'researcher') {
    return null;
  }

  return <InterviewDetail interviewId={id} />;
}