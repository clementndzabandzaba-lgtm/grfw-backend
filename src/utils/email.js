const { Resend }    = require('resend')
const nodemailer    = require('nodemailer')

let resend = null

function getClient() {
  if (resend) return resend
  if (!process.env.RESEND_API_KEY) return null
  resend = new Resend(process.env.RESEND_API_KEY)
  return resend
}

/**
 * Send the password reset OTP to the user's email.
 */
async function sendResetCode(toEmail, code, name = 'there') {
  const client = getClient()

  if (!client) {
    console.log(`  [EMAIL] Code for ${toEmail}: ${code}  (add RESEND_API_KEY to .env to send real emails)`)
    return { sent: false }
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family:Arial,sans-serif;background:#f0e8ff;padding:40px 0;margin:0">
      <div style="max-width:480px;margin:0 auto;background:white;border-radius:24px;overflow:hidden;box-shadow:0 8px 40px rgba(74,0,170,0.15)">
        <div style="background:linear-gradient(135deg,#1a0042,#4a00aa);padding:32px;text-align:center">
          <h1 style="color:#d97706;font-size:22px;margin:0;letter-spacing:1px">GRFW</h1>
          <p style="color:rgba(255,255,255,0.7);font-size:13px;margin:4px 0 0">Global Resilience Foundation for Widows</p>
        </div>
        <div style="padding:40px 32px;text-align:center">
          <h2 style="color:#4a00aa;font-size:20px;margin:0 0 8px">Password Reset Code</h2>
          <p style="color:#6b7280;font-size:14px;margin:0 0 28px">
            Hi ${name}, enter this 6-digit code on the reset screen.<br/>
            It expires in <strong>90 seconds</strong>.
          </p>
          <div style="background:#f5f0ff;border:2px solid #4a00aa;border-radius:16px;padding:24px;margin:0 0 24px">
            <span style="font-size:48px;font-weight:bold;letter-spacing:12px;color:#4a00aa">${code}</span>
          </div>
          <p style="color:#9ca3af;font-size:12px;margin:0">
            If you did not request this, ignore this email — your password will not change.
          </p>
        </div>
        <div style="background:#f9f7ff;padding:16px;text-align:center;border-top:1px solid #ede0ff">
          <p style="color:#d97706;font-size:12px;margin:0">Empower • Support • Transform • Thrive</p>
        </div>
      </div>
    </body>
    </html>
  `

  try {
    const { error } = await client.emails.send({
      from: 'GRFW Portal <onboarding@resend.dev>',
      to:   toEmail,
      subject: `${code} — Your GRFW Password Reset Code`,
      html,
    })

    if (error) {
      console.error(`  Email error: ${error.message}`)
      return { sent: false, error: error.message }
    }

    console.log(`  Password reset code sent to ${toEmail}`)
    return { sent: true }
  } catch (err) {
    console.error(`  Email send failed: ${err.message}`)
    return { sent: false, error: err.message }
  }
}

/**
 * Forward a contact form submission to grfwportal@gmail.com.
 * Requires CONTACT_EMAIL_USER and CONTACT_EMAIL_PASS (Gmail App Password) in env.
 */
async function sendContactEmail({ name, email, country, subject, message }) {
  const user = process.env.CONTACT_EMAIL_USER
  const pass = process.env.CONTACT_EMAIL_PASS

  if (!user || !pass) {
    console.log(`  [CONTACT] Would send email from ${email}: ${subject}  (set CONTACT_EMAIL_USER / CONTACT_EMAIL_PASS to enable)`)
    return { sent: false }
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  })

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family:Arial,sans-serif;background:#f0e8ff;padding:40px 0;margin:0">
      <div style="max-width:560px;margin:0 auto;background:white;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(74,0,170,0.12)">
        <div style="background:linear-gradient(135deg,#1a0042,#4a00aa);padding:28px 32px">
          <h1 style="color:#d97706;font-size:20px;margin:0;letter-spacing:1px">GRFW Portal</h1>
          <p style="color:rgba(255,255,255,0.65);font-size:12px;margin:4px 0 0">New Contact Form Submission</p>
        </div>
        <div style="padding:32px">
          <table style="width:100%;border-collapse:collapse;font-size:14px;color:#374151">
            <tr><td style="padding:8px 0;color:#6b7280;width:120px">From</td><td style="padding:8px 0;font-weight:600">${name}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280">Email</td><td style="padding:8px 0"><a href="mailto:${email}" style="color:#4a00aa">${email}</a></td></tr>
            <tr><td style="padding:8px 0;color:#6b7280">Country</td><td style="padding:8px 0">${country || '—'}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280">Subject</td><td style="padding:8px 0;font-weight:600">${subject}</td></tr>
          </table>
          <div style="margin-top:20px;padding:20px;background:#f9f7ff;border-left:4px solid #4a00aa;border-radius:0 12px 12px 0">
            <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;white-space:pre-wrap">${message}</p>
          </div>
        </div>
        <div style="background:#f9f7ff;padding:16px 32px;border-top:1px solid #ede0ff;text-align:center">
          <p style="color:#d97706;font-size:11px;margin:0">Empower • Support • Transform • Thrive</p>
        </div>
      </div>
    </body>
    </html>
  `

  try {
    await transporter.sendMail({
      from:     `"GRFW Contact Form" <${user}>`,
      to:       'grfwportal@gmail.com',
      replyTo:  `"${name}" <${email}>`,
      subject:  `[GRFW Contact] ${subject}`,
      html,
    })
    console.log(`  Contact email sent: ${subject} (from ${email})`)
    return { sent: true }
  } catch (err) {
    console.error(`  Contact email failed: ${err.message}`)
    return { sent: false, error: err.message }
  }
}

module.exports = { sendResetCode, sendContactEmail }
