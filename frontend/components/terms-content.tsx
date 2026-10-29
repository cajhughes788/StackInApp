"use client"

import { Button } from "@/components/ui/button"

type TermsContentProps = {
  onClose?: () => void
  showCloseButton?: boolean
}

export default function TermsContent({
  onClose,
  showCloseButton = false,
}: TermsContentProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4 text-sm leading-relaxed text-muted-foreground">
        <section>
          <p><strong>Effective Date:</strong> 04/27/2026</p>
          <p><strong>Last Updated:</strong> 10/29/2026</p>
          <p><strong>Owner:</strong> Optivium AI Solutions LLC</p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">1. Acceptance of These Terms</h3>
          <p>
            These Terms and Conditions govern your access to and use of 521 and any related
            websites, mobile applications, software, content, and services we provide. By clicking
            to accept, creating an account, downloading, accessing, subscribing to, or using
            521, you agree to these terms. If you do not agree, do not use the app.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">2. Eligibility and Authority</h3>
          <p>
            You must be at least 18 years old and legally able to enter into a binding agreement
            to use 521. If you use 521 on behalf of a business, employer, or other entity,
            you represent that you have authority to bind that entity to these terms.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">3. What 521 Does</h3>
          <p>
            521 is a financial organization and income-tracking tool. Depending on your plan
            and device, features may include work-entry tracking, W-2 and independent income
            logging, expense tracking, receipt capture, OCR-assisted data extraction, profit and
            loss summaries, paycheck and withholding estimates, pay stub generation, reminders,
            workspace management, notifications, and premium features. For independent
            workspaces, features may also include invoicing, online payments and Charge now
            through Stripe, a client list, appointment booking and a public booking page,
            appointment deposits, reminders sent to your clients, calendar sync, and blocking busy
            times from calendars you connect.
          </p>
          <p>
            521 is designed to help you organize information. It is not represented as an
            official bookkeeping system of record, payroll processor, payroll administrator,
            employer, employer-of-record, consumer reporting agency, bank, lender, money
            transmitter, payment processor, tax filing service, tax preparation service, or
            government reporting platform.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">4. No Tax, Legal, Accounting, Payroll, or Financial Advice</h3>
          <p>
            521 does not provide tax, legal, accounting, payroll, audit, investment, or
            financial advice, and no fiduciary, advisory, attorney-client, accountant-client, or
            similar professional relationship is created by your use of the app.
          </p>
          <p>
            Any estimates, categorizations, summaries, paycheck calculations, withholding
            projections, pay stubs, tax-related outputs, or other generated materials are for
            informational and organizational purposes only. You are responsible for getting advice
            from qualified professionals before relying on any output for taxes, payroll,
            accounting, wage-and-hour compliance, worker classification, employment verification,
            lending, housing, immigration, public benefits, insurance, or legal purposes.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">5. No Guarantee of Accuracy or Acceptance</h3>
          <p>
            521 depends on information from you, your device, and in some cases third-party
            services. You are solely responsible for ensuring your entries, imported records,
            expense details, rates, dates, tax profile information, and other inputs are accurate,
            complete, lawful, and current.
          </p>
          <p>
            You are also solely responsible for reviewing and verifying all outputs before using
            them. We do not guarantee that any estimate, calculation, category suggestion, report,
            reminder, or generated record will be accurate, complete, current, accepted by any
            employer, worker, accountant, lender, insurer, government agency, court, or other
            third party, or suitable for your intended purpose.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">6. Generated Records and Reports</h3>
          <p>
            Any pay stubs, summaries, reports, statements, profit and loss outputs, receipt
            extractions, tax estimates, or similar materials generated by 521 are based on
            user-supplied or third-party-supplied data and app logic. Unless we expressly state
            otherwise in writing, they are not official payroll records, certified accounting
            statements, audited financial statements, tax returns, government filings, or legal
            documents.
          </p>
          <p>
            You may not use 521 to create, submit, distribute, or present false, misleading,
            unauthorized, or deceptively altered documents or to misrepresent your identity,
            employment status, income, expenses, tax position, or business records.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">7. Automated Features, OCR, and Suggestions</h3>
          <p>
            Some 521 features may use automation, OCR, rules, heuristics, machine learning, or
            similar technologies to extract, suggest, classify, summarize, or generate
            information. These features are provided for convenience only and may make mistakes,
            omit information, or produce misleading or incomplete results.
          </p>
          <p>
            You remain responsible for checking and approving anything created or suggested by
            those features before relying on it.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">8. Device Permissions, Notifications, and Location-Based Features</h3>
          <p>
            Certain features may request access to notifications, camera, photos, location, or
            other device permissions in order to provide receipt capture, reminders, geofence
            alerts, and similar functionality.
          </p>
          <p>
            If you enable those features, you authorize 521 to use the relevant permissions for
            those purposes. You acknowledge that reminders and location-based features may be
            delayed, inaccurate, incomplete, duplicated, or unavailable due to device settings,
            battery restrictions, operating system behavior, connectivity, third-party platform
            limitations, or disabled permissions. These features are convenience tools only and
            must not be relied on for safety-critical, payroll-critical, tax-critical,
            compliance-critical, or legal purposes.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">9. Invoices, Online Payments, and Charge Now</h3>
          <p>
            521 lets you send invoices, take payments by QR code (&quot;Charge now&quot;), and collect
            appointment deposits and balances. Online payments are processed by Stripe, Inc. through
            a payment account you open with Stripe. By setting up online payments, you agree to
            Stripe&apos;s Connected Account Agreement and other applicable Stripe terms
            (stripe.com/legal), and you authorize 521 to create and manage payments, refunds, and
            payout records on your Stripe account as needed for the features you use.
          </p>
          <p>
            521 does not hold your funds. Money your clients pay online goes to your Stripe account,
            and Stripe pays it out to you. Stripe&apos;s fees, reviews, holds, reserves, and payout
            timing are set by Stripe, not by 521.
          </p>
          <p>
            You are the seller in every sale you make with 521. You are solely responsible for the
            goods and services you provide, your prices, any taxes you owe or must collect, the
            receipts and records the law requires of you, and refunds, disputes, and chargebacks
            with your clients, including any fees Stripe charges for them. 521 is not a party to any
            sale between you and your clients. Payments you record as made another way (such as cash
            or a payment app) are your own records, and you are responsible for their accuracy.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">10. Booking, Deposits, and Cancellation Policies</h3>
          <p>
            521 lets you take appointments, publish a booking page, ask for deposits, send
            reminders, move appointments, and block times you are busy in calendars you connect. You
            choose your services, prices, hours, deposits, cancellation cutoff, and whether and until
            when clients may move their own appointments. These are your policies with your clients;
            521 shows them to your clients and applies them on your behalf.
          </p>
          <p>
            When a client cancels before your cancellation cutoff, 521 refunds a deposit they paid
            online through Stripe; after the cutoff, or when an appointment is marked as a no-show,
            the deposit is kept, as your settings say. When you cancel an appointment, its deposit is
            refunded. You are responsible for making sure your policies are lawful, clearly
            communicated, and honored, and for resolving any disagreement with a client about them.
          </p>
          <p>
            521 works to prevent double-booking, but the times offered depend on your settings, on
            calendars you connect (which may be out of date), and on device, network, and
            third-party conditions. You are responsible for confirming your schedule. 521 is not
            liable for missed or double-booked appointments, appointments booked during times you
            meant to keep free, lost revenue, or reminders and notifications that are delayed,
            duplicated, or not delivered.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">11. Your Clients and Messages Sent on Your Behalf</h3>
          <p>
            Your client list holds information you enter and information clients submit when they
            book through your booking page. You represent that you have the right to collect, store,
            and use that information and to contact those clients, and you are responsible for your
            own obligations to them, including any privacy notices and consents the law requires of
            you.
          </p>
          <p>
            At your direction, 521 sends transactional emails to your clients, such as invoices,
            payment reminders, appointment confirmations, reminders, and notices that an appointment
            was moved or canceled. They are sent from a 521 address with your business name, and
            replies go to the business email you set. You may not use these features to send
            marketing, spam, or messages your clients have not agreed to receive, or to impersonate
            anyone. Text messages you send from your own device are sent by you, through your own
            phone and carrier.
          </p>
          <p>
            Your booking page shows your business name, logo, contact details, services, prices, and
            open times to anyone who has the link. Private appointment and invoice links let anyone
            who has them view that appointment or invoice and act on it (for example, pay, cancel, or
            move it); share them only with the intended client. Calendar links you add or create are
            private and should be kept like a password.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">12. Offline Use, Local Storage, and Sync</h3>
          <p>
            Some 521 features may support caching, offline entry, delayed synchronization, or
            queued actions. Because of that, information shown on your device may temporarily differ
            from server data, and sync actions may be delayed, duplicated, partially applied, or
            fail altogether.
          </p>
          <p>
            You are responsible for confirming that important data has been entered, saved, and
            synchronized properly.
          </p>
          <p>
            You should keep your own backup copies of any information you consider important,
            including records you may need for tax, payroll, accounting, compliance, employment, or
            legal purposes.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">13. Accounts and Security</h3>
          <p>
            You are responsible for maintaining accurate account information, safeguarding your
            login credentials, and all activity that occurs under your account. You must notify us
            promptly if you suspect unauthorized use, credential compromise, or a security issue
            affecting your account or device. You may not share your account in a way that bypasses
            plan limits, security controls, or authorized-use restrictions.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">14. Limited License</h3>
          <p>
            Subject to your compliance with these terms, we grant you a limited, personal,
            non-exclusive, non-transferable, non-sublicensable, revocable license to use 521
            for your internal lawful use during your authorized access period. 521 is licensed,
            not sold.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">15. Access and Availability</h3>
          <p>
            Access to 521 may depend on account status, eligibility, device compatibility,
            regional availability, and technical requirements. Features, limits, and availability
            may change over time as we update, improve, secure, or maintain the service.
          </p>
          <p>
            We may modify, suspend, or discontinue parts of 521 at any time, with or without
            notice, to the extent permitted by law. We are not liable for any modification,
            suspension, interruption, or discontinuation of any feature or part of the service.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">16. Device Platforms</h3>
          <p>
            If you download or access 521 through a third-party device platform or
            distributor, you acknowledge that the platform provider is not a party to these terms
            and is not responsible for 521, its content, maintenance, support, or claims
            relating to 521, except to the extent required by applicable law or mandatory
            platform terms.
          </p>
          <p>
            Your use of 521 must also comply with the applicable platform&apos;s usage rules, terms,
            and technical limitations. To the extent permitted by law, applicable platform
            providers are third-party beneficiaries of this section and may enforce it against you.
          </p>
        </section>

        <section id="privacy">
          <h3 className="font-semibold text-foreground">17. Privacy and Electronic Communications</h3>
          <p>
            Your use of 521 is also subject to our Privacy Policy. By using the app, you
            consent to the collection, use, storage, and processing of information as described in
            that policy and as reasonably necessary to operate, secure, support, maintain, and
            improve 521.
          </p>
          <p>
            You also agree that we may send you service-related notices and other legally required
            communications electronically, including through the app, by email, or by other
            reasonable digital means. You are responsible for keeping your email address and other
            contact information current.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">18. Your Content and Data</h3>
          <p>
            As between you and Optivium AI Solutions LLC, you retain ownership of the information
            and content you submit to 521. You grant us a worldwide, non-exclusive,
            royalty-free license to host, store, reproduce, process, format, transmit, and use
            that content only as necessary to operate, provide, secure, troubleshoot, support,
            improve, and enforce 521 and these terms.
          </p>
          <p>
            You represent that you have the rights, notices, and permissions needed to submit any
            data or content you provide, including information about other people, and that your
            submission and our permitted use of it will not violate any law or third-party rights.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">19. Feedback</h3>
          <p>
            If you send us suggestions, ideas, requests, or feedback about 521, you allow us
            to use that feedback without restriction or compensation to you.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">20. Prohibited Uses</h3>
          <p>
            You may not use 521 for any unlawful, fraudulent, deceptive, abusive, harmful, or
            unauthorized purpose. This includes attempting to access another user’s data,
            interfering with app operations, submitting false information, reverse engineering the
            app, bypassing security or usage limits, reselling unauthorized access, scraping data,
            uploading malicious code, infringing intellectual property rights, or using 521 in
            violation of tax, payroll, employment, privacy, consumer protection, sanctions, export,
            or financial recordkeeping laws. It also includes using 521 to fabricate, falsify,
            or deceptively alter pay stubs, income records, receipts, tax-related information, or
            other documents, or to mislead employers, workers, lenders, landlords, insurers,
            regulators, courts, or government agencies. It also includes using 521 to send spam or
            unwanted messages, to take payments for unlawful goods or services or for anything other
            than a genuine sale, or to collect deposits or payments you do not intend to honor.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">21. Third-Party Services and Content</h3>
          <p>
            521 may rely on or integrate with third-party services such as authentication,
            cloud hosting, notifications, app stores, analytics, maps, OCR, payment processing
            (Stripe), bank connections (Plaid), email delivery, calendar providers, or other service
            providers. We are not responsible for the availability, accuracy, security, legality,
            or terms of any third-party services, content, or products. Those providers may
            change, suspend, or discontinue their services at any time.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">22. Beta or Experimental Features</h3>
          <p>
            We may offer beta, preview, early access, or experimental features from time to time.
            Those features may be incomplete, unstable, changed, or removed at any time and are
            provided on an as-is basis with no special guarantees.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">23. Service Availability and Changes</h3>
          <p>
            We may modify, improve, restrict, suspend, or discontinue all or part of 521 at
            any time, with or without notice, to the extent permitted by law. We do not guarantee
            uninterrupted availability, continued support for any feature, or that 521 will be
            error-free, secure, or compatible with every device or operating system version.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">24. Suspension, Termination, and Account Deletion</h3>
          <p>
            We may suspend or terminate your access to 521, with or without notice, if we
            believe you violated these terms, created legal, financial, or security risk, failed
            to meet applicable requirements, or used the app in a way that may harm us, other
            users, or third parties.
          </p>
          <p>
            You may request account deletion, subject to identity verification and any applicable
            legal, contractual, technical, fraud-prevention, tax, security, or record-retention
            requirements. Deleting the app from your device does not necessarily delete your
            account or stored data.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">25. Intellectual Property</h3>
          <p>
            521, including its software, code, design, branding, interfaces, text, graphics,
            underlying technology, and related intellectual property, is owned by Optivium AI
            Solutions LLC or its licensors and is protected by law. Except for the limited rights
            expressly granted in these terms, no rights are granted to you.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">26. Disclaimer of Warranties</h3>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, 521 IS PROVIDED &quot;AS IS&quot; AND &quot;AS
            AVAILABLE.&quot; WE DISCLAIM ALL WARRANTIES, WHETHER EXPRESS, IMPLIED, STATUTORY, OR
            OTHERWISE, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
            PURPOSE, TITLE, NON-INFRINGEMENT, ACCURACY, SECURITY, AVAILABILITY, AND QUIET
            ENJOYMENT.
          </p>
          <p>
            WITHOUT LIMITING THE FOREGOING, WE DO NOT WARRANT THAT ANY DATA, ESTIMATE,
            CLASSIFICATION, GENERATED DOCUMENT, REMINDER, RECEIPT EXTRACTION, LOCATION-BASED
            FEATURE, SYNC PROCESS, BOOKING OR AVAILABILITY, PAYMENT, REFUND, MESSAGE TO YOUR
            CLIENTS, CALENDAR CONNECTION, OR THIRD-PARTY INTEGRATION WILL BE ACCURATE, COMPLETE, CURRENT,
            ACCEPTED BY THIRD PARTIES, ERROR-FREE, SECURE, OR UNINTERRUPTED.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">27. Limitation of Liability</h3>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, OPTIVIUM AI SOLUTIONS LLC AND ITS AFFILIATES,
            OFFICERS, MEMBERS, EMPLOYEES, CONTRACTORS, LICENSORS, AND SERVICE PROVIDERS WILL NOT BE
            LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE
            DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, SAVINGS, TAX BENEFITS, BUSINESS
            OPPORTUNITY, GOODWILL, DATA, OR BUSINESS INTERRUPTION, ARISING OUT OF OR RELATING TO
            521 OR THESE TERMS, WHETHER IN CONTRACT, TORT, NEGLIGENCE, STRICT LIABILITY,
            STATUTE, OR ANY OTHER LEGAL THEORY, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
          </p>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL AGGREGATE LIABILITY FOR ALL CLAIMS
            ARISING OUT OF OR RELATING TO 521 OR THESE TERMS WILL NOT EXCEED THE GREATER OF
            THE AMOUNT YOU PAID TO US FOR 521 IN THE TWELVE MONTHS BEFORE THE EVENT GIVING RISE
            TO THE CLAIM OR USD $100.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">28. Indemnification</h3>
          <p>
            You agree to defend, indemnify, and hold harmless Optivium AI Solutions LLC and its
            affiliates, officers, members, employees, contractors, licensors, and service
            providers from and against any claims, liabilities, damages, losses, judgments, fines,
            penalties, costs, and expenses, including reasonable attorneys’ fees, arising out of
            or related to your use of 521, your data, your content, your violation of these
            terms, or your violation of any law or third-party rights.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">29. Dispute Resolution; Arbitration; Class Action Waiver</h3>
          <p>
            To the maximum extent permitted by law, you and Optivium AI Solutions LLC agree to try
            to resolve disputes informally first. Except for disputes that qualify for small claims
            court, disputes that are not resolved informally will be resolved on an individual basis
            through binding arbitration instead of in court before a judge or jury. The Federal
            Arbitration Act and federal arbitration law govern the interpretation and enforcement of
            this section. Unless applicable law requires otherwise, the arbitration will be
            administered by the American Arbitration Association under its applicable consumer
            arbitration rules, as modified by these terms.
          </p>
          <p>
            You and we each waive any right to participate in a class action, class arbitration,
            private attorney general action, or other representative proceeding. If applicable law
            does not allow arbitration or class action waiver for a particular claim, that claim
            will proceed only to the extent required by law and the remainder of this section will
            still apply as far as permitted.
          </p>
          <p>
            Nothing in this section prevents either party from seeking qualifying small claims
            relief or temporary or preliminary injunctive relief in a court of competent
            jurisdiction to protect intellectual property, confidential information, security, or
            data pending completion of arbitration.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">30. Governing Law</h3>
          <p>
            Except to the extent preempted by applicable federal law or otherwise required by
            mandatory law, these terms are governed by the laws of the state in which Optivium AI
            Solutions LLC is organized, without regard to conflict-of-law rules. If a dispute is
            permitted to proceed in court rather than arbitration, you and we consent to the
            personal jurisdiction of the state and federal courts located in that state, subject to
            any non-waivable rights you may have under applicable law.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">31. Updates to These Terms</h3>
          <p>
            We may update these terms from time to time. If we make material changes, we may
            provide notice by updating the date above, posting updated terms in the app, emailing
            you, or using other reasonable means. Your continued use of 521 after updated terms
            become effective constitutes acceptance of the revised terms.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">32. Miscellaneous</h3>
          <p>
            These terms, together with any incorporated policies or additional terms presented to
            you, form the entire agreement between you and us regarding 521. If any provision
            is held unenforceable, the remaining provisions will remain in effect. Our failure to
            enforce any provision is not a waiver. We may assign these terms in connection with a
            merger, acquisition, corporate reorganization, or sale of assets. Except as expressly
            stated in these terms, there are no third-party beneficiaries. Sections that by their
            nature should survive termination will survive termination.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">33. Contact Information</h3>
          <p>Optivium AI Solutions LLC</p>
          <p>
            For support, legal notices, or terms-related questions, please use the contact
            information provided through 521 or our official business contact channels,
            including the contact information we make available at the521app.com.
          </p>
        </section>

        <section className="mt-6 border-t pt-4 text-center">
          <p className="italic">
            By using 521, you acknowledge that you have read and understood these Terms and
            Conditions, that 521 provides organizational and informational tools only, and that
            you are responsible for reviewing and verifying any output before relying on it.
          </p>
        </section>
      </div>

      {showCloseButton && onClose ? (
        <div className="border-t px-6 py-4">
          <Button className="w-full" onClick={onClose} type="button">
            Done
          </Button>
        </div>
      ) : null}
    </div>
  )
}
