import sgMail from "@sendgrid/mail";
import { defineSecret } from "firebase-functions/params";
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
export { SENDGRID_API_KEY };

function formatSendGridError(error: unknown): Error {
    if (!(error instanceof Error)) {
        return new Error("Support email failed to send");
    }
    const maybeResponseErrors = (error as Error & {
        response?: {
            body?: {
                errors?: Array<{
                    message?: string;
                    field?: string;
                    help?: string;
                }>;
            };
        };
    }).response?.body?.errors;
    if (Array.isArray(maybeResponseErrors) && maybeResponseErrors.length > 0) {
        const firstError = maybeResponseErrors[0];
        const messageParts = [
            firstError.message,
            firstError.field ? `field: ${firstError.field}` : null,
            firstError.help ?? null,
        ].filter(Boolean);
        return new Error(messageParts.join(" | "));
    }
    if (error.message?.trim()) {
        return error;
    }
    return new Error("Support email failed to send");
}

type SupportEmailPayload = {
    to: string;
    userId: string;
    userEmail: string | null;
    kind: "help" | "problem" | "question" | "feedback";
    message: string;
    context: {
        route: string;
        workspaceId: string | null;
        workspaceType: string | null;
        workspaceName: string | null;
        deviceType: string;
        platform: string;
        buildId: string | null;
        userAgent: string;
        capturedAt: string;
        recentLogs: Array<{
            ts: string;
            level: "info" | "error";
            source: string;
            event: string;
            payload?: Record<string, unknown>;
        }>;
    };
};

export async function sendPayStubEmail(to: string, stub: any) {
    try {
        sgMail.setApiKey(SENDGRID_API_KEY.value());
        const subject = `Your Pay Stub (${stub.periodStart} – ${stub.periodEnd})`;
        const text = `
Your pay stub for ${stub.periodStart} – ${stub.periodEnd} is ready.

Gross Income: $${stub.grossIncome.toFixed(2)}
Net Income: $${stub.netIncome.toFixed(2)}

You can also view this in your Safe Money account.
`;
        const html = `
    <h2>Your Pay Stub: ${stub.periodStart} – ${stub.periodEnd}</h2>
    <table border="1" cellspacing="0" cellpadding="6">
      <tr><td><b>Gross Income</b></td><td>$${stub.grossIncome.toFixed(2)}</td></tr>
      <tr><td><b>Net Income</b></td><td>$${stub.netIncome.toFixed(2)}</td></tr>
    </table>
    <p>You can view the full breakdown in your Safe Money app.</p>
  `;
        const msg = {
            to,
            from: "optiviumai@gmail.com", // verified sender in SendGrid
            subject,
            text,
            html,
        };
        await sgMail.send(msg);
    }
    catch (error) {
        throw formatSendGridError(error);
    }
}

export async function sendSupportEmail(payload: SupportEmailPayload) {
    try {
        sgMail.setApiKey(SENDGRID_API_KEY.value());
        const subject = `[StackIn Support] ${payload.kind} - ${payload.context.route}`;
        const serializedLogs = payload.context.recentLogs.length > 0
            ? payload.context.recentLogs.map((entry) => JSON.stringify(entry)).join("\n")
            : "No recent client logs captured.";
        const text = `
Support request type: ${payload.kind}

User message:
${payload.message}

User:
- UID: ${payload.userId}
- Email: ${payload.userEmail ?? "unknown"}

Context:
- Route: ${payload.context.route}
- Workspace ID: ${payload.context.workspaceId ?? "none"}
- Workspace Type: ${payload.context.workspaceType ?? "none"}
- Workspace Name: ${payload.context.workspaceName ?? "none"}
- Device Type: ${payload.context.deviceType}
- Platform: ${payload.context.platform}
- Build ID: ${payload.context.buildId ?? "unknown"}
- Captured At: ${payload.context.capturedAt}
- User Agent: ${payload.context.userAgent}

Recent Client Logs:
${serializedLogs}
`;
        const html = `
    <h2>StackIn Support Request</h2>
    <p><b>Type:</b> ${payload.kind}</p>
    <p><b>User ID:</b> ${payload.userId}</p>
    <p><b>User Email:</b> ${payload.userEmail ?? "unknown"}</p>
    <p><b>Route:</b> ${payload.context.route}</p>
    <p><b>Workspace ID:</b> ${payload.context.workspaceId ?? "none"}</p>
    <p><b>Workspace Type:</b> ${payload.context.workspaceType ?? "none"}</p>
    <p><b>Workspace Name:</b> ${payload.context.workspaceName ?? "none"}</p>
    <p><b>Device Type:</b> ${payload.context.deviceType}</p>
    <p><b>Platform:</b> ${payload.context.platform}</p>
    <p><b>Build ID:</b> ${payload.context.buildId ?? "unknown"}</p>
    <p><b>Captured At:</b> ${payload.context.capturedAt}</p>
    <p><b>User Agent:</b> ${payload.context.userAgent}</p>
    <h3>User Message</h3>
    <pre>${payload.message}</pre>
    <h3>Recent Client Logs</h3>
    <pre>${serializedLogs}</pre>
  `;
        const msg = {
            to: payload.to,
            from: "optiviumai@gmail.com",
            subject,
            text,
            html,
        };
        await sgMail.send(msg);
    }
    catch (error) {
        throw formatSendGridError(error);
    }
}
