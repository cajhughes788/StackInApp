"use client"

const PRIVACY_SECTIONS: Array<{ title: string; paragraphs: string[] }> = [
  {
    title: "Information we collect",
    paragraphs: [
      "We collect information you provide directly when you use 521, including your email address, phone number, account and workspace identifiers, subscription details, support messages, and other content you choose to enter into the app.",
      "Because 521 is designed for income and tax-related recordkeeping, we collect financial information you enter, such as income, expenses, deductions, tax profile information, pay period details, and related bookkeeping records.",
      "If you connect a bank account using Plaid, Plaid transmits certain account and transaction information to us on your behalf — such as account balances, transaction history, and merchant and category details — so that 521 can help you review and categorize that activity. We do not receive or store your online banking username or password; those credentials are entered directly with Plaid or your financial institution and are never shared with us. Plaid's own use of your information is governed by Plaid's End User Privacy Policy, available at plaid.com/legal. When we can't otherwise suggest a category for a bank transaction, we may send the merchant's business name and the bank's category label to an AI service provider to suggest one; we do not send amounts, dates, account details, or information that identifies you.",
      "If you use receipt capture or upload features, we collect the photos you provide and information extracted from them (such as merchant name, date, and amount) to help create or organize expense records. Receipt images are processed using a third-party optical character recognition service to extract this information.",
      "If you subscribe to a paid plan, our payment processor collects and processes your payment card details directly; we do not receive or store your full card number.",
      "If you create invoices, we collect the invoice details you enter, such as line items, amounts, due dates, notes, and your business details, along with the delivery and payment status of each invoice.",
      "If you set up online invoice payments, you create a payment account with Stripe. Stripe collects the identity, tax, and bank payout information it requires directly from you; we do not receive or store your full bank account or tax identification numbers. We receive and store your Stripe account identifier, its setup status, and information about the payments, refunds, and payouts made through it so that 521 can record and match them to your invoices.",
      "If you enable location-based features, reminders, or workplace tools, we collect precise location information and related saved location details, such as workplace coordinates or addresses, and link that information to your account or workspace.",
      "To deliver push notifications (such as alerts about new bank transactions to review), we collect a device notification token tied to your device and account.",
      "We automatically collect limited technical and usage information, such as app version, device type, and error or crash information, to help us maintain and improve the service.",
    ],
  },
  {
    title: "Information about your clients",
    paragraphs: [
      "When you create an invoice, you may enter information about the person or business you are billing, such as their name, email address, phone number, and mailing address. We store this information in your account and use it only to deliver invoices and payment reminders on your behalf, to show the invoice on a private link, and to pre-fill a text message in your own messaging app when you choose to text an invoice. Texts are sent from your device and phone number, not by 521.",
      "When a client pays an invoice online, Stripe collects and processes their payment details directly; we do not receive or store their full card or bank account number.",
      "We do not use client information for marketing, and we do not sell it or share it for advertising. If you are a client of a 521 user and want your information corrected or removed, you can contact the business that invoiced you or contact us using the information in the Contact section below.",
    ],
  },
  {
    title: "How we use information",
    paragraphs: [
      "We use collected information to provide the core functionality of 521, including account authentication, workspace management, income and expense tracking, bank transaction review, pay and tax estimate features, receipt storage and processing, invoicing and invoice payments, reminders, and customer support.",
      "We also use information to maintain security, detect and prevent misuse, troubleshoot issues, process user requests, send service-related notifications, and operate, improve, and support the reliability of the service.",
    ],
  },
  {
    title: "How data is linked to you",
    paragraphs: [
      "The information described in this policy may be linked to your identity through your account, workspace, or user identifier so that 521 can provide app functionality such as sign-in, saved records, bank transaction review, reminders, receipt management, support, and account recovery.",
      "We do not use the data described in this policy for third-party advertising tracking. We do not share your precise location, email address, financial information, bank transaction data, receipt uploads, or support content with data brokers for targeted advertising.",
    ],
  },
  {
    title: "We do not sell your personal information",
    paragraphs: [
      "We do not sell your personal information, and we have not sold personal information in the preceding twelve months. We do not share your personal information with third parties in exchange for money or other valuable consideration.",
    ],
  },
  {
    title: "Third-party service providers",
    paragraphs: [
      "We share information with the following categories of service providers, only as needed for them to perform their function on our behalf and under obligations to protect your information:",
      "Plaid Inc. — to enable bank account connectivity and retrieve transaction and account data you authorize us to access.",
      "Payment processing providers (including Stripe) — to process subscription payments and billing, to set up the payment accounts you use to accept invoice payments, and to process invoice payments, refunds, and payouts. Stripe's own use of information is governed by its privacy policy, available at stripe.com/privacy.",
      "Cloud infrastructure providers (including Google Cloud Platform and Firebase) — for hosting, databases, authentication, file storage, and push notification delivery.",
      "Optical character recognition and document-processing providers (including Amazon Web Services) — to extract information from receipt images you upload.",
      "AI service providers (including Anthropic) — to suggest expense categories for bank transactions, using only the merchant's business name and the bank's category label.",
      "Email delivery providers (including SendGrid) — to send account, billing, and support-related emails, and to deliver invoices and payment reminders to your clients on your behalf.",
      "We may also disclose information when required by law, to respond to valid legal requests, to enforce our terms, or to protect the rights, safety, and security of 521, our users, or others.",
    ],
  },
  {
    title: "Your privacy choices and rights",
    paragraphs: [
      "Regardless of where you live, we offer all users the following choices with respect to their information: the right to request access to the personal information we hold about you, the right to request correction of inaccurate information, and the right to request deletion of your account and associated information, subject to the retention exceptions described below.",
      "You will not be discriminated against, and your access to 521 will not be degraded, for exercising any of these choices. To exercise any of these rights, contact us using the information in the Contact section below.",
    ],
  },
  {
    title: "Data retention",
    paragraphs: [
      "We retain information for as long as your account remains active, in order to provide 521's core functionality.",
      "If you request deletion of your account and do not have an active paid subscription, your data is deleted promptly upon request.",
      "If you have an active paid subscription at the time you request deletion, deletion is scheduled to occur once your current paid period ends, and is then completed automatically, typically within about 24 hours of that date.",
      "If you disconnect a linked bank account without deleting your entire account, that connection is revoked immediately, independent of your account's overall status.",
      "When your account is deleted, your invoices, your clients' information, and the private invoice links you created are deleted with it. Stripe keeps its own records of your payment account and the payments made through it, as required by law and its own policies.",
      "We may retain limited records, such as a log that a deletion request was made and completed, after other data has been deleted, solely to demonstrate compliance with this policy.",
    ],
  },
  {
    title: "Data security",
    paragraphs: [
      "We use industry-standard measures to protect your information, including encryption of data in transit using TLS, encryption of data at rest, and additional application-level encryption of the credentials used to maintain your bank connection. Access to your data within 521 is restricted to the specific account or workspace it belongs to.",
      "No method of transmission or storage is completely secure, and we cannot guarantee absolute security.",
    ],
  },
  {
    title: "Children's privacy",
    paragraphs: [
      "521 is not directed to, and is not intended for use by, children under the age of 13. We do not knowingly collect personal information from children under 13. If we learn that we have collected personal information from a child under 13, we will take steps to delete that information.",
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
      "If you have questions about this policy or your information, visit https://the521app.com/support.",
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
            This page explains how 521 collects, uses, and protects information when you use
            the app and related services.
          </p>
        </div>
      </div>

      <section className="rounded-2xl border border-border bg-background/70 p-5 text-sm leading-7 text-muted-foreground">
        <p>
          <strong className="text-foreground">Effective Date:</strong> 09/06/2026
        </p>
        <p>
          <strong className="text-foreground">Last Updated:</strong> 10/19/2026
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
