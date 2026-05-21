import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import nodemailer from "nodemailer";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_TIMEOUT_MS = 12000;
const EMAIL_SUBJECT = "You're invited to BharatTech";

class EmailSendError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

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

function getConfiguredSender() {
  return process.env.EMAIL_FROM ||
    (process.env.EMAIL_USER ? `"BharatTech Team" <${process.env.EMAIL_USER}>` : "");
}

function getGmailCredentials() {
  const user = process.env.EMAIL_USER?.trim();
  const pass = process.env.EMAIL_PASS?.replace(/\s+/g, "");

  if (!user || !pass) {
    throw new EmailSendError(
      "Email is not configured. Set EMAIL_USER and EMAIL_PASS to a Gmail address and Gmail App Password.",
      503
    );
  }

  return { user, pass };
}

function getGmailApiCredentials() {
  const clientId = process.env.GMAIL_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN?.trim();
  const user = process.env.EMAIL_USER?.trim();

  if (!clientId || !clientSecret || !refreshToken || !user) {
    return null;
  }

  return { clientId, clientSecret, refreshToken, user };
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildMimeMessage(to: string, from: string, subject: string, text: string, html: string) {
  const boundary = `bharattech_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    html,
    "",
    `--${boundary}--`,
    ""
  ].join("\r\n");
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = EMAIL_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new EmailSendError("Gmail API request timed out. Please try again.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getGmailAccessToken() {
  const credentials = getGmailApiCredentials();
  if (!credentials) return null;

  const response = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token"
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.access_token) {
    throw new EmailSendError(
      data?.error_description || data?.error || "Failed to get Gmail API access token.",
      response.status || 500
    );
  }

  return {
    accessToken: String(data.access_token),
    user: credentials.user
  };
}

async function sendWithGmailApi(emailList: string[], linkUrl: string) {
  const tokenData = await getGmailAccessToken();
  if (!tokenData) return false;

  const from = getConfiguredSender();

  await Promise.all(emailList.map(async (email) => {
    const raw = encodeBase64Url(buildMimeMessage(
      email,
      from,
      EMAIL_SUBJECT,
      buildInvitationText(linkUrl, email),
      buildInvitationEmail(linkUrl, email)
    ));

    const response = await fetchWithTimeout("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenData.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ raw })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new EmailSendError(
        data?.error?.message || "Gmail API rejected the email request.",
        response.status || 500
      );
    }
  }));

  return true;
}

function createGmailTransport(port: 465 | 587) {
  const { user, pass } = getGmailCredentials();

  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port,
    secure: port === 465,
    requireTLS: port === 587,
    connectionTimeout: EMAIL_TIMEOUT_MS,
    greetingTimeout: EMAIL_TIMEOUT_MS,
    socketTimeout: EMAIL_TIMEOUT_MS,
    family: 4,
    auth: {
      user,
      pass,
    },
  } as nodemailer.TransportOptions);
}

function explainSmtpError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (/invalid login|authentication failed|username and password|EAUTH/i.test(message)) {
    return "Gmail authentication failed. Use a Gmail App Password for EMAIL_PASS, not your normal Gmail password.";
  }

  if (/timeout|ETIMEDOUT|ESOCKET|ECONNECTION|ECONNREFUSED|ENETUNREACH/i.test(message)) {
    return "Gmail SMTP connection timed out from Render. Add GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN to send through Gmail API over HTTPS, or enable outbound SMTP on your hosting service.";
  }

  return message || "Failed to send email through Gmail SMTP.";
}

async function sendWithGmailSmtp(emailList: string[], linkUrl: string) {
  const from = getConfiguredSender();
  let lastError: unknown = null;

  for (const port of [587, 465] as const) {
    try {
      const transporter = createGmailTransport(port);

      await Promise.all(
        emailList.map((email: string) =>
          transporter.sendMail({
            from,
            to: email,
            subject: EMAIL_SUBJECT,
            html: buildInvitationEmail(linkUrl, email),
            text: buildInvitationText(linkUrl, email),
          })
        )
      );

      return true;
    } catch (error) {
      console.error(`Gmail SMTP send failed on port ${port}:`, error);
      lastError = error;
    }
  }

  throw new EmailSendError(explainSmtpError(lastError), 504);
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
    const sentWithGmailApi = await sendWithGmailApi(emailList, linkUrl);

    if (!sentWithGmailApi) {
      await sendWithGmailSmtp(emailList, linkUrl);
    }

    return NextResponse.json({ success: true, sent: emailList.length });
  } catch (error) {
    console.error("Email error:", error);

    if (error instanceof EmailSendError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send emails" },
      { status: 500 }
    );
  }
}
