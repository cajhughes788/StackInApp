// FINAL VERSION — supports new digit-patterns from EntryForm:
// 1     → "1 AM"
// 11    → "11 AM"
// 111   → "1:11 AM"
// 1111  → "11:11 AM"

export function computeWorkTime(
  inRaw: string | null,
  outRaw: string | null,
  date: string
) {
  if (!inRaw || !outRaw) return { totalHours: 0 };

  const start = parseLooseTime(inRaw);
  const end = parseLooseTime(outRaw);

  if (!start || !end) return { totalHours: 0 };

  const startMinutes = start.hours * 60 + start.minutes;
  let endMinutes = end.hours * 60 + end.minutes;

  // Overnight shift handling
  if (endMinutes <= startMinutes) {
    endMinutes += 24 * 60;
  }

  const totalMinutes = endMinutes - startMinutes;
  const totalHours = Number((totalMinutes / 60).toFixed(4));

  return { totalHours };
}

function parseLooseTime(str: string) {
  const parts = str.trim().split(" ");
  if (parts.length !== 2) return null;

  const timePart = parts[0];
  const period = parts[1].toUpperCase() as "AM" | "PM";
  if (period !== "AM" && period !== "PM") return null;

  // CASE A — already contains colon, normal path
  if (timePart.includes(":")) {
    const [hStr, mStr] = timePart.split(":");
    let h = Number(hStr);
    let m = Number(mStr);
    if (isNaN(h) || isNaN(m)) return null;
    if (m > 59) m = 59;
    return convertTo24(h, m, period);
  }

  // CASE B — NEW LOGIC for raw digits from EntryForm
  const digits = timePart.replace(/\D/g, "");

  // "1" or "11" → hour only
  if (digits.length === 1 || digits.length === 2) {
    const h = Number(digits);
    return convertTo24(h, 0, period);
  }

  // "111" → "1:11"
  if (digits.length === 3) {
    const h = Number(digits[0]);
    const m = Number(digits.slice(1));
    return convertTo24(h, Math.min(m, 59), period);
  }

  // "1111" → "11:11"
  if (digits.length === 4) {
    const h = Number(digits.slice(0, 2));
    const m = Number(digits.slice(2));
    return convertTo24(h, Math.min(m, 59), period);
  }

  return null; // invalid
}

function convertTo24(hours: number, minutes: number, period: "AM" | "PM") {
  let h = hours;

  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;

  return { hours: h, minutes };
}
