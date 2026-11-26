// Copyright (c) 2026 SmartCart Owner. All rights reserved.

export type EmailLanguage = 'en' | 'sw';

export interface SendEmailInput {
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  enforceAddressRateLimit?: boolean;
}

export interface SendEmailResult {
  sent: boolean;
  provider: string;
  statusCode?: number;
  rateLimited?: boolean;
  dailyCapReached?: boolean;
  error?: string;
}

const RESEND_API_ENDPOINT = 'https://api.resend.com/emails';
const MAX_EMAIL_PER_ADDRESS_PER_HOUR = 5;
const ONE_HOUR_MS = 60 * 60 * 1000;

// In-memory rate limits for recipient email addresses and global UTC daily email cap
const recipientSendTimestamps = new Map<string, number[]>();
let dailyCounter = {
  utcDay: new Date().toISOString().slice(0, 10),
  count: 0,
};

function getCurrentUtcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function getEmailDailyCap(): number {
  const raw = process.env.EMAIL_DAILY_CAP;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 200;
}

export function normalizeAndValidateEmail(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  if (/[\r\n\0]/.test(raw)) return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized || normalized.length > 254) return null;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailRegex.test(normalized)) return null;
  return normalized;
}

export function isValidSingleHeaderLine(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0 && !/[\r\n\0]/.test(value);
}

export function isRecipientRateLimited(to: string): boolean {
  const normalized = normalizeAndValidateEmail(to);
  if (!normalized) return false;
  const now = Date.now();
  const list = (recipientSendTimestamps.get(normalized) || []).filter((ts) => now - ts < ONE_HOUR_MS);
  if (list.length === 0) {
    recipientSendTimestamps.delete(normalized);
    return false;
  }
  recipientSendTimestamps.set(normalized, list);
  return list.length >= MAX_EMAIL_PER_ADDRESS_PER_HOUR;
}

function recordRecipientSend(normalizedTo: string): void {
  const now = Date.now();
  const list = (recipientSendTimestamps.get(normalizedTo) || []).filter((ts) => now - ts < ONE_HOUR_MS);
  list.push(now);
  recipientSendTimestamps.set(normalizedTo, list);
}

function checkAndIncrementDailyEmailCount(): { allowed: boolean; cap: number } {
  const today = getCurrentUtcDay();
  if (dailyCounter.utcDay !== today) {
    dailyCounter = { utcDay: today, count: 0 };
  }
  const cap = getEmailDailyCap();
  if (dailyCounter.count >= cap) {
    return { allowed: false, cap };
  }
  dailyCounter.count += 1;
  return { allowed: true, cap };
}

