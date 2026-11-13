import { eq } from "drizzle-orm";
import { Resend } from "resend";

import { organization } from "@/db/schema";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { escapeHtml } from "@/lib/utils";

const resend = new Resend(env.RESEND_API_KEY);

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const brand = await getBrand();
  await resend.emails.send({
    from: env.FROM_EMAIL,
    to,
    subject: `Reset your ${brand.orgName} password`,
    html: renderTemplate({
      brand,
      preheader: "Reset your password — this link expires in 1 hour.",
      heading: "Reset your password",
      intro: `We received a request to reset the password for your <strong>${escapeHtml(brand.orgName)}</strong> account. Click the button below to choose a new one.`,
      cta: { label: "Reset password", url: resetUrl },
      outro:
        "This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.",
    }),
  });
}

export async function sendWelcomeEmail(to: string, name: string): Promise<void> {
  const brand = await getBrand();
  await resend.emails.send({
    from: env.FROM_EMAIL,
    to,
    subject: `Welcome to ${brand.orgName}`,
    html: renderTemplate({
      brand,
      preheader: `Your ${brand.orgName} account is ready.`,
      heading: `Welcome, ${escapeHtml(name)}`,
      intro: `Your account on <strong>${escapeHtml(brand.orgName)}</strong> has been created. Log in any time to set your password and start exploring the platform.`,
      cta: { label: "Go to the platform", url: env.APP_URL },
      outro: "We're glad to have you with us.",
    }),
  });
}

export async function sendBulkWelcomeEmails(
  recipients: { email: string; name: string }[]
): Promise<void> {
  if (recipients.length === 0) return;
  const brand = await getBrand();
  // Resend batch.send accepts up to 100 emails per call
  const BATCH_SIZE = 100;
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    await resend.batch.send(
      batch.map(({ email, name }) => ({
        from: env.FROM_EMAIL,
        to: email,
        subject: `Welcome to ${brand.orgName}`,
        html: renderTemplate({
          brand,
          preheader: `Your ${brand.orgName} account is ready.`,
          heading: `Welcome, ${escapeHtml(name)}`,
          intro: `Your account on <strong>${escapeHtml(brand.orgName)}</strong> has been created. Log in any time to set your password and start exploring the platform.`,
          cta: { label: "Go to the platform", url: env.APP_URL },
          outro: "We're glad to have you with us.",
        }),
      }))
    );
  }
}

export async function sendAccountSetupEmail(
  to: string,
  name: string,
  setupUrl: string
): Promise<void> {
  const brand = await getBrand();
  await resend.emails.send({
    from: env.FROM_EMAIL,
    to,
    subject: `Finish setting up your ${brand.orgName} account`,
    html: renderTemplate({
      brand,
      preheader: "Set your password to access your account — link expires in 24 hours.",
      heading: `Hi ${escapeHtml(name)}, finish setting up your account`,
      intro: `You're one step away from accessing <strong>${escapeHtml(brand.orgName)}</strong>. Click the button below to set your password.`,
      cta: { label: "Set up your password", url: setupUrl },
      outro: "This link expires in 24 hours.",
    }),
  });
}

export async function sendMembershipEndedEmail(to: string, name: string): Promise<void> {
  const brand = await getBrand();
  const contacts = await getContactLinks();
  const orgName = escapeHtml(brand.orgName);
  await resend.emails.send({
    from: env.FROM_EMAIL,
    to,
    subject: `Your ${brand.orgName} membership has ended`,
    html: renderTemplate({
      brand,
      preheader: `Your ${brand.orgName} membership is no longer active. Here is how to renew it.`,
      heading: `Hi ${name}, your membership has ended`,
      intro: `Your membership in <strong>${orgName}</strong> is no longer active. To renew yours, please contact ${orgName}${contacts.length > 0 ? " through any of these channels:" : " directly."}`,
      details: renderContactList(contacts),
      outro:
        contacts.length > 0
          ? "If you think this is a mistake, please let us know through the same channels."
          : "If you think this is a mistake, please let us know.",
    }),
  });
}

interface ContactLink {
  label: string;
  text: string;
  url: string;
}

