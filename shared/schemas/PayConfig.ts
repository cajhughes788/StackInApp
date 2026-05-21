//shared/schema/payConfig

import { z } from "zod"

export const Schema = z.object({
  payFrequency: z.enum(["weekly", "biweekly", "semi-monthly", "monthly"]),
  payPeriodStartDate: z.string(),
})

export type Type = z.infer<typeof Schema>
export type InputType = Type
