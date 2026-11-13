require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
})

const assert = require("node:assert/strict")
const { suggestEmailFix } = require("../frontend/lib/emailTypo.ts")

// Typos in the part after the @ get the provider's real address.
const fixes = {
  "optiviumai@gmal.com": "optiviumai@gmail.com",
  "a@gmial.com": "a@gmail.com",
  "a@gamil.com": "a@gmail.com",
  "a@gmaill.com": "a@gmail.com",
  "a@gnail.com": "a@gmail.com",
  "a@gmail.con": "a@gmail.com",
  "a@gmail.cmo": "a@gmail.com",
  "a@gmail.co": "a@gmail.com",
  "a@gmail.comm": "a@gmail.com",
  "a@gmail": "a@gmail.com",
  "a@yaho.com": "a@yahoo.com",
  "a@yahooo.com": "a@yahoo.com",
  "a@yahoo.co": "a@yahoo.com",
  "a@iclod.com": "a@icloud.com",
  "a@icoud.com": "a@icloud.com",
  "a@outlok.com": "a@outlook.com",
  "a@otlook.com": "a@outlook.com",
  "a@hotmal.com": "a@hotmail.com",
  "a@hotmial.com": "a@hotmail.com",
  "a@aol.con": "a@aol.com",
  "a@comcast.ne": "a@comcast.net",
  "a@verizon.met": "a@verizon.net",
  // Only the provider is changed; the name keeps its letters and case.
  "Jo.Smith+521@GMAL.COM": "Jo.Smith+521@gmail.com",
  "  a@gmal.com  ": "a@gmail.com",
}
for (const [typed, expected] of Object.entries(fixes)) {
  assert.equal(suggestEmailFix(typed), expected, typed)
}

// Correct, unfamiliar or real look-alike addresses get no suggestion.
const leftAlone = [
  "a@gmail.com",
  "a@GMAIL.COM",
  "a@yahoo.com",
  "a@icloud.com",
  "a@barbershop.com",
  "a@school.edu",
  "a@mail.com",
  "a@gmx.com",
  "a@ymail.com",
  "a@mac.com",
  "a@pm.me",
  "a@proton.me",
  "a@yahoo.co.uk",
  "a@hotmail.co.uk",
  "a@googlemail.com",
  "a@mycompany.net",
  "",
  "not-an-email",
  "a@",
  "@gmail.com",
]
for (const typed of leftAlone) {
  assert.equal(suggestEmailFix(typed), null, typed)
}

console.log("email-typo: ok")
