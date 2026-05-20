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

function buildInvitationEmail(link: string, recipientEmail: string) {
  const displayName = recipientEmail.split('@')[0] || 'Participant';

  return `
    <div style="font-family: Arial, sans-serif; line-height:1.6; color:#202124; font-size:14px">
      <p>Hi ${displayName},</p>

      <p>You have been invited to participate in a BharatTech research interview.</p>

      <p>
        Interview Link:
        <a href="${link}" style="color:#1155cc">${link}</a>
      </p>

      <p>Please open the link above to start your interview.</p>

      <p>
        Regards,<br/>
        BharatTech Team
      </p>
    </div>
  `;
}

function buildInvitationText(link: string, recipientEmail: string) {
  const displayName = recipientEmail.split('@')[0] || 'Participant';

  return `Hi ${displayName},

You have been invited to participate in a BharatTech research interview.

Interview Link: ${link}

Please open the link above to start your interview.

Regards,
BharatTech Team`;
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

    const linkUrl = url.toString();

    if (process.env.RESEND_API_KEY) {
      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);

      const result = await resend.emails.send({
        from: process.env.EMAIL_FROM || "Research Team <onboarding@resend.dev>",
        to: emailList,
        subject: "You're invited to BharatTech",
        html: buildInvitationEmail(linkUrl, emailList[0]),
        text: buildInvitationText(linkUrl, emailList[0]),
      });

      if (result.error) {
        throw new Error(result.error.message);
      }
    } else if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        family: 4,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      } as nodemailer.TransportOptions);

      await Promise.all(
        emailList.map((email: string) =>
          transporter.sendMail({
            from: process.env.EMAIL_FROM || `"Research Team" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "You're invited to BharatTech",
            html: buildInvitationEmail(linkUrl, email),
            text: buildInvitationText(linkUrl, email),
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
