'use client';

import { useEffect } from 'react';
import { useStore } from '@/store';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { viewMode, setViewMode } = useStore();

  useEffect(() => {
    if (viewMode !== 'researcher' && viewMode !== 'admin') {
      setViewMode('researcher');
    }
  }, [viewMode, setViewMode]);

  return <>{children}</>;
}