function resolveResendEndpoint(): string {
  const customUrl = process.env.EMAIL_API_URL?.trim();
  if (customUrl) {
    try {
      const parsed = new URL(customUrl);
      if (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
      ) {
        return parsed.toString();
      }
    } catch {
      // Ignore invalid override
    }
  }
  return RESEND_API_ENDPOINT;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const normalizedTo = normalizeAndValidateEmail(input.to);
  if (!normalizedTo) {
    return { sent: false, provider: 'none', error: 'Invalid recipient email address' };
  }

  if (!isValidSingleHeaderLine(input.subject)) {
    return { sent: false, provider: 'none', error: 'Invalid email subject' };
  }

  if (input.enforceAddressRateLimit !== false && isRecipientRateLimited(normalizedTo)) {
    console.warn(`[EMAIL] Rate limit reached for recipient address (max ${MAX_EMAIL_PER_ADDRESS_PER_HOUR}/hr).`);
    return { sent: false, provider: 'rate_limit', rateLimited: true, error: 'Recipient rate limit reached' };
  }

  const dailyCheck = checkAndIncrementDailyEmailCount();
  if (!dailyCheck.allowed) {
    console.warn(`[EMAIL] Global EMAIL_DAILY_CAP (${dailyCheck.cap}) reached; suppressing email send.`);
    return { sent: false, provider: 'daily_cap', dailyCapReached: true, error: 'Daily email cap reached' };
  }

  const provider = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();

  // Fallback when EMAIL_PROVIDER is unset
  if (!provider) {
    recordRecipientSend(normalizedTo);
    if (process.env.NODE_ENV === 'production') {
      console.log(`[EMAIL FALLBACK] Provider unset; skipped dispatch to ${normalizedTo} (Subject: ${input.subject})`);
    } else {
      console.log(`[EMAIL DEV FALLBACK] To: ${normalizedTo} | Subject: ${input.subject}\n${input.textBody}`);
    }
    return { sent: true, provider: 'console_fallback' };
  }

  if (provider !== 'resend') {
    console.error(`[EMAIL] Unsupported EMAIL_PROVIDER configured.`);
    return { sent: false, provider, error: 'Unsupported email provider' };
  }

  const apiKey = process.env.EMAIL_API_KEY?.trim() || '';
  const fromAddress = (process.env.EMAIL_FROM || '').trim();
  if (!apiKey || !fromAddress || !isValidSingleHeaderLine(fromAddress)) {
    console.error('[EMAIL] Missing or invalid EMAIL_API_KEY / EMAIL_FROM server configuration.');
    return { sent: false, provider: 'resend', error: 'Email service misconfigured' };
  }

  recordRecipientSend(normalizedTo);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const endpoint = resolveResendEndpoint();
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [normalizedTo],
        subject: input.subject.trim(),
        text: input.textBody,
        html: input.htmlBody,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`[EMAIL] Resend delivery failed with HTTP ${res.status}`);
      return { sent: false, provider: 'resend', statusCode: res.status, error: `HTTP ${res.status}` };
    }

    return { sent: true, provider: 'resend', statusCode: res.status };
  } catch (err: any) {
    const reason = err?.name === 'AbortError' ? 'timeout' : 'network_error';
    console.error(`[EMAIL] Resend request failed (${reason})`);
    return { sent: false, provider: 'resend', error: reason };
  } finally {
    clearTimeout(timeout);
  }
}

