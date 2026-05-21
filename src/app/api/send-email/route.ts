import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_TIMEOUT_MS = 12000;
const EMAIL_SUBJECT = "You're invited to BharatTech";
const HOSTED_SMTP_DISABLED =
  process.env.RENDER === "true" || Boolean(process.env.RENDER_SERVICE_ID);

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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildInvitationText(link: string) {
  return `Hi,

You have been invited to participate in a BharatTech research interview.

Interview Link: ${link}

Please open the link above to start your interview.

Regards,
BharatTech Team`;
}

function buildInvitationEmail(link: string) {
  const safeLink = escapeHtml(link);

  return `
    <div style="font-family: Arial, sans-serif; line-height:1.5; color:#202124; font-size:14px; white-space:pre-line">Hi,

You have been invited to participate in a BharatTech research interview.

Interview Link: <a href="${safeLink}" style="color:#1155cc">${safeLink}</a>

Please open the link above to start your interview.

Regards,
BharatTech Team
    </div>
  `;
}

function getConfiguredSender() {
  const emailFrom = stripEnvQuotes(process.env.EMAIL_FROM);
  const emailUser = stripEnvQuotes(process.env.EMAIL_USER);

  if (emailFrom?.includes("@")) {
    return emailFrom;
  }

  if (emailFrom && emailUser) {
    return `"${emailFrom.replace(/"/g, "")}" <${emailUser}>`;
  }

  return emailUser ? `"BharatTech Team" <${emailUser}>` : "";
}

function hasResendCredentials() {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

function hasGmailSmtpCredentials() {
  return Boolean(process.env.EMAIL_USER?.trim() && process.env.EMAIL_PASS?.trim());
}

function hasGmailApiCredentials() {
  return Boolean(
    process.env.GMAIL_CLIENT_ID?.trim() &&
    process.env.GMAIL_CLIENT_SECRET?.trim() &&
    process.env.GMAIL_REFRESH_TOKEN?.trim() &&
    process.env.EMAIL_USER?.trim()
  );
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

function stripEnvQuotes(value: string | undefined) {
  return value?.trim().replace(/^['"]|['"]$/g, "");
}

function getGmailApiCredentials() {
  const clientId = stripEnvQuotes(process.env.GMAIL_CLIENT_ID);
  const clientSecret = stripEnvQuotes(process.env.GMAIL_CLIENT_SECRET);
  const refreshToken = stripEnvQuotes(process.env.GMAIL_REFRESH_TOKEN);
  const user = stripEnvQuotes(process.env.EMAIL_USER);

  if (!clientId || !clientSecret || !refreshToken || !user) {
    return null;
  }

  return { clientId, clientSecret, refreshToken, user };
}

function getResendCredentials() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = getConfiguredSender();

  if (!apiKey) {
    return null;
  }

  if (!from) {
    throw new EmailSendError(
      "Email sender is not configured. Set EMAIL_FROM to a verified sender address.",
      503
    );
  }

  return { apiKey, from };
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
      explainGmailApiAuthError(data?.error_description || data?.error),
      502
    );
  }

  return {
    accessToken: String(data.access_token),
    user: credentials.user
  };
}

function explainGmailApiAuthError(message: unknown) {
  const rawMessage = typeof message === "string" ? message : "";

  if (/unauthorized|invalid_client|invalid_grant|invalid/i.test(rawMessage)) {
    return "Gmail API authentication failed. Generate a new Gmail refresh token for the configured OAuth client, then update GMAIL_REFRESH_TOKEN on Render.";
  }

  return rawMessage || "Failed to get Gmail API access token.";
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
      buildInvitationText(linkUrl),
      buildInvitationEmail(linkUrl)
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
        response.status === 401
          ? "Gmail API authentication failed. Reconnect the Gmail OAuth credentials."
          : data?.error?.message || "Gmail API rejected the email request.",
        response.status === 401 ? 502 : response.status || 500
      );
    }
  }));

  return true;
}

