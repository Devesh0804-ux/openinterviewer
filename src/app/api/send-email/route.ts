import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import nodemailer from "nodemailer";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function verifyAuth() {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (!authCookie?.value) {
    return false;
  }

  return verifySessionToken(authCookie.value);
}

function buildInvitationEmail(link: string) {
  return `
    <div style="font-family: Arial, sans-serif; line-height:1.6; color:#111">
      <h2>Interview Invitation</h2>
      <p>You are invited to participate in our research interview.</p>
      <a href="${link}"
        style="background:#111;color:white;padding:10px 18px;text-decoration:none;border-radius:6px;display:inline-block;margin-top:10px">
        Start Interview
      </a>
      <p style="margin-top:20px">
        Or open this link:<br/>
        <a href="${link}">${link}</a>
      </p>
      <p>Thank you.</p>
    </div>
  `;
}

export async function POST(req: Request) {
  try {
    const isAuthorized = await verifyAuth();
    if (!isAuthorized) {
      return NextResponse.json(
        { error: "Login required to send interview invitations." },
        { status: 401 }
      );
    }

    const { emails, link } = await req.json();
    const emailList = Array.isArray(emails)
      ? emails.map((email: unknown) => String(email).trim()).filter(Boolean)
      : [];

    if (emailList.length === 0) {
      return NextResponse.json(
        { error: "No emails provided" },
        { status: 400 }
      );
    }

    const invalidEmail = emailList.find((email: string) => !emailPattern.test(email));
    if (invalidEmail) {
      return NextResponse.json(
        { error: `Invalid email address: ${invalidEmail}` },
        { status: 400 }
      );
    }

    if (!link || typeof link !== "string") {
      return NextResponse.json(
        { error: "Interview link is required" },
        { status: 400 }
      );
    }

    const url = new URL(link);
    if (!["http:", "https:"].includes(url.protocol)) {
      return NextResponse.json(
        { error: "Interview link must be a valid web URL" },
        { status: 400 }
      );
    }

    const html = buildInvitationEmail(url.toString());

    if (process.env.RESEND_API_KEY) {
      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);

      const result = await resend.emails.send({
        from: process.env.EMAIL_FROM || "Research Team <onboarding@resend.dev>",
        to: emailList,
        subject: "Interview Invitation",
        html,
      });

      if (result.error) {
        throw new Error(result.error.message);
      }
    } else if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      await Promise.all(
        emailList.map((email: string) =>
          transporter.sendMail({
            from: process.env.EMAIL_FROM || `"Research Team" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "Interview Invitation",
            html,
          })
        )
      );
    } else {
      return NextResponse.json(
        { error: "Email is not configured. Set RESEND_API_KEY or EMAIL_USER and EMAIL_PASS." },
        { status: 503 }
      );
    }

    return NextResponse.json({ success: true, sent: emailList.length });
  } catch (error) {
    console.error("Email error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send emails" },
      { status: 500 }
    );
  }
}
