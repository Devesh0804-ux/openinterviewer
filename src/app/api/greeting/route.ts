import { NextResponse } from "next/server";
import { getInterviewProvider } from "@/lib/providers";

export async function POST(req: Request) {
  try {
    const { studyConfig } = await req.json();

    const provider = getInterviewProvider(studyConfig);
    await provider.getInterviewGreeting(studyConfig);

    // Only ask to start the interview
    const greeting = "Hello! I'm your AI interviewer. Should we start the interview?";

    return NextResponse.json({
      message: greeting
    });

  } catch (error) {
    console.error("Greeting Error:", error);

    return NextResponse.json({
      message: "Hello! I'm your AI interviewer. Should we start the interview?"
    });
  }
}