async function getContactLinks(): Promise<ContactLink[]> {
  const [org] = await db
    .select({
      email: organization.email,
      instagramUrl: organization.instagramUrl,
      facebookUrl: organization.facebookUrl,
      phone: organization.phone,
    })
    .from(organization)
    .where(eq(organization.id, 1))
    .limit(1);
  if (!org) return [];

  const links: ContactLink[] = [];
  if (org.email) links.push({ label: "Email", text: org.email, url: `mailto:${org.email}` });
  if (org.instagramUrl) {
    links.push({ label: "Instagram", text: displayUrl(org.instagramUrl), url: org.instagramUrl });
  }
  if (org.facebookUrl) {
    links.push({ label: "Facebook", text: displayUrl(org.facebookUrl), url: org.facebookUrl });
  }
  if (org.phone) {
    links.push({ label: "Phone", text: org.phone, url: `tel:${org.phone.replace(/[^\d+]/g, "")}` });
  }
  return links;
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

function renderContactList(links: ContactLink[]): string {
  if (links.length === 0) return "";
  const items = links
    .map(
      (link, index) => `<tr>
          <td style="padding:${index === 0 ? "0" : "12px"} 0 0 0">
            <div style="font-size:12px;font-weight:600;color:${theme.mutedForeground};text-transform:uppercase;letter-spacing:0.04em">${escapeHtml(link.label)}</div>
            <a href="${escapeHtml(link.url)}" target="_blank" style="display:inline-block;margin-top:2px;font-size:15px;color:${theme.primary};text-decoration:none;overflow-wrap:anywhere">${escapeHtml(link.text)}</a>
          </td>
        </tr>`
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px 0;width:100%;background:${theme.surface};border-radius:10px">
      <tr><td style="padding:16px 18px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%">${items}</table>
      </td></tr>
    </table>`;
}

// Email clients need hex, so this palette cannot share the oklch tokens in
// styles/globals.css — keep the two in sync when rebranding (see README "Theming").
const theme = {
  primary: "#dc2626",
  primaryDark: "#b91c1c",
  primaryForeground: "#ffffff",
  foreground: "#0a0a0a",
  mutedForeground: "#71717a",
  surface: "#f4f4f5",
  border: "#e4e4e7",
} as const;

interface Brand {
  orgName: string;
  logoUrl: string | null;
}

const BRAND_CACHE_TTL_MS = 5 * 60 * 1000;
let brandCache: { value: Brand; at: number } | null = null;

async function getBrand(): Promise<Brand> {
  if (brandCache && Date.now() - brandCache.at < BRAND_CACHE_TTL_MS) {
    return brandCache.value;
  }
  const [org] = await db
    .select({ name: organization.name, logoUrl: organization.logoUrl })
    .from(organization)
    .where(eq(organization.id, 1))
    .limit(1);
  const value: Brand = {
    orgName: org?.name?.trim() || "emsa",
    logoUrl: org?.logoUrl ?? null,
  };
  brandCache = { value, at: Date.now() };
  return value;
}

interface TemplateOptions {
  brand: Brand;
  preheader?: string;
  heading: string;
  intro: string;
  details?: string;
  cta?: { label: string; url: string };
  outro?: string;
}

function renderTemplate(opts: TemplateOptions): string {
  const { brand, preheader, heading, intro, details, cta, outro } = opts;
  const orgName = escapeHtml(brand.orgName);
  const safeHeading = escapeHtml(heading);
  const initial = orgName.charAt(0).toUpperCase();
  const year = new Date().getFullYear();

  const logoBlock = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${orgName}" width="44" height="44" style="border-radius:10px;display:block;border:0;outline:none;text-decoration:none;object-fit:cover" />`
    : `<div style="width:44px;height:44px;border-radius:10px;background:${theme.primary};color:${theme.primaryForeground};font-weight:700;font-size:18px;line-height:44px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Roboto,sans-serif">${initial}</div>`;

  const safeCtaUrl = cta ? escapeHtml(cta.url) : "";
  const ctaBlock = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px 0">
        <tr>
          <td align="center" style="border-radius:10px;background:${theme.primary}">
            <a href="${safeCtaUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Roboto,sans-serif;font-size:15px;font-weight:600;color:${theme.primaryForeground};text-decoration:none;border-radius:10px;letter-spacing:0.01em">${escapeHtml(cta.label)}</a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 8px 0;font-size:13px;color:${theme.mutedForeground};line-height:1.6">
        Or paste this link into your browser:<br/>
        <a href="${safeCtaUrl}" style="color:${theme.primary};word-break:break-all;text-decoration:none">${safeCtaUrl}</a>
      </p>`
    : "";

  const outroBlock = outro
    ? `<p style="margin:20px 0 0 0;color:${theme.mutedForeground};font-size:14px;line-height:1.6">${outro}</p>`
    : "";

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${safeHeading}</title>
</head>
<body style="margin:0;padding:0;background:${theme.surface};font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Roboto,sans-serif;-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;color:transparent;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px">${escapeHtml(preheader ?? "")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${theme.surface}">
  <tr>
    <td align="center" style="padding:32px 16px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(15,15,15,0.04),0 4px 16px rgba(15,15,15,0.04)">
        <tr><td style="height:6px;background:${theme.primary};background-image:linear-gradient(90deg,${theme.primary} 0%,${theme.primaryDark} 100%);font-size:0;line-height:0">&nbsp;</td></tr>
        <tr>
          <td style="padding:32px 40px 4px 40px">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:middle">${logoBlock}</td>
                <td style="padding-left:14px;vertical-align:middle;font-size:17px;font-weight:600;color:${theme.foreground};letter-spacing:-0.01em">${orgName}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 40px 0 40px;font-size:24px;font-weight:700;color:${theme.foreground};letter-spacing:-0.015em;line-height:1.3">${safeHeading}</td>
        </tr>
        <tr>
          <td style="padding:14px 40px 8px 40px;font-size:15px;line-height:1.65;color:${theme.foreground}">
            <p style="margin:0">${intro}</p>
            ${details ?? ""}
            ${ctaBlock}
            ${outroBlock}
          </td>
        </tr>
        <tr>
          <td style="padding:28px 40px 0 40px">
            <div style="border-top:1px solid ${theme.border};font-size:0;line-height:0">&nbsp;</div>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 40px 32px 40px;font-size:12px;color:${theme.mutedForeground};line-height:1.6">
            <p style="margin:0">&copy; ${year} ${orgName}. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
