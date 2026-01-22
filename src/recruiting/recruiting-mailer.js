import sgMail from "@sendgrid/mail";

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export async function sendEmail({ to, subject, text }) {
  if (!to) throw new Error("Missing recipient");

  const msg = {
    to,
    from: process.env.MAIL_FROM,
    replyTo: process.env.MAIL_REPLY_TO,
    subject,
    text
  };

  await sgMail.send(msg);
}
