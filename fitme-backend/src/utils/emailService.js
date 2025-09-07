const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
    this._init();
  }

  _init() {
    const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
    const missing = required.filter(v => !process.env[v]);
    if (missing.length > 0) {
      console.warn(`Email service disabled. Missing: ${missing.join(', ')}`);
      return;
    }
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_PORT === '465',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      tls: { rejectUnauthorized: false },
    });
  }

  _devLog(label, to, subject, extra = '') {
    console.log(`\n${'='.repeat(60)}\n📧 ${label} (Dev Mode)\nTo: ${to}\nSubject: ${subject}${extra}\n${'='.repeat(60)}\n`);
    return { messageId: `simulated-${Date.now()}` };
  }

  async sendOTPEmail(email, otp, firstName = '') {
    if (!this.transporter) {
      return this._devLog('OTP EMAIL', email, 'Email Verification - FitMe', `\nOTP: ${otp}\nName: ${firstName}`);
    }
    await this.transporter.sendMail({
      from: `"FitMe App" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Email Verification - FitMe App',
      html: this._otpHtml(otp, firstName, 'Email Verification', '#4f46e5'),
      text: `Your FitMe verification code: ${otp}. Expires in 5 minutes.`,
    });
  }

  async sendPasswordResetOTP(email, otp, firstName = '') {
    if (!this.transporter) {
      return this._devLog('PASSWORD RESET EMAIL', email, 'Password Reset - FitMe', `\nRESET OTP: ${otp}\nName: ${firstName}`);
    }
    await this.transporter.sendMail({
      from: `"FitMe App" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Password Reset - FitMe App',
      html: this._otpHtml(otp, firstName, 'Password Reset', '#111827'),
      text: `Your FitMe password reset code: ${otp}. Expires in 5 minutes.`,
    });
  }

  async sendWelcomeEmail(email, firstName) {
    if (!this.transporter) {
      return this._devLog('WELCOME EMAIL', email, 'Welcome to FitMe!', `\nWelcome ${firstName}!`);
    }
    await this.transporter.sendMail({
      from: `"FitMe App" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Welcome to FitMe!',
      html: `<p>Hello ${firstName}, your email has been verified. Welcome to FitMe!</p>`,
      text: `Welcome to FitMe, ${firstName}! Your email has been verified.`,
    });
  }

  _otpHtml(otp, firstName, title, color) {
    return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h2 style="color:#4f46e5">FitMe - ${title}</h2>
      <p>Hello ${firstName || 'there'},</p>
      <p>Your ${title.toLowerCase()} code is:</p>
      <div style="background:${color};color:white;padding:20px;border-radius:8px;text-align:center;font-size:32px;font-weight:bold;letter-spacing:8px">${otp}</div>
      <p>This code expires in 5 minutes. Do not share it with anyone.</p>
      <p>Best regards,<br>The FitMe Team</p>
    </body></html>`;
  }
}

module.exports = new EmailService();