// Reset helper strictly for isolated test processes if needed
export function _resetEmailCountersForTest(): void {
  recipientSendTimestamps.clear();
  dailyCounter = { utcDay: getCurrentUtcDay(), count: 0 };
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getEmailCopyrightLine(lang: EmailLanguage): string {
  const year = new Date().getFullYear();
  const owner = (process.env.VITE_COPYRIGHT_OWNER || '').trim() || 'SmartCart Owner';
  if (lang === 'sw') {
    return `© ${year} ${owner}. Haki zote zimehifadhiwa.`;
  }
  return `© ${year} ${owner}. All rights reserved.`;
}

function wrapHtmlEmail(lang: EmailLanguage, title: string, bodyHtml: string): string {
  const footerNote =
    lang === 'sw'
      ? 'Smart Cart — Hakuna malipo ndani ya programu.'
      : 'Smart Cart — No in-app payments.';
  const copyrightLine = escapeHtml(getEmailCopyrightLine(lang));

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:16px;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
    <tr>
      <td style="padding:18px 24px;background:#047857;color:#ffffff;">
        <div style="font-size:18px;font-weight:700;letter-spacing:-0.01em;">Smart Cart</div>
        <div style="font-size:13px;opacity:0.9;margin-top:2px;">${escapeHtml(title)}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:24px;font-size:14px;line-height:1.6;color:#1e293b;">
        ${bodyHtml}
      </td>
    </tr>
    <tr>
      <td style="padding:16px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
        <div>${escapeHtml(footerNote)}</div>
        <div style="margin-top:4px;">${copyrightLine}</div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildPasswordResetOtpEmail(params: {
  lang: EmailLanguage;
  name: string;
  code: string;
}): { subject: string; textBody: string; htmlBody: string } {
  const { lang, name, code } = params;
  const safeName = escapeHtml(name || (lang === 'sw' ? 'Mtumiaji' : 'Customer'));
  const safeCode = escapeHtml(code);
  const copyrightLine = getEmailCopyrightLine(lang);

  if (lang === 'sw') {
    const subject = 'Smart Cart — Msimbo wako wa kuweka nenosiri upya';
    const textBody = [
      `Hujambo ${name || 'Mtumiaji'},`,
      '',
      'Umepokea msimbo huu ili kuweka upya nenosiri la akaunti yako ya Smart Cart.',
      '',
      `Msimbo wako wa uthibitisho: ${code}`,
      'Muda wa matumizi: Dakika 10.',
      '',
      'Ikiwa hukuomba hii, puuza barua pepe hii.',
      '',
      'Smart Cart — Hakuna malipo ndani ya programu.',
      copyrightLine,
    ].join('\n');

    const htmlBody = wrapHtmlEmail(
      'sw',
      'Weka Upya Nenosiri',
      `<p style="margin:0 0 12px;">Hujambo ${safeName},</p>
       <p style="margin:0 0 16px;">Tumia msimbo huu wa tarakimu 6 kuweka nenosiri jipya kwa akaunti yako ya Smart Cart. Muda wa matumizi ni <strong>dakika 10</strong>.</p>
       <div style="margin:16px 0;padding:14px 18px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;text-align:center;font-family:monospace;font-size:26px;font-weight:700;letter-spacing:6px;color:#065f46;">${safeCode}</div>
       <p style="margin:16px 0 0;font-size:13px;color:#475569;">Ikiwa hukuomba hii, puuza barua pepe hii.</p>`
    );

    return { subject, textBody, htmlBody };
  }

  const subject = 'Smart Cart — Your password reset code';
  const textBody = [
    `Hello ${name || 'Customer'},`,
    '',
    'We received a request to reset the password for your Smart Cart account.',
    '',
    `Verification code: ${code}`,
    'Expires in: 10 minutes.',
    '',
    'If you did not ask for this, ignore this email.',
    '',
    'Smart Cart — No in-app payments.',
    copyrightLine,
  ].join('\n');

  const htmlBody = wrapHtmlEmail(
    'en',
    'Password Reset Code',
    `<p style="margin:0 0 12px;">Hello ${safeName},</p>
     <p style="margin:0 0 16px;">Use this 6-digit verification code to set a new password for your Smart Cart account. It expires in <strong>10 minutes</strong>.</p>
     <div style="margin:16px 0;padding:14px 18px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;text-align:center;font-family:monospace;font-size:26px;font-weight:700;letter-spacing:6px;color:#065f46;">${safeCode}</div>
     <p style="margin:16px 0 0;font-size:13px;color:#475569;">If you did not ask for this, ignore this email.</p>`
  );

  return { subject, textBody, htmlBody };
}

export function buildAdminResetLinkEmail(params: {
  lang: EmailLanguage;
  name: string;
  resetUrl: string;
}): { subject: string; textBody: string; htmlBody: string } {
  const { lang, name, resetUrl } = params;
  const safeName = escapeHtml(name || 'Administrator');
  const safeUrl = escapeHtml(resetUrl);
  const copyrightLine = getEmailCopyrightLine(lang);

  if (lang === 'sw') {
    const subject = 'Smart Cart — Kiungo cha kurejesha nenosiri la Msimamizi';
    const textBody = [
      `Hujambo ${name || 'Msimamizi'},`,
      '',
      'Kiungo cha matumizi ya mara moja kimeombwa kwa akaunti ya Msimamizi Mkuu wa Smart Cart.',
      `Kiungo cha kurejesha (kinaisha baada ya dakika 10): ${resetUrl}`,
      '',
      'Ikiwa hukuomba hii, puuza barua pepe hii.',
      '',
      copyrightLine,
    ].join('\n');

    const htmlBody = wrapHtmlEmail(
      'sw',
      'Urejeshaji wa Nenosiri la Msimamizi',
      `<p style="margin:0 0 12px;">Hujambo ${safeName},</p>
       <p style="margin:0 0 16px;">Bonyeza kiungo kilicho hapa chini ili kuweka nenosiri jipya la Msimamizi Mkuu. Kiungo hiki kinatumika mara moja pekee na kinaisha baada ya <strong>dakika 10</strong>.</p>
       <p style="margin:16px 0;"><a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background:#047857;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">Weka Nenosiri Jipya</a></p>
       <p style="margin:12px 0;font-size:12px;color:#64748b;word-break:break-all;">Au fungua: ${safeUrl}</p>
       <p style="margin:16px 0 0;font-size:13px;color:#475569;">Ikiwa hukuomba hii, puuza barua pepe hii.</p>`
    );

    return { subject, textBody, htmlBody };
  }

  const subject = 'Smart Cart — System Administrator password reset link';
  const textBody = [
    `Hello ${name || 'Administrator'},`,
    '',
    'A single-use recovery link was requested for the Smart Cart System Administrator account.',
    `Reset link (expires in 10 minutes): ${resetUrl}`,
    '',
    'If you did not ask for this, ignore this email.',
    '',
    copyrightLine,
  ].join('\n');

  const htmlBody = wrapHtmlEmail(
    'en',
    'Administrator Password Recovery',
    `<p style="margin:0 0 12px;">Hello ${safeName},</p>
     <p style="margin:0 0 16px;">Use the single-use link below to reset your System Administrator password. This link expires in <strong>10 minutes</strong>.</p>
     <p style="margin:16px 0;"><a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background:#047857;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">Reset Admin Password</a></p>
     <p style="margin:12px 0;font-size:12px;color:#64748b;word-break:break-all;">Or open: ${safeUrl}</p>
     <p style="margin:16px 0 0;font-size:13px;color:#475569;">If you did not ask for this, ignore this email.</p>`
  );

  return { subject, textBody, htmlBody };
}

export function buildPasswordChangedEmail(params: {
  lang: EmailLanguage;
  name: string;
}): { subject: string; textBody: string; htmlBody: string } {
  const { lang, name } = params;
  const safeName = escapeHtml(name || (lang === 'sw' ? 'Mtumiaji' : 'Customer'));
  const copyrightLine = getEmailCopyrightLine(lang);

  if (lang === 'sw') {
    const subject = 'Smart Cart — Nenosiri la akaunti yako limebadilishwa';
    const textBody = [
      `Hujambo ${name || 'Mtumiaji'},`,
      '',
      'Hii ni taarifa ya usalama kuwa nenosiri la akaunti yako ya Smart Cart limebadilishwa hivi punde.',
      'Kwa usalama wako, vikao vyote vya zamani vimetoka nje.',
      'Ikiwa hukufanya badiliko hili, wasiliana na msimamizi mara moja.',
      '',
      copyrightLine,
    ].join('\n');

    const htmlBody = wrapHtmlEmail(
      'sw',
      'Nenosiri Limebadilishwa',
      `<p style="margin:0 0 12px;">Hujambo ${safeName},</p>
       <p style="margin:0 0 12px;">Nenosiri la akaunti yako ya Smart Cart limebadilishwa kikamilifu na vikao vingine vimefungwa kwa usalama.</p>
       <p style="margin:0;font-size:13px;color:#475569;">Ikiwa hukufanya mabadiliko haya, wasiliana na msaada wa Smart Cart mara moja.</p>`
    );
    return { subject, textBody, htmlBody };
  }

  const subject = 'Smart Cart — Your password was changed';
  const textBody = [
    `Hello ${name || 'Customer'},`,
    '',
    'This is a security notice confirming that your Smart Cart account password was recently changed.',
    'All previous sign-in sessions have been closed.',
    'If you did not make this change, contact the platform administrator immediately.',
    '',
    copyrightLine,
  ].join('\n');

  const htmlBody = wrapHtmlEmail(
    'en',
    'Password Changed Notice',
    `<p style="margin:0 0 12px;">Hello ${safeName},</p>
     <p style="margin:0 0 12px;">Your Smart Cart account password has been updated and previous active sessions were signed out for your protection.</p>
     <p style="margin:0;font-size:13px;color:#475569;">If you did not make this change, please contact platform support immediately.</p>`
  );
  return { subject, textBody, htmlBody };
}

export function buildSupermarketApplicationEmail(params: {
  lang: EmailLanguage;
  ownerName: string;
  chainName: string;
}): { subject: string; textBody: string; htmlBody: string } {
  const { lang, ownerName, chainName } = params;
  const safeOwner = escapeHtml(ownerName);
  const safeChain = escapeHtml(chainName);
  const copyrightLine = getEmailCopyrightLine(lang);

  if (lang === 'sw') {
    const subject = `Smart Cart — Ombi la duka la ${chainName} limepokelewa`;
    const textBody = [
      `Hujambo ${ownerName},`,
      '',
      `Asante kwa kusajili ${chainName} kwenye Smart Cart.`,
      'Ombi lako limepokelewa na linasubiri ukaguzi wa Msimamizi Mkuu.',
      'Utapokea barua pepe nyingine mara tu ombi litakapoidhinishwa.',
      '',
      copyrightLine,
    ].join('\n');

    const htmlBody = wrapHtmlEmail(
      'sw',
      'Ombi Limepokelewa',
      `<p style="margin:0 0 12px;">Hujambo ${safeOwner},</p>
       <p style="margin:0 0 12px;">Ombi la kujiunga kwa duka la <strong>${safeChain}</strong> limepokelewa na linakaguliwa na Msimamizi Mkuu wa Smart Cart.</p>
       <p style="margin:0;">Utapokea taarifa kwa barua pepe pindi akaunti ya msimamizi wa duka itakapoidhinishwa.</p>`
    );
    return { subject, textBody, htmlBody };
  }

  const subject = `Smart Cart — Store application received (${chainName})`;
  const textBody = [
    `Hello ${ownerName},`,
    '',
    `Thank you for applying to register ${chainName} on Smart Cart.`,
    'Your application is pending review by the System Administrator.',
    'You will receive another email as soon as your store is approved.',
    '',
    copyrightLine,
  ].join('\n');

  const htmlBody = wrapHtmlEmail(
    'en',
    'Application Received',
    `<p style="margin:0 0 12px;">Hello ${safeOwner},</p>
     <p style="margin:0 0 12px;">Your store application for <strong>${safeChain}</strong> has been received and is awaiting approval by the Smart Cart System Administrator.</p>
     <p style="margin:0;">We will notify you by email once review is complete.</p>`
  );
  return { subject, textBody, htmlBody };
}

export function buildSupermarketStatusEmail(params: {
  lang: EmailLanguage;
  ownerName: string;
  chainName: string;
  status: 'active' | 'rejected' | 'suspended';
  portalUrl?: string;
}): { subject: string; textBody: string; htmlBody: string } {
  const { lang, ownerName, chainName, status, portalUrl } = params;
  const safeOwner = escapeHtml(ownerName);
  const safeChain = escapeHtml(chainName);
  const copyrightLine = getEmailCopyrightLine(lang);

  if (status === 'active') {
    if (lang === 'sw') {
      const subject = `Smart Cart — Duka la ${chainName} limeidhinishwa`;
      const textBody = [
        `Hujambo ${ownerName},`,
        '',
        `Hongera! Ombi la duka la ${chainName} limeidhinishwa kwenye Smart Cart.`,
        portalUrl ? `Ingia kwenye Mlango wa Wamiliki hapa: ${portalUrl}` : 'Sasa unaweza kuingia kwenye Mlango wa Wamiliki.',
        '',
        copyrightLine,
      ].join('\n');

      const htmlBody = wrapHtmlEmail(
        'sw',
        'Duka Limeidhinishwa',
        `<p style="margin:0 0 12px;">Hujambo ${safeOwner},</p>
         <p style="margin:0 0 12px;">Duka la <strong>${safeChain}</strong> limeidhinishwa na linapatikana kwa wateja wa Smart Cart.</p>
         ${portalUrl ? `<p style="margin:16px 0;"><a href="${escapeHtml(portalUrl)}" style="display:inline-block;padding:10px 18px;background:#047857;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">Fungua Mlango wa Wamiliki</a></p>` : ''}`
      );
      return { subject, textBody, htmlBody };
    }

    const subject = `Smart Cart — Your store ${chainName} has been approved`;
    const textBody = [
      `Hello ${ownerName},`,
      '',
      `Good news! Your store ${chainName} has been approved by the Smart Cart administrator.`,
      portalUrl ? `Sign in to the Management Portal: ${portalUrl}` : 'You can now sign in to the Management Portal to manage branches, staff, and stock.',
      '',
      copyrightLine,
    ].join('\n');

    const htmlBody = wrapHtmlEmail(
      'en',
      'Store Approved',
      `<p style="margin:0 0 12px;">Hello ${safeOwner},</p>
       <p style="margin:0 0 12px;">Good news! <strong>${safeChain}</strong> has been approved and is now active on Smart Cart.</p>
       ${portalUrl ? `<p style="margin:16px 0;"><a href="${escapeHtml(portalUrl)}" style="display:inline-block;padding:10px 18px;background:#047857;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">Open Management Portal</a></p>` : ''}`
    );
    return { subject, textBody, htmlBody };
  }

  // Rejected or Suspended
  const isRejected = status === 'rejected';
  if (lang === 'sw') {
    const subject = isRejected
      ? `Smart Cart — Taarifa kuhusu ombi la ${chainName}`
      : `Smart Cart — Duka la ${chainName} limesimamishwa`;
    const textBody = [
      `Hujambo ${ownerName},`,
      '',
      isRejected
        ? `Tunasikitika kuwa ombi la duka la ${chainName} halijaidhinishwa kwa sasa.`
        : `Akaunti ya duka la ${chainName} imesimamishwa na msimamizi wa mfumo.`,
      'Kwa maelezo zaidi, wasiliana na timu ya msaada ya Smart Cart.',
      '',
      copyrightLine,
    ].join('\n');

    const htmlBody = wrapHtmlEmail(
      'sw',
      isRejected ? 'Ombi Halijaidhinishwa' : 'Duka Limesimamishwa',
      `<p style="margin:0 0 12px;">Hujambo ${safeOwner},</p>
       <p style="margin:0;">${
         isRejected
           ? `Tunasikitika kuwa ombi la duka la <strong>${safeChain}</strong> halijaidhinishwa kwa sasa.`
           : `Ufikiaji wa duka la <strong>${safeChain}</strong> umesimamishwa na Msimamizi Mkuu.`
       }</p>`
    );
    return { subject, textBody, htmlBody };
  }

  const subject = isRejected
    ? `Smart Cart — Update on your store application (${chainName})`
    : `Smart Cart — Store access suspended (${chainName})`;
  const textBody = [
    `Hello ${ownerName},`,
    '',
    isRejected
      ? `We regret to inform you that the store application for ${chainName} was not approved.`
      : `Your store account for ${chainName} has been suspended by the platform administrator.`,
    'Please contact Smart Cart support if you need further assistance.',
    '',
    copyrightLine,
  ].join('\n');

  const htmlBody = wrapHtmlEmail(
    'en',
    isRejected ? 'Application Not Approved' : 'Store Suspended',
    `<p style="margin:0 0 12px;">Hello ${safeOwner},</p>
     <p style="margin:0;">${
       isRejected
         ? `We are unable to approve the application for <strong>${safeChain}</strong> at this time.`
         : `Store portal access for <strong>${safeChain}</strong> has been suspended by the System Administrator.`
     }</p>`
  );
  return { subject, textBody, htmlBody };
}
