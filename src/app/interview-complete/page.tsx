'use client';

export default function InterviewComplete() {
  return (
    <div className="min-h-screen bg-stone-900 flex items-center justify-center text-white px-4 py-5">
      <div className="text-center max-w-md">
        <h1 className="text-xl sm:text-2xl font-semibold mb-4">
          Interview Completed
        </h1>
        <p className="text-stone-400">
          Thank you for your time. Your responses have been recorded.
        </p>
      </div>
    </div>
  );
}