async function sendWithResend(emailList: string[], linkUrl: string) {
  const credentials = getResendCredentials();
  if (!credentials) return false;

  const resend = new Resend(credentials.apiKey);

  await Promise.all(emailList.map(async (email) => {
    const { error } = await resend.emails.send({
      from: credentials.from,
      to: email,
      subject: EMAIL_SUBJECT,
      html: buildInvitationEmail(linkUrl),
      text: buildInvitationText(linkUrl),
    });

    if (error) {
      throw new EmailSendError(
        error.message || "Resend rejected the email request.",
        502
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
    return "Gmail SMTP is not reachable from this hosting environment. Use Gmail API OAuth or Resend instead.";
  }

  return message || "Failed to send email through Gmail SMTP.";
}

async function sendWithGmailSmtp(emailList: string[], linkUrl: string) {
  if (HOSTED_SMTP_DISABLED) {
    throw new EmailSendError(
      "Gmail SMTP is disabled on Render. Use Gmail API OAuth or Resend instead.",
      503
    );
  }

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
            html: buildInvitationEmail(linkUrl),
            text: buildInvitationText(linkUrl),
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

function summarizeProviderError(provider: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return `${provider}: ${message}`;
}

function getEmailSetupMessage(providerErrors: string[]) {
  if (hasResendCredentials()) {
    return "Email sending is not configured correctly. Check RESEND_API_KEY and make sure EMAIL_FROM is a verified sender.";
  }

  if (hasGmailApiCredentials()) {
    return "Email sending is not configured correctly. The Gmail OAuth refresh token is invalid or expired. Create a new refresh token with the Gmail send scope and update GMAIL_REFRESH_TOKEN on Render.";
  }

  if (HOSTED_SMTP_DISABLED && hasGmailSmtpCredentials()) {
    return "Email sending is not configured correctly. Render cannot use Gmail SMTP here, so configure Gmail API OAuth or Resend.";
  }

  if (providerErrors.length > 0) {
    return "Email sending failed. Check the configured email provider credentials.";
  }

  return "Email is not configured. Set RESEND_API_KEY and EMAIL_FROM, or configure Gmail API OAuth with GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, and EMAIL_USER.";
}

async function sendInvitations(emailList: string[], linkUrl: string) {
  const providerErrors: string[] = [];

  if (hasResendCredentials()) {
    try {
      if (await sendWithResend(emailList, linkUrl)) return;
    } catch (error) {
      console.error("Resend send failed:", error);
      providerErrors.push(summarizeProviderError("Resend", error));
    }
  }

  // Gmail fallback is intentionally disabled for now.
  // Keep this code here so it can be re-enabled later if Gmail OAuth/SMTP is needed.
  //
  // if (hasGmailApiCredentials()) {
  //   try {
  //     if (await sendWithGmailApi(emailList, linkUrl)) return;
  //   } catch (error) {
  //     console.error("Gmail API send failed:", error);
  //     providerErrors.push(summarizeProviderError("Gmail API", error));
  //   }
  // }
  //
  // if (hasGmailSmtpCredentials()) {
  //   try {
  //     if (await sendWithGmailSmtp(emailList, linkUrl)) return;
  //   } catch (error) {
  //     console.error("Gmail SMTP send failed:", error);
  //     providerErrors.push(summarizeProviderError("Gmail SMTP", error));
  //   }
  // }

  if (providerErrors.length > 0) {
    throw new EmailSendError(getEmailSetupMessage(providerErrors), 502);
  }

  throw new EmailSendError(getEmailSetupMessage(providerErrors), 503);
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

    let url: URL;
    try {
      url = new URL(link);
    } catch {
      return NextResponse.json(
        { error: "Interview link must be a valid web URL" },
        { status: 400 }
      );
    }

    if (!["http:", "https:"].includes(url.protocol)) {
      return NextResponse.json(
        { error: "Interview link must be a valid web URL" },
        { status: 400 }
      );
    }

    const linkUrl = url.toString();
    await sendInvitations(emailList, linkUrl);

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
