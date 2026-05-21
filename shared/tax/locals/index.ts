import { indianaLocalStrategy } from "./indiana"
import { marylandLocalStrategy } from "./maryland"
import { newYorkLocalStrategy } from "./newYork"
import { ohioLocalStrategy } from "./ohio"
import { oregonLocalStrategy } from "./oregon"
import { pennsylvaniaLocalStrategy } from "./pennsylvania"
import type { LocalCalculationResult, LocalTaxStrategy, TaxContext } from "../types"

const localStrategies: LocalTaxStrategy[] = [
  marylandLocalStrategy,
  ohioLocalStrategy,
  indianaLocalStrategy,
  newYorkLocalStrategy,
  pennsylvaniaLocalStrategy,
  oregonLocalStrategy,
]

const defaultLocalCalculation: LocalCalculationResult = {
  localTax: 0,
  calculationMethod: "No local payroll withholding",
}

export function getLocalTaxStrategy(context: TaxContext): LocalTaxStrategy | null {
  return localStrategies.find((strategy) => strategy.applies(context)) ?? null
}

export function calculateLocalTaxes(context: TaxContext): LocalCalculationResult {
  return getLocalTaxStrategy(context)?.calculate(context) ?? defaultLocalCalculation
}

export function calculateLocalTax(context: TaxContext): number {
  return calculateLocalTaxes(context).localTax
}
