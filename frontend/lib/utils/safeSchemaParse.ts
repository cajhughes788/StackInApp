// /lib/utils/safeSchemaParse.ts
import { z, ZodType } from "zod";
/**
 * ✅ Universal SafeParseReturnType for Zod v4+ (future-proof)
 */
type SafeParseReturnType<I, O> = {
    success: true;
    data: O;
} | {
    success: false;
    error: z.ZodError<I>;
};
/**
 * ✅ Generic result type for schema parsing
 * Infers correct input/output types automatically
 */
export type SchemaParseResult<T extends ZodType<any, any, any>> = SafeParseReturnType<z.input<T>, z.output<T>>;
/**
 * ✅ Convenience type for parsed output
 * Example:
 *   const parsed: InferParsed<typeof Entry.Schema>
 */
export type InferParsed<T extends ZodType<any, any, any>> = z.output<T>;
/**
 * ✅ Unified, production-safe schema parser.
 *
 * Goals:
 *  - Works for static schemas (preferred)
 *  - Infers input/output types automatically
 *  - Never throws on invalid data (returns { success: false })
 *  - Prevents “argument of type () => ZodArray…” and “unknown” errors
 *  - Clean, minimal, tree-shakable
 */
// ---- Primary signature (static schemas) ----
export function safeSchemaParse<T extends ZodType<any, any, any>>(schema: T, data: unknown): SchemaParseResult<T>;
// ---- Optional overload (future schema factories) ----
// export function safeSchemaParse<T extends ZodType<any, any, any>>(
//   schemaFactory: () => T,
//   data: unknown
// ): SchemaParseResult<T>
// ---- Implementation ----
export function safeSchemaParse(schemaOrFactory: ZodType<any, any, any> | (() => ZodType<any, any, any>), data: unknown) {
    try {
        // Resolve the schema (only calls factory if necessary)
        const schema = typeof schemaOrFactory === "function"
            ? schemaOrFactory()
            : schemaOrFactory;
        // Validate the input data
        const result = schema.safeParse(data);
        // Optionally log structured metadata for debugging in dev
        if (!result.success && process.env.NODE_ENV !== "production") {
            const typeName = (schema as any)?._def?.typeName ??
                (schema as any)?._def?.type ??
                "UnknownSchema";
        }
        return result;
    }
    catch (err) {
        // Guard against developer misuse (invalid schema)
        return {
            success: false,
            error: err instanceof Error
                ? err
                : new Error("Unknown schema parse error"),
        };
    }
}
/**
 * Strict variant
 * Throws on failure instead of returning success: false
 * Useful for controlled environments (tests, development)
 */
export function safeSchemaParseStrict<T extends ZodType<any, any, any>>(schema: T, data: unknown): z.output<T> {
    const result = schema.safeParse(data);
    if (!result.success)
        throw result.error;
    return result.data;
}
export type SchemaType<T extends ZodType<any, any, any>> = z.infer<T>;
