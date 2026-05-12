import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export async function POST(req: Request) {
  try {
    const { emails, link } = await req.json();

    if (!emails || emails.length === 0) {
      return NextResponse.json(
        { error: "No emails provided" },
        { status: 400 }
      );
    }

    // ✅ Gmail transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // ✅ Send to ALL participants
    const promises = emails.map((email: string) =>
      transporter.sendMail({
        from: `"Research Team" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Interview Invitation",
        html: `
          <div style="font-family: Arial; line-height:1.6">
            <h2>Interview Invitation</h2>

            <p>You are invited to participate in our research interview.</p>

            <a href="${link}" 
              style="
              background:#111;
              color:white;
              padding:10px 18px;
              text-decoration:none;
              border-radius:6px;
              display:inline-block;
              margin-top:10px
              ">
              Start Interview
            </a>

            <p style="margin-top:20px">
              Or open this link:
              <br/>
              ${link}
            </p>

            <p>Thank you.</p>
          </div>
        `,
      })
    );

    await Promise.all(promises);

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error("Email error:", error);
    return NextResponse.json(
      { error: "Failed to send emails" },
      { status: 500 }
    );
  }
}