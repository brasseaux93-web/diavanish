/*
 * Proposal-ready brief, typeset from the sealed v2 document and nothing else.
 *
 * One standalone HTML file: inline CSS, fonts embedded as data URIs, a print
 * stylesheet for A4 or Letter, and a single inline "Save as PDF" button that
 * calls window.print(). It never fetches anything. Every string is escaped,
 * and evidence links are rendered as plain text links (no previews).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  LedgerDocV2, SupportView, ProblemPayload, PositionPayload, EvidencePayload, OptionPayload,
  AgreementPayload, ConditionPayload, QuestionPayload,
} from "@shared/ledger";
import { safeUrl, isCountsView, supportFlags } from "@shared/ledger";
import { ledgerT, type LedgerLang, type LedgerKey } from "@shared/ledger-i18n";

const FONT_FILES = {
  serif: "@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2",
  serifItalic: "@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2",
  sans: "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
  mono: "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
  arabic: "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2",
  arabicBold: "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-600-normal.woff2",
} as const;

const fontCache = new Map<string, string | null>();
function fontData(file: string): string | null {
  if (fontCache.has(file)) return fontCache.get(file)!;
  let out: string | null = null;
  try {
    out = readFileSync(path.join(process.cwd(), "node_modules", file)).toString("base64");
  } catch {
    out = null; // falls back to the system stack; the brief still renders
  }
  fontCache.set(file, out);
  return out;
}

function fontFaces(lang: LedgerLang): string {
  const face = (family: string, file: string, style = "normal", weight = "400", range = "") => {
    const data = fontData(file);
    return data
      ? `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${data}) format("woff2");font-style:${style};font-weight:${weight};font-display:swap;${range}}`
      : "";
  };
  return [
    face("Instrument Serif", FONT_FILES.serif),
    face("Instrument Serif", FONT_FILES.serifItalic, "italic"),
    face("Geist", FONT_FILES.sans, "normal", "100 900"),
    face("Geist Mono", FONT_FILES.mono, "normal", "100 900"),
    lang === "ar" ? face("IBM Plex Sans Arabic", FONT_FILES.arabic) : "",
    lang === "ar" ? face("IBM Plex Sans Arabic", FONT_FILES.arabicBold, "normal", "600") : "",
  ].join("");
}

const esc = (v: unknown) => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const para = (v: string) => esc(v).replace(/\n/g, "<br>");

function fmtDate(iso: string, lang: LedgerLang, withTime = false) {
  const d = new Date(iso);
  const locale = { en: "en-GB", fr: "fr-FR", es: "es-ES", ar: "ar" }[lang];
  const opts: Intl.DateTimeFormatOptions = withTime
    ? { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }
    : { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" };
  try { return new Intl.DateTimeFormat(locale, opts).format(d); } catch { return iso; }
}

function groupHex(hex: string) {
  return (hex.match(/.{1,8}/g) ?? []).join(" ");
}

export type BriefSeal = { fingerprint: string; chainHead: string | null; destructionCert: string | null; lang?: LedgerLang };

export function renderBrief(doc: LedgerDocV2, seal: BriefSeal): string {
  const lang: LedgerLang = seal.lang ?? "en";
  const T = (k: LedgerKey, v?: Record<string, string | number>) => esc(ledgerT(lang, k, v));
  const dir = lang === "ar" ? "rtl" : "ltr";
  const of = <P,>(kind: string) => doc.items.filter((i) => i.kind === kind && i.payload)
    .map((i) => ({ ...i, p: i.payload as unknown as P }));

  const problems = of<ProblemPayload>("problem");
  const positions = of<PositionPayload>("position");
  const evidence = of<EvidencePayload>("evidence");
  const options = of<OptionPayload>("option");
  const agreements = of<AgreementPayload>("agreement");
  const conditions = of<ConditionPayload>("condition");
  const questions = of<QuestionPayload>("question");
  const legacy = doc.items.filter((i) => !i.payload);

  const agendaTag = (a: string | null) => a ? `<span class="agenda">${esc(a)}</span>` : "";
  // Rooms sealed with fewer than seven seats carry levels only, and the brief never shows numbers for them.
  const supportTag = (s: SupportView | null) => {
    if (!s) return "";
    let label: string;
    if (isCountsView(s)) {
      label = s.level === "full" ? ledgerT(lang, "sup_full")
        : s.level === "reservations" ? `${ledgerT(lang, "sup_reservations")} · ${s.reservations}`
        : `${ledgerT(lang, "sup_objection")} · ${s.objection}`;
    } else {
      label = s.level === "full" ? ledgerT(lang, "lv_full")
        : s.level === "reservations" ? ledgerT(lang, "lv_reservations")
        : ledgerT(lang, s.withReservations ? "lv_objection_res" : "lv_objection");
    }
    return `<span class="support support-${s.level}">${esc(label)}</span>`;
  };
  const meta = (i: { agenda: string | null; support: SupportView | null }) =>
    (i.agenda || i.support) ? `<div class="meta">${agendaTag(i.agenda)}${supportTag(i.support)}</div>` : "";
  const none = `<p class="none">${T("br_none")}</p>`;
  let n = 0;
  const section = (key: LedgerKey, body: string, show = true) => {
    if (!show) return "";
    n += 1;
    return `<section><header class="sec"><span class="num">${String(n).padStart(2, "0")}</span><h2>${T(key)}</h2></header>${body}</section>`;
  };

  const problemHtml = problems.length ? problems.map((i) => `
    <article class="item lead-item">
      ${meta(i)}
      <p class="statement">${para(i.p.statement)}</p>
      <dl class="facts">
        <div><dt>${T("br_scale")}</dt><dd>${T(`scale_${i.p.scale}` as LedgerKey)}</dd></div>
        ${i.p.affected.length ? `<div><dt>${T("br_affected")}</dt><dd>${i.p.affected.map(esc).join(" · ")}</dd></div>` : ""}
      </dl>
    </article>`).join("") : none;

  const positionHtml = positions.map((i) => `
    <article class="item">
      ${meta(i)}
      <h3>${esc(i.p.party)}</h3>
      <p>${para(i.p.wants)}</p>
      ${i.p.why ? `<p class="why"><span>${T("f_why")}</span> ${para(i.p.why)}</p>` : ""}
    </article>`).join("");

  const evidenceHtml = evidence.length ? `<ol class="evidence">${evidence.map((i) => {
    const href = i.p.url ? safeUrl(i.p.url) : null;
    return `<li>${meta(i)}<p>${para(i.p.summary)}</p>
      ${(i.p.source || href) ? `<p class="source">${i.p.source ? esc(i.p.source) : ""}${i.p.source && href ? " · " : ""}${href ? `<a href="${esc(href)}" rel="noopener noreferrer nofollow">${esc(href)}</a>` : ""}</p>` : ""}
    </li>`;
  }).join("")}</ol>` : none;

  const optionHtml = options.length ? options.map((i) => `
    <article class="item option option-${i.p.status}">
      ${meta(i)}
      <h3><span class="mark">${i.p.status === "chosen" ? T("f_chosen") : T("f_dropped")}</span>${esc(i.p.title)}</h3>
      ${i.p.rationale ? `<p>${para(i.p.rationale)}</p>` : ""}
      ${i.p.reason ? `<p class="why"><span>${T("f_reason")}</span> ${para(i.p.reason)}</p>` : ""}
    </article>`).join("") : none;

  const chosen = options.filter((o) => o.p.status === "chosen");
  const recHtml = (chosen.length || agreements.length) ? `
    ${chosen.length ? `<div class="recommend"><p class="kicker">${T("br_recommended")}</p>${chosen.map((o) => `<p class="statement">${esc(o.p.title)}</p>`).join("")}</div>` : ""}
    ${agreements.map((i) => `<article class="item">${meta(i)}<p class="action">${para(i.p.action)}</p></article>`).join("")}
  ` : none;

  const timeline = agreements.slice().sort((a, b) => (a.p.deadline ?? "9999") < (b.p.deadline ?? "9999") ? -1 : 1);
  const timelineHtml = (timeline.length || doc.followups.length) ? `
    ${timeline.length ? `<table class="timeline"><thead><tr><th>${T("f_action")}</th><th>${T("f_owner")}</th><th>${T("f_deadline")}</th></tr></thead><tbody>
      ${timeline.map((i) => `<tr><td>${esc(i.p.action)}</td><td>${esc(i.p.owner)}</td><td class="date">${i.p.deadline ? esc(fmtDate(i.p.deadline, lang)) : `<span class="muted">${T("br_no_deadline")}</span>`}</td></tr>`).join("")}
    </tbody></table>` : ""}
    ${doc.followups.length ? `<p class="kicker sub">${T("br_followups")}</p><table class="timeline"><tbody>
      ${doc.followups.map((f) => `<tr><td>${esc(f.text)}</td><td>${esc(f.owner)}</td><td class="date">${f.dueDate ? esc(fmtDate(f.dueDate, lang)) : ""} <span class="status status-${esc(f.status)}">${T(`fu_${f.status}` as LedgerKey)}</span></td></tr>`).join("")}
    </tbody></table>` : ""}
  ` : none;

  const measured = agreements.filter((a) => a.p.measure || a.p.resources);
  const measureHtml = measured.length ? `<ul class="measures">${measured.map((i) => `
    <li><p class="action-sm">${esc(i.p.action)}</p>
      ${i.p.measure ? `<p>${para(i.p.measure)}</p>` : ""}
      ${i.p.resources ? `<p class="why"><span>${T("br_resources")}</span> ${esc(i.p.resources)}</p>` : ""}</li>`).join("")}</ul>` : none;

  const objections = doc.items.filter((i) => i.kind !== "condition" && i.support && (supportFlags(i.support).objection || supportFlags(i.support).reservations));
  const dissentHtml = (conditions.length || objections.length || doc.summary?.disagreements) ? `
    ${conditions.map((i) => `<article class="item">${meta(i)}${i.p.form === "unresolved"
      ? `<p><span class="mark">${T("br_unresolved")}</span>${para(i.p.point)}</p>`
      : `<p><span class="cond">${T("f_accept")}</span> ${para(i.p.accept)} <span class="cond">${T("f_provided")}</span> ${para(i.p.provided)}</p>`}</article>`).join("")}
    ${objections.map((i) => `<article class="item dissent">
      <div class="meta">${agendaTag(i.agenda)}${supportTag(i.support)}</div>
      <p class="muted-line">${esc(i.text)}</p>
      ${i.support!.objections.map((o) => `<p class="objection"><span>${T("br_objection")}</span> ${o.reason ? para(o.reason) : ""}${o.by ? ` <em>— ${esc(o.by)}</em>` : ""}</p>`).join("")}
    </article>`).join("")}
    ${doc.summary?.disagreements ? `<article class="item"><p>${para(doc.summary.disagreements)}</p></article>` : ""}
  ` : none;

  const questionHtml = (questions.length || doc.summary?.openIssues) ? `<ol class="questions">
    ${questions.map((i) => `<li>${meta(i)}<p class="q">${para(i.p.question)}</p>${i.p.research ? `<p class="why"><span>${T("br_research")}</span> ${para(i.p.research)}</p>` : ""}</li>`).join("")}
    ${doc.summary?.openIssues ? `<li><p class="q">${para(doc.summary.openIssues)}</p></li>` : ""}
  </ol>` : none;

  const summaryHtml = doc.summary?.agreements ? `<div class="outcome"><p class="kicker">${T("br_summary")}</p><p>${para(doc.summary.agreements)}</p></div>` : "";
  const legacyHtml = legacy.length ? `<ul class="legacy">${legacy.map((i) => `<li>${meta(i)}<p>${para(i.text)}</p></li>`).join("")}</ul>` : "";

  const title = esc(doc.room.title);
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${T("br_kicker")} · ${title}</title>
<style>
${fontFaces(lang)}
:root{
  --paper:#F4F1EA; --ink:#1B1D22; --muted:#5C6068; --faint:#8A8E96; --rule:rgba(27,29,34,.12);
  --sage:#4F6B55; --clay:#9A5A42; --ochre:#8A6A1E; --metal:#8F949C; --metal-2:#C5C8CD;
  --serif:"Instrument Serif",Georgia,"Times New Roman",serif;
  --sans:${lang === "ar" ? `"IBM Plex Sans Arabic",` : ""}"Geist",system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:"Geist Mono",ui-monospace,"SFMono-Regular",Menlo,monospace;
}
*{box-sizing:border-box}
html{background:#0B0C10;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;padding:56px 24px 96px;font-family:var(--sans);color:var(--ink);font-size:14.5px;line-height:1.62;font-feature-settings:"ss01"}
.bar{max-width:794px;margin:0 auto 18px;display:flex;align-items:center;gap:12px;color:#9BA0A8;font-size:12.5px}
.bar button{margin-inline-start:auto;font:inherit;font-weight:500;color:#E9E6DF;background:#1E222C;border:1px solid rgba(255,255,255,.11);border-radius:999px;padding:8px 16px;cursor:pointer}
.bar button:hover{background:#262B36}
.bar button:focus-visible{outline:2px solid #AABEAC;outline-offset:2px}
.sheet{max-width:794px;margin:0 auto;background:var(--paper);border-radius:4px;padding:72px 76px 64px}
.kicker{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
${lang === "ar" ? ".kicker{font-family:var(--sans);letter-spacing:0;font-size:12px}" : ""}
h1{font-family:var(--serif);font-weight:400;font-size:46px;line-height:1.06;letter-spacing:-.01em;margin:0 0 18px;text-wrap:balance}
.lede{font-family:var(--serif);font-style:italic;font-size:19px;line-height:1.45;color:var(--muted);margin:0 0 28px;max-width:34em}
.masthead-meta{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12px;color:var(--muted);padding-top:16px;border-top:1px solid var(--rule)}
.masthead-meta b{font-weight:500;color:var(--ink)}
.code{font-family:var(--mono);letter-spacing:.04em}
.outcome{margin:40px 0 4px;padding:22px 26px;border-inline-start:2px solid var(--sage);background:rgba(79,107,85,.05)}
.outcome p:last-child{font-family:var(--serif);font-size:20px;line-height:1.4;margin:0}
section{margin-top:52px}
header.sec{display:flex;align-items:baseline;gap:14px;margin:0 0 18px;padding-bottom:10px;border-bottom:1px solid var(--rule);break-after:avoid}
.num{font-family:var(--mono);font-size:11px;color:var(--faint);letter-spacing:.06em}
h2{font-family:var(--serif);font-weight:400;font-size:27px;line-height:1.15;margin:0}
h3{font-size:15px;font-weight:600;margin:0 0 4px;letter-spacing:-.005em}
.item{padding:14px 0;break-inside:avoid}
.item + .item{border-top:1px solid var(--rule)}
.item p{margin:0 0 6px}
.statement{font-family:var(--serif);font-size:21px;line-height:1.35;margin:0 0 12px !important;text-wrap:pretty}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-bottom:6px}
.agenda{font-size:11.5px;color:var(--faint)}
.support{font-size:11px;font-weight:500;padding:2px 9px;border-radius:999px;border:1px solid currentColor;line-height:1.5}
.support-full{color:var(--sage)} .support-reservations{color:var(--ochre)} .support-objection{color:var(--clay)}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px 24px;margin:0}
.facts dt{font-size:11px;color:var(--faint);margin-bottom:2px} .facts dd{margin:0;font-size:13.5px}
.why{color:var(--muted)} .why span,.objection span{font-size:11px;font-weight:600;color:var(--faint);margin-inline-end:6px;text-transform:uppercase;letter-spacing:.06em}
${lang === "ar" ? ".why span,.objection span{text-transform:none;letter-spacing:0}" : ""}
ol,ul{margin:0;padding:0;list-style:none}
.evidence li,.questions li,.measures li,.legacy li{padding:12px 0;break-inside:avoid}
.evidence li + li,.questions li + li,.measures li + li,.legacy li + li{border-top:1px solid var(--rule)}
.evidence p,.questions p,.measures p,.legacy p{margin:0 0 4px}
.source{font-size:12.5px;color:var(--muted);word-break:break-word}
.source a{color:var(--ink);text-decoration:underline;text-decoration-color:var(--rule);text-underline-offset:2px}
.option h3{display:flex;align-items:baseline;gap:10px}
.mark{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;font-weight:500;padding:1px 7px;border:1px solid var(--rule);border-radius:3px;color:var(--muted);margin-inline-end:8px}
.option-chosen .mark{color:var(--sage);border-color:rgba(79,107,85,.45)}
.option-dropped h3{color:var(--muted)}
.recommend{padding:0 0 8px}
.recommend .statement{font-size:24px}
.action{font-size:15px}
.action-sm{font-weight:600;font-size:13.5px}
table.timeline{width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:8px}
.timeline th{font-size:11px;font-weight:500;color:var(--faint);text-align:start;padding:0 12px 8px 0;border-bottom:1px solid var(--rule)}
.timeline td{padding:10px 12px 10px 0;border-bottom:1px solid var(--rule);vertical-align:top}
.timeline td:first-child{width:56%}
.timeline .date{white-space:nowrap;font-variant-numeric:tabular-nums}
.kicker.sub{margin-top:26px}
.status{font-size:11px;color:var(--muted);margin-inline-start:6px}
.status-kept{color:var(--sage)} .status-lapsed{color:var(--clay)}
.cond{font-family:var(--serif);font-style:italic;font-size:16px;color:var(--muted)}
.dissent .muted-line{color:var(--muted);font-size:13px}
.objection{border-inline-start:2px solid rgba(154,90,66,.5);padding-inline-start:12px;margin-top:6px !important}
.q{font-family:var(--serif);font-size:18.5px;line-height:1.4}
.none,.muted{color:var(--faint)}
.seal{margin-top:60px;padding:28px 30px;border:1px solid var(--metal);outline:1px solid var(--metal-2);outline-offset:3px;border-radius:6px;break-inside:avoid;
  background:repeating-linear-gradient(90deg,rgba(27,29,34,.018) 0 1px,transparent 1px 3px)}
.seal h2{font-size:24px;margin-bottom:16px}
.seal .fp{font-family:var(--mono);font-size:13px;letter-spacing:.04em;word-spacing:.35em;line-height:1.7;margin:4px 0 18px;direction:ltr;text-align:start}
.seal dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px 28px;margin:0 0 18px}
.seal dt{font-size:11px;color:var(--faint);margin-bottom:2px}
.seal dd{margin:0;font-size:13px}
.seal .hash{font-family:var(--mono);font-size:10.5px;color:var(--muted);word-break:break-all;direction:ltr}
.seal .how{font-size:13px;color:var(--muted);margin:0;padding-top:14px;border-top:1px solid var(--rule)}
footer.foot{margin-top:44px;font-family:var(--serif);font-style:italic;font-size:15px;color:var(--faint);text-align:center}
@media (max-width:720px){body{padding:20px 0 48px}.bar{padding:0 16px}.sheet{padding:40px 24px;border-radius:0}h1{font-size:34px}.timeline td:first-child{width:auto}}
/* Content keeps its own direction inside an RTL brief (English text in an Arabic brief, and back). */
.sheet p,.sheet h1,.sheet td,.sheet li{unicode-bidi:plaintext}
@page{margin:18mm 16mm}
@media print{
  html,body{background:#fff}
  body{padding:0;font-size:10.5pt}
  .bar{display:none}
  .sheet{max-width:none;padding:0;background:#fff;border-radius:0}
  h1{font-size:30pt} section{margin-top:28pt} .seal{margin-top:32pt}
  a{color:var(--ink)}
}
</style>
</head>
<body>
<div class="bar"><span>${T("brief_note")}</span><button type="button" onclick="window.print()">${T("brief_pdf")}</button></div>
<script>if(location.hash==="#print")addEventListener("load",function(){setTimeout(function(){window.print()},250)})</script>
<main class="sheet">
  <p class="kicker">${T("br_kicker")}</p>
  <h1>${title}</h1>
  <p class="lede">${T("br_lede")}</p>
  <div class="masthead-meta">
    <span>${T("br_room")} <b class="code">${esc(doc.room.code)}</b></span>
    <span>${T("br_sealed")} <b>${esc(fmtDate(doc.sealedAt, lang))}</b></span>
    <span>${T("led_version", { n: 2 })}</span>
    ${doc.room.continuesFrom ? `<span>${T("br_continues", { code: "\u0000" }).replace("\u0000", `<b class="code">${esc(doc.room.continuesFrom)}</b>`)}</span>` : ""}
  </div>
  ${summaryHtml}
  ${section("br_problem", problemHtml)}
  ${section("br_positions", positionHtml, positions.length > 0)}
  ${section("br_evidence", evidenceHtml)}
  ${section("br_options", optionHtml)}
  ${section("br_recommendation", recHtml)}
  ${section("br_timeline", timelineHtml)}
  ${section("br_measures", measureHtml)}
  ${section("br_dissent", dissentHtml)}
  ${section("br_questions", questionHtml)}
  ${legacy.length ? section("led_record", legacyHtml) : ""}
  <section class="seal" aria-label="${T("br_seal")}">
    <h2>${T("br_seal")}</h2>
    <p class="kicker">${T("br_fingerprint")}</p>
    <p class="fp">${esc(groupHex(seal.fingerprint))}</p>
    <dl>
      <div><dt>${T("br_sealed")}</dt><dd>${esc(fmtDate(doc.sealedAt, lang, true))}</dd></div>
      <div><dt>${T("br_room")}</dt><dd class="code">${esc(doc.room.code)} · ${T("led_version", { n: 2 })}</dd></div>
      ${seal.chainHead ? `<div><dt>${T("br_chain")}</dt><dd class="hash">${esc(seal.chainHead)}</dd></div>` : ""}
      ${seal.destructionCert ? `<div><dt>${T("br_cert")}</dt><dd class="hash">${esc(seal.destructionCert)}</dd></div>` : ""}
    </dl>
    <p class="how"><b>${T("br_verify")}.</b> ${T("br_verify_steps", { code: doc.room.code })}</p>
  </section>
  <footer class="foot">${T("br_footer")}</footer>
</main>
</body>
</html>`;
}
