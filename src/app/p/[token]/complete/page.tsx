'use client';

import { useParams } from 'next/navigation';

export default function CompletePage() {
  const params = useParams();
  const token = params.token;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-5">
      <div className="w-full max-w-md text-center px-5 sm:px-6 py-8 bg-white shadow-md rounded-xl">
        <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 mb-3">
          Interview Completed 🎉
        </h1>
        <p className="text-gray-600 text-sm">
          Thank you for participating in this research interview.
        </p>
      </div>
    </div>
  );
}
