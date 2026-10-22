// Unit tests for safeUrl(), pulled straight out of the real content.js
const fs = require("fs");
const src = fs.readFileSync("/home/claude/site/assets/content.js", "utf8");

const escSrc = src.slice(src.indexOf("function esc"));
const escFn = escSrc.slice(0, escSrc.indexOf("\n}\n") + 3);
const safeSrc = src.slice(src.indexOf("function safeUrl"));
const safeFn = safeSrc.slice(0, safeSrc.indexOf("\n}\n") + 3);

const mod = new Function(escFn + safeFn + "\nreturn { esc, safeUrl };")();
const { safeUrl } = mod;

const cases = [
  ["https://youtube.com/watch?v=abc", "allow"],
  ["http://example.com", "allow"],
  ["data:image/jpeg;base64,/9j/4AAQ", "allow"],
  ["data:image/png;base64,iVBORw0KGgo=", "allow"],
  ["index.html", "allow"],
  ["javascript:alert(1)", "BLOCK"],
  ["JaVaScRiPt:alert(1)", "BLOCK"],
  ["java\nscript:alert(1)", "BLOCK"],
  ["  javascript:alert(1)", "BLOCK"],
  ["\tjavascript:alert(1)", "BLOCK"],
  ["vbscript:msgbox(1)", "BLOCK"],
  ["data:text/html,<script>alert(1)</script>", "BLOCK"],
  ["data:image/svg+xml;base64,PHN2Zz4=", "BLOCK"],
  ["javascript:alert(1)//facebook.com", "BLOCK"],
  ["file:///etc/passwd", "BLOCK"],
  ['" onmouseover="alert(1)', "no-quote-breakout"],
  ["https://x.com/\" onload=\"alert(1)", "no-quote-breakout"],
];

let bad = 0;
for (const [input, want] of cases) {
  const out = safeUrl(input);
  const blocked = out === "";
  let ok;
  if (want === "BLOCK") ok = blocked;
  else if (want === "allow") ok = !blocked;
  else ok = !out.includes('"');
  if (!ok) bad++;
  console.log(
    (ok ? "  PASS  " : "  FAIL  ") + want.padEnd(18) +
    JSON.stringify(input).slice(0, 44) + "  ->  " + JSON.stringify(out).slice(0, 40)
  );
}
console.log(bad ? "\n" + bad + " FAILURES" : "\nAll " + cases.length + " safeUrl cases pass");
process.exit(bad ? 1 : 0);
