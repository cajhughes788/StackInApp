// Tax audit, part 4: about 200 real-life situations whose Taxes page
// results are saved per tax year in tax-<year>.golden.json
// (scripts/test-tax-golden.cjs). Each is a person's records, answers and
// the day they look, described so a failure reads like a sentence. They're
// written for 2026; buildScenarios(year) moves every date to that year
// (and adds leap-day situations in leap years).

// ---------------------------------------------------------------------------
// People: a month of business income, expenses and tips.
// ---------------------------------------------------------------------------

const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]

// month index 0–11 → { services, tips, expenses }
const PEOPLE = {
  stylist: {
    about: "hair stylist, $4,200 a month plus $800 tips, $1,100 expenses",
    occupationCode: "603",
    month: () => ({ services: 4200, tips: 800, expenses: 1100 }),
  },
  photographer: {
    about: "wedding photographer, busy May–October",
    occupationCode: null,
    month: (i) => (i >= 4 && i <= 9 ? { services: 11_000, tips: 0, expenses: 2_400 } : { services: 1_500, tips: 0, expenses: 900 }),
  },
  consultant: {
    about: "consultant, $38,000 a month, $3,000 expenses",
    occupationCode: null,
    month: () => ({ services: 38_000, tips: 0, expenses: 3_000 }),
  },
  sideGig: {
    about: "weekend bartender, $900 a month plus $600 tips",
    occupationCode: "101",
    month: () => ({ services: 900, tips: 600, expenses: 100 }),
  },
  tiny: {
    about: "small craft sales, $350 a month, $120 expenses",
    occupationCode: null,
    month: () => ({ services: 350, tips: 0, expenses: 120 }),
  },
  losing: {
    about: "new studio, $1,500 a month in, $3,800 out",
    occupationCode: null,
    month: () => ({ services: 1_500, tips: 0, expenses: 3_800 }),
  },
  growing: {
    about: "growing business, $2,000 a month rising $600 each month",
    occupationCode: null,
    month: (i) => ({ services: 2_000 + 600 * i, tips: 0, expenses: 700 }),
  },
  massage: {
    about: "massage therapist, $5,000 a month plus $700 tips",
    occupationCode: "602",
    month: () => ({ services: 5_000, tips: 700, expenses: 900 }),
  },
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const BASE_ANSWERS = {
  filingStatus: "single",
  qualifyingChildren: 0,
  spouseHasIncome: false,
  investmentOrRentalIncome: false,
  itemizesDeductions: false,
  businessStartDate: null,
  priorYearTax: null,
  priorYearAgi: null,
  // W-2: hasW2Job when there's no W-2 workspace; w2AllRecorded when there
  // is (run.cjs). unrecordedW2Pay is a yearly amount not in 521.
  hasW2Job: false,
  w2AllRecorded: true,
  unrecordedW2Pay: null,
  unrecordedW2Tips: null,
  w2OccupationCode: null,
  // Optional pay stub (year-to-date federal withholding), with W-2 pay.
  ytdWithholding: null,
  withholdingAsOf: null,
  confirmedComplete: true,
  remindersEnabled: true,
  stateCode: "TX",
  answered: true,
}

const scenarios = []
function add(name, spec) {
  scenarios.push({
    name,
    person: "stylist",
    today: "2026-09-10",
    // First month with records (1-based); records start on the 1st.
    startMonth: 1,
    answers: {},
    w2PerMonth: 0,
    // Tips within that W-2 pay, reported to the employer.
    w2TipsPerMonth: 0,
    payments: [],
    problems: {},
    ...spec,
    answers: { ...BASE_ANSWERS, ...(spec.answers ?? {}) },
  })
}

const KIDS = { single: 0, marriedJoint: 1, marriedSeparate: 0, headOfHousehold: 2 }
const STATUS_LABEL = { single: "single", marriedJoint: "married jointly", marriedSeparate: "married separately", headOfHousehold: "head of household" }
const STATES = ["TX", "FL", "AK", "NV", "NH", "SD", "TN", "WA", "WY", "GA", "IL", "KY", "MI", "NC", "PA"]

// ---------------------------------------------------------------------------
// A. Every filing status in every state the estimate covers (60)
// ---------------------------------------------------------------------------

for (const stateCode of STATES) {
  for (const filingStatus of Object.keys(KIDS)) {
    add(`A ${stateCode} — stylist, ${STATUS_LABEL[filingStatus]}, ${KIDS[filingStatus]} kids, Sep 10`, {
      answers: { filingStatus, qualifyingChildren: KIDS[filingStatus], stateCode, priorYearTax: 7_500, priorYearAgi: 52_000 },
    })
  }
}

// ---------------------------------------------------------------------------
// B. Through the year: due dates, the days around them, Jan 1–15 (34)
// ---------------------------------------------------------------------------

const DATES = [
  "2026-02-10", "2026-03-20", "2026-04-08", "2026-04-14", "2026-04-15", "2026-04-16",
  "2026-05-31", "2026-06-01", "2026-06-08", "2026-06-15", "2026-06-16", "2026-08-31",
  "2026-09-01", "2026-09-08", "2026-09-15", "2026-09-16", "2026-10-27", "2026-12-31",
  "2027-01-01", "2027-01-08", "2027-01-15", "2027-01-16",
]
for (const today of DATES) {
  add(`B stylist, single, TX, last year's tax $7,500 — on ${today}`, { today, answers: { priorYearTax: 7_500, priorYearAgi: 52_000 } })
}
for (const today of ["2026-03-20", "2026-04-15", "2026-06-15", "2026-08-31", "2026-09-01", "2026-09-15", "2026-10-27", "2026-12-31", "2027-01-08", "2027-01-15", "2027-01-16", "2026-04-08"]) {
  add(`B stylist, single, TX, no last-year numbers — on ${today}`, { today })
}

// ---------------------------------------------------------------------------
// C. Starting partway through the year (24)
// ---------------------------------------------------------------------------

for (const [startMonth, label] of [[1, "Jan 1"], [4, "Apr 1"], [7, "Jul 1"], [11, "Nov 1"]]) {
  for (const today of ["2026-06-05", "2026-09-10", "2026-12-20", "2027-01-10"]) {
    if (Number(today.slice(5, 7)) < startMonth && today.startsWith("2026")) continue
    add(`C started ${label} (answered), stylist, single, TX — on ${today}`, {
      today,
      startMonth,
      answers: { businessStartDate: startMonth === 1 ? null : `2026-${MONTHS[startMonth - 1]}-01` },
    })
  }
  if (startMonth > 1) {
    add(`C started ${label} but start date not answered, stylist, single, TX — Dec 20`, { today: "2026-12-20", startMonth })
  }
}
add("C started Jul 1 (answered), photographer, married jointly, GA — Oct 27", {
  person: "photographer",
  today: "2026-10-27",
  startMonth: 7,
  answers: { filingStatus: "marriedJoint", qualifyingChildren: 1, stateCode: "GA", businessStartDate: "2026-07-01" },
})
add("C started Sep 1 (answered), stylist — Oct 27, too soon to estimate", {
  today: "2026-10-27",
  startMonth: 9,
  answers: { businessStartDate: "2026-09-01" },
})

// ---------------------------------------------------------------------------
// D. Money situations (about 50)
// ---------------------------------------------------------------------------

const PRIOR = {
  none: {},
  small: { priorYearTax: 2_000, priorYearAgi: 30_000 },
  large: { priorYearTax: 60_000, priorYearAgi: 240_000 },
}
for (const person of ["photographer", "consultant", "sideGig", "tiny", "losing", "growing", "massage"]) {
  for (const [label, prior] of Object.entries(PRIOR)) {
    add(`D ${PEOPLE[person].about} — single, TX, last year ${label}, Sep 10`, { person, answers: prior })
  }
}
for (const person of ["consultant", "photographer"]) {
  for (const filingStatus of ["marriedJoint", "headOfHousehold"]) {
    add(`D ${PEOPLE[person].about} — ${STATUS_LABEL[filingStatus]}, IL, Oct 27`, {
      person,
      today: "2026-10-27",
      answers: { filingStatus, qualifyingChildren: 2, stateCode: "IL", ...PRIOR.small },
    })
  }
}

// W-2 job alongside the business: the estimate is the business's share
for (const w2 of [3_000, 9_000, 16_000]) {
  add(`D stylist plus a W-2 job at $${w2.toLocaleString()}/month, all recorded in 521, Sep 10`, { w2PerMonth: w2, answers: PRIOR.small })
}
add("D stylist plus a $3,000/month W-2 job in 521 and $12,000 a year not recorded, Sep 10", {
  w2PerMonth: 3_000,
  answers: { w2AllRecorded: false, unrecordedW2Pay: 12_000 },
})
add("D stylist with a W-2 job not in 521, $40,000 a year, Sep 10", { answers: { hasW2Job: true, unrecordedW2Pay: 40_000 } })

// W-2 tips: the user's own situation (salon job, mostly tips, plus a side business)
add("D stylist plus a salon W-2 job: $1,490/month, $1,340 of it tips, line of work chosen, Oct 28", {
  today: "2026-10-28",
  w2PerMonth: 1_490,
  w2TipsPerMonth: 1_340,
  answers: { w2OccupationCode: "603", stateCode: "ID" },
})
add("D same salon job, employer says tips don't qualify (Box 14b 000), Oct 28", {
  today: "2026-10-28",
  w2PerMonth: 1_490,
  w2TipsPerMonth: 1_340,
  answers: { w2OccupationCode: "none", stateCode: "ID" },
})
add("D W-2 tips but the job's line of work not chosen — paused, Oct 28", {
  today: "2026-10-28",
  w2PerMonth: 1_490,
  w2TipsPerMonth: 1_340,
})
add("D W-2 job not in 521, $30,000 a year, $20,000 of it tips, Sep 10", {
  answers: { hasW2Job: true, unrecordedW2Pay: 30_000, unrecordedW2Tips: 20_000, w2OccupationCode: "102" },
})

// The optional pay stub: whole return less real withholding
for (const [w2, withheld, label] of [
  // On 36,000 a year, single: (36,000 − 16,100) × 10–12% ≈ 2,140 for the
  // year, so about 1,070 by June 30 is "right".
  [3_000, 1_070, "about right"],
  [3_000, 3_000, "over-withheld"],
  [3_000, 300, "under-withheld"],
]) {
  add(`D stylist plus a $3,000/month W-2 job, pay stub ${label}: $${withheld.toLocaleString()} withheld through Jun 30, Sep 10`, {
    w2PerMonth: w2,
    answers: { ytdWithholding: withheld, withholdingAsOf: "2026-06-30" },
  })
}
add("D stylist plus a $3,000/month W-2 job, pay stub $2,100 through Jun 30, last year's tax $2,000, Sep 10", {
  w2PerMonth: 3_000,
  answers: { ytdWithholding: 2_100, withholdingAsOf: "2026-06-30", ...PRIOR.small },
})
add("D consultant with a W-2 job not in 521, $120,000 a year, married jointly, IL, Dec 20", {
  person: "consultant",
  today: "2026-12-20",
  answers: { hasW2Job: true, unrecordedW2Pay: 120_000, filingStatus: "marriedJoint", qualifyingChildren: 1, stateCode: "IL" },
})
add("D sideGig with a $5,500/month W-2 job, married jointly, MI, Sep 10", {
  person: "sideGig",
  w2PerMonth: 5_500,
  answers: { filingStatus: "marriedJoint", qualifyingChildren: 2, stateCode: "MI" },
})

// Payments already made
for (const [label, payments] of [
  ["one $1,000 payment on Apr 15", [{ amount: 1_000, paidOn: "2026-04-15" }]],
  ["$1,500 on Apr 15 and Jun 15", [{ amount: 1_500, paidOn: "2026-04-15" }, { amount: 1_500, paidOn: "2026-06-15" }]],
  ["overpaid: $20,000 on Jun 15", [{ amount: 20_000, paidOn: "2026-06-15" }]],
]) {
  add(`D stylist, single, TX, paid ${label}, Sep 10`, { payments, answers: PRIOR.small })
  add(`D stylist, single, TX, no last-year numbers, paid ${label}, Sep 10`, { payments })
}
add("D stylist paid on Sep 12 — due date Sep 15, no due-day reminder", { today: "2026-09-15", payments: [{ amount: 900, paidOn: "2026-09-12" }] })
add("D stylist paid Jun 10 only — Sep 15, due-day reminder still sent", { today: "2026-09-15", payments: [{ amount: 900, paidOn: "2026-06-10" }] })
add("D stylist, reminders turned off — Sep 8", { today: "2026-09-08", answers: { remindersEnabled: false } })

// Tips cases
add("D massage therapist (may be a specified service) — tips left out, Sep 10", { person: "massage" })
add("D stylist, line of work not chosen — tips left out, Sep 10", { occupationCode: null })
add("D stylist, line of work 'none of these', Sep 10", { occupationCode: "none" })
add("D stylist, married separately — no tips deduction, Sep 10", { answers: { filingStatus: "marriedSeparate" } })
add("D sideGig bartender, $14,000/month W-2 — tips deduction phases out, Sep 10", { person: "sideGig", w2PerMonth: 14_000 })

// Side income, high earners, losses, tiny amounts
add("D stylist with side income (rough estimate), Sep 10", { answers: { investmentOrRentalIncome: true } })
add("D consultant with side income, married jointly, PA, Sep 10", { person: "consultant", answers: { investmentOrRentalIncome: true, filingStatus: "marriedJoint", stateCode: "PA" } })
add("D consultant, single, TX — above the business-income limit, Dec 20", { person: "consultant", today: "2026-12-20" })
add("D consultant, married jointly, KY — near the business-income limit, Dec 20", { person: "consultant", today: "2026-12-20", answers: { filingStatus: "marriedJoint", stateCode: "KY" } })
add("D losing money all year, with a $4,000/month W-2 job, Oct 27", { person: "losing", today: "2026-10-27", w2PerMonth: 4_000 })
add("D tiny sales, last year's tax $0 — Sep 10", { person: "tiny", answers: { priorYearTax: 0, priorYearAgi: 9_000 } })

// ---------------------------------------------------------------------------
// E. Missing answers and record problems (about 20)
// ---------------------------------------------------------------------------

add("E never answered the questions — Sep 10", { answers: { answered: false, filingStatus: null, qualifyingChildren: null, spouseHasIncome: null, investmentOrRentalIncome: null, itemizesDeductions: null } })
add("E answered but no filing status — Sep 10", { answers: { filingStatus: null } })
add("E W-2 job question not answered — Sep 10", { answers: { hasW2Job: null } })
add("E W-2 workspace added after answering — asked again, Sep 10", { w2PerMonth: 3_000, answers: { w2WorkspaceKey: "an-earlier-set" } })
add("E state not chosen — Sep 10", { answers: { stateCode: null } })
add("E answers not confirmed complete — Sep 10", { answers: { confirmedComplete: false } })
add("E tips recorded, line of work not chosen — Sep 10", { occupationCode: null, answers: { priorYearTax: 7_500, priorYearAgi: 52_000 } })
add("E answered but side-income question blank — Sep 10", { answers: { investmentOrRentalIncome: null } })
add("E itemizes, no last-year numbers — tax pro, Sep 10", { answers: { itemizesDeductions: true } })
add("E itemizes, last year's tax $9,000 — penalty-free only, Sep 10", { answers: { itemizesDeductions: true, priorYearTax: 9_000, priorYearAgi: 70_000 } })
add("E married jointly, spouse has income — tax pro, Sep 10", { answers: { filingStatus: "marriedJoint", spouseHasIncome: true } })
add("E spouse has income, last year's tax $14,000 — penalty-free only, Sep 10", { answers: { filingStatus: "marriedJoint", spouseHasIncome: true, priorYearTax: 14_000, priorYearAgi: 140_000 } })
add("E records start Jun 1, start date not answered — Sep 10", { startMonth: 6 })
add("E no records at all — Sep 10", { startMonth: 13 })
for (const count of [3, 9, 10, 25]) {
  add(`E ${count} unreviewed bank items — Sep 10`, { problems: { pendingBank: count } })
}
add("E 4 uncategorized expenses — Sep 10", { problems: { uncategorized: 4 } })
add("E 12 imported items to review — Sep 10", { problems: { imports: 12 } })
add("E 1 expense the bank reversed — Sep 10", { problems: { reversed: 1 } })
add("E 10 expenses the bank reversed — Sep 10", { problems: { reversed: 10 } })
add("E 5 bank items and 2 uncategorized — rough, Sep 10", { problems: { pendingBank: 5, uncategorized: 2 } })
add("E 25 bank items, last year's tax $2,000 — penalty-free still shown, Sep 10", { problems: { pendingBank: 25 }, answers: PRIOR.small })

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function buildScenarios(year) {
  const move = (value) => {
    if (typeof value === "string") {
      return value.replace(/\b2027\b/g, "\u0000").replace(/\b2026\b/g, String(year)).replace(/\u0000/g, String(year + 1))
    }
    if (Array.isArray(value)) return value.map(move)
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, move(v)]))
    return value
  }
  const moved = scenarios.map((s) => ({ ...move(s), year }))
  if (isLeapYear(year)) {
    for (const today of [`${year}-02-29`, `${year}-03-01`]) {
      moved.push({ ...moved.find((s) => s.name.startsWith("B stylist, single, TX, no last-year numbers")), name: `B leap year: stylist, single, TX — on ${today}`, today })
    }
  }
  return moved
}

module.exports = { scenarios: buildScenarios(2026), buildScenarios, PEOPLE, MONTHS }
