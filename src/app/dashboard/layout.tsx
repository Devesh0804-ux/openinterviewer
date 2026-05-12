'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/store';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { viewMode } = useStore();

  useEffect(() => {
    if (viewMode !== 'researcher' && viewMode !== 'admin') {
      router.replace('/login');
    }
  }, [viewMode]);

  if (viewMode !== 'researcher' && viewMode !== 'admin') {
    return null;
  }

  return <>{children}</>;
}