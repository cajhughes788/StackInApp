// /shared/estimatedTax/tippedOccupations.ts
// ------------------------------------------------------------
// Treasury Tipped Occupation Codes (TTOC): the 71 occupations whose tips
// can qualify for the "no tax on tips" deduction. Final rule published in
// the Federal Register Apr 13, 2026 (FR Doc. 2026-07104; IRS list at
// irs.gov/tippedoccupations). The list is exhaustive: a job not on it
// doesn't qualify.
//
// `specifiedServiceRisk`: tips earned in a "specified service trade or
// business" (performing arts, health, athletics, consulting…) don't
// qualify. For a self-employed person these occupations may fall in one,
// so the estimate leaves the deduction out and says a tax pro can confirm
// — the cautious choice.
// ------------------------------------------------------------

export type TippedOccupation = {
  code: string
  title: string
  category: string
  specifiedServiceRisk?: true
}

const C = {
  food: "Beverage and Food Service",
  entertainment: "Entertainment and Events",
  hospitality: "Hospitality and Guest Services",
  home: "Home Services",
  personal: "Personal Services",
  appearance: "Personal Appearance and Wellness",
  recreation: "Recreation and Instruction",
  transport: "Transportation and Delivery",
} as const

export const TIPPED_OCCUPATIONS: TippedOccupation[] = [
  { code: "101", title: "Bartenders", category: C.food },
  { code: "102", title: "Wait Staff", category: C.food },
  { code: "103", title: "Food or Beverage Servers, Non-restaurant", category: C.food },
  { code: "104", title: "Dining Room and Cafeteria Attendants and Bartender Helpers", category: C.food },
  { code: "105", title: "Chefs and Cooks", category: C.food },
  { code: "106", title: "Food Preparation Workers", category: C.food },
  { code: "107", title: "Fast Food and Counter Workers", category: C.food },
  { code: "108", title: "Dishwashers", category: C.food },
  { code: "109", title: "Host Staff, Restaurant, Lounge, and Coffee Shop", category: C.food },
  { code: "110", title: "Bakers", category: C.food },

  { code: "201", title: "Gambling Dealers", category: C.entertainment },
  { code: "202", title: "Gambling Change Persons and Booth Cashiers", category: C.entertainment },
  { code: "203", title: "Gambling Cage Workers", category: C.entertainment },
  { code: "204", title: "Gambling and Sports Book Writers and Runners", category: C.entertainment },
  { code: "205", title: "Dancers", category: C.entertainment, specifiedServiceRisk: true },
  { code: "206", title: "Musicians and Singers", category: C.entertainment, specifiedServiceRisk: true },
  { code: "207", title: "Disc Jockeys, Except Radio", category: C.entertainment, specifiedServiceRisk: true },
  { code: "208", title: "Entertainers and Performers", category: C.entertainment, specifiedServiceRisk: true },
  { code: "209", title: "Digital Content Creators", category: C.entertainment, specifiedServiceRisk: true },
  { code: "210", title: "Ushers, Lobby Attendants, and Ticket Takers", category: C.entertainment },
  { code: "211", title: "Locker Room, Coatroom, and Dressing Room Attendants", category: C.entertainment },

  { code: "301", title: "Baggage Porters and Bellhops", category: C.hospitality },
  { code: "302", title: "Concierges", category: C.hospitality },
  { code: "303", title: "Hotel, Motel, and Resort Desk Clerks", category: C.hospitality },
  { code: "304", title: "Maids and Housekeeping Cleaners", category: C.hospitality },

  { code: "401", title: "Home Maintenance and Repair Workers", category: C.home },
  { code: "402", title: "Home Landscaping and Groundskeeping Workers", category: C.home },
  { code: "403", title: "Home Electricians", category: C.home },
  { code: "404", title: "Home Plumbers", category: C.home },
  { code: "405", title: "Home Heating and Air Conditioning Mechanics and Installers", category: C.home },
  { code: "406", title: "Home Appliance Installers and Repairers", category: C.home },
  { code: "407", title: "Home Cleaning Service Workers", category: C.home },
  { code: "408", title: "Locksmiths", category: C.home },
  { code: "409", title: "Roadside Assistance Workers", category: C.home },

  { code: "501", title: "Personal Care and Service Workers", category: C.personal },
  { code: "502", title: "Private Event Planners", category: C.personal },
  { code: "503", title: "Private Event and Portrait Photographers", category: C.personal },
  { code: "504", title: "Private Event Videographers", category: C.personal },
  { code: "505", title: "Event Officiants", category: C.personal },
  { code: "506", title: "Pet and Show Animal Caretakers", category: C.personal },
  { code: "507", title: "Tutors", category: C.personal },
  { code: "508", title: "Nannies and Babysitters", category: C.personal },
  { code: "509", title: "Visual Artists", category: C.personal },
  { code: "510", title: "Floral Designers", category: C.personal },

  { code: "601", title: "Skincare Specialists", category: C.appearance },
  { code: "602", title: "Massage Therapists", category: C.appearance, specifiedServiceRisk: true },
  { code: "603", title: "Barbers, Hairdressers, Hairstylists, and Cosmetologists", category: C.appearance },
  { code: "604", title: "Shampooers", category: C.appearance },
  { code: "605", title: "Manicurists and Pedicurists", category: C.appearance },
  { code: "606", title: "Eyebrow and Eyelash Technicians", category: C.appearance },
  { code: "607", title: "Makeup Artists", category: C.appearance },
  { code: "608", title: "Exercise Trainers and Group Fitness Instructors", category: C.appearance, specifiedServiceRisk: true },
  { code: "609", title: "Tattoo Artists and Piercers", category: C.appearance },
  { code: "610", title: "Tailors", category: C.appearance },
  { code: "611", title: "Shoe and Leather Workers and Repairers", category: C.appearance },

  { code: "701", title: "Golf Caddies", category: C.recreation },
  { code: "702", title: "Self-Enrichment Teachers", category: C.recreation },
  { code: "703", title: "Recreational and Tour Pilots", category: C.recreation },
  { code: "704", title: "Tour Guides", category: C.recreation },
  { code: "705", title: "Travel Guides", category: C.recreation },
  { code: "706", title: "Sports and Recreation Instructors", category: C.recreation, specifiedServiceRisk: true },

  { code: "801", title: "Parking and Valet Attendants", category: C.transport },
  { code: "802", title: "Taxi and Rideshare Drivers and Chauffeurs", category: C.transport },
  { code: "803", title: "Shuttle Drivers", category: C.transport },
  { code: "804", title: "Goods Delivery People", category: C.transport },
  { code: "805", title: "Personal Vehicle and Equipment Cleaners", category: C.transport },
  { code: "806", title: "Private and Charter Bus Drivers", category: C.transport },
  { code: "807", title: "Water Taxi Operators and Charter Boat Workers", category: C.transport },
  { code: "808", title: "Rickshaw, Pedicab, and Carriage Drivers", category: C.transport },
  { code: "809", title: "Home Movers", category: C.transport },
  { code: "810", title: "Gas Pump Attendants", category: C.transport },
]

// "None of these" in the occupation question.
export const NO_TIPPED_OCCUPATION = "none"

export function findTippedOccupation(code: string | null | undefined): TippedOccupation | null {
  if (!code) return null
  return TIPPED_OCCUPATIONS.find((occupation) => occupation.code === code) ?? null
}
