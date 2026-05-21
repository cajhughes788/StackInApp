"use client"

const PRIVACY_SECTIONS: Array<{ title: string; paragraphs: string[] }> = [
  {
    title: "Information we collect",
    paragraphs: [
      "We collect information you provide directly when you use StackIn. This may include your email address, account identifiers, workspace details, support messages, and other content you choose to enter into the app.",
      "Because StackIn is designed for income and tax-related recordkeeping, we may collect financial information you enter, such as income, expenses, deductions, tax profile information, pay period details, and related bookkeeping records.",
      "If you use receipt capture or upload features, we may collect photos or videos that you provide, including receipt images and any information extracted from them to help create or organize expense records.",
      "If you enable location-based features, reminders, or workplace tools, we may collect precise location information and related saved location details, such as workplace coordinates or addresses, and link that information to your account or workspace.",
    ],
  },
  {
    title: "How we use information",
    paragraphs: [
      "We use collected information to provide the core functionality of StackIn, including account authentication, workspace management, income and expense tracking, pay and tax estimate features, receipt storage and processing, reminders, and customer support.",
      "We also use information to maintain security, prevent misuse, troubleshoot issues, process user requests, and operate, improve, and support the reliability of the service.",
    ],
  },
  {
    title: "How data is linked to you",
    paragraphs: [
      "The information described in this policy may be linked to your identity through your account, workspace, or user identifier so that StackIn can provide app functionality such as sign-in, saved records, reminders, receipt management, support, and account recovery.",
      "We do not use the data described in this policy for third-party advertising tracking. We do not share precise location, email address, financial information, receipt uploads, or support content with data brokers for targeted advertising.",
    ],
  },
  {
    title: "Sharing and service providers",
    paragraphs: [
      "We may share information with service providers that help us operate StackIn, such as cloud hosting, authentication, storage, database, and support infrastructure providers, but only as needed to provide and secure the service.",
      "We may also disclose information when required by law, to respond to valid legal requests, to enforce our terms, or to protect the rights, safety, and security of StackIn, our users, or others.",
    ],
  },
  {
    title: "Data retention",
    paragraphs: [
      "We keep information for as long as reasonably necessary to provide StackIn, maintain your account, support bookkeeping and recordkeeping features, comply with legal obligations, resolve disputes, and enforce our agreements.",
    ],
  },
  {
    title: "Your choices",
    paragraphs: [
      "You can review or update certain information within the app. You may also contact us to request account deletion or updates to your information, subject to any legal, operational, tax, fraud-prevention, or security requirements that require us to retain certain records.",
    ],
  },
  {
    title: "Privacy policy updates",
    paragraphs: [
      "We may update this Privacy Policy from time to time. If we make material changes, we may revise the date on this page and take additional steps to notify users when appropriate.",
    ],
  },
  {
    title: "Contact",
    paragraphs: [
      "If you have questions about this policy or your information, visit https://stackin-app.com/support.",
    ],
  },
]

export default function PrivacyPolicyContent() {
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <p className="text-sm font-medium uppercase tracking-[0.24em] text-primary">Privacy</p>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Privacy Policy
          </h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground sm:text-base">
            This page explains how StackIn collects, uses, and protects information when you use
            the app and related services.
          </p>
        </div>
      </div>

      <section className="rounded-2xl border border-border bg-background/70 p-5 text-sm leading-7 text-muted-foreground">
        <p>
          <strong className="text-foreground">Effective Date:</strong> 04/29/2026
        </p>
        <p>
          <strong className="text-foreground">Last Updated:</strong> 04/29/2026
        </p>
      </section>

      <div className="space-y-8 text-sm leading-7 text-muted-foreground sm:text-base">
        {PRIVACY_SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="text-xl font-semibold text-foreground">{section.title}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="mt-3">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
