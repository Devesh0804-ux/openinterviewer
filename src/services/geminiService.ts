export async function getInterviewGreeting(
  studyConfig: any,
  token?: string
) {
  const res = await fetch('/api/greeting', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ studyConfig })
  });

  if (!res.ok) {
    throw new Error('Failed to fetch greeting');
  }

  const data = await res.json();

  return data.message; // 🔥 MUST return string only
}
