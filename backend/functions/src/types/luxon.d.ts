// /functions/src/types/luxon.d.ts
declare module "luxon" {
  export const DateTime: any;
  export type DateTime = any;     // 👈 add this line
  export const Duration: any;
  export type Duration = any;     // optional
  export const Interval: any;
  export type Interval = any;
  export const Settings: any;
  const _default: any;
  export default _default;
}
