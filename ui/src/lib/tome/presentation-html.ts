import type { PresentationDeck, PresentationVisual, PresentationVisualGroup } from "@/lib/tome/presentation";
import { presentationSourceRefs, presentationSourceUrl } from "@/lib/tome/presentation";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "presentation";
}

function quotedLabels(value: string): string[] {
  const labels = [...value.matchAll(/[\u0022\u0027\u2018\u201c]([^\u0022\u0027\u2019\u201d]{2,100})[\u0022\u0027\u2019\u201d]/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  return [...new Set(labels)];
}

/** Convert visual descriptions produced by older models into bounded diagram nodes. */
function legacyVisualGroups(visual: PresentationVisual): PresentationVisualGroup[] {
  const groups: PresentationVisualGroup[] = [];
  const lanePattern = /(?:lane|layer)\s+\d+\s+[\u0027\u2018\u201c]([^\u0027\u2019\u201d]+)[\u0027\u2019\u201d]\s*:\s*([\s\S]*?)(?=(?:lane|layer)\s+\d+\s+[\u0027\u2018\u201c]|connecting arrows?\s*:|$)/gi;
  for (const match of visual.description.matchAll(lanePattern)) {
    groups.push({ label: match[1].trim(), items: quotedLabels(match[2]).slice(0, 8) });
  }
  if (groups.length > 0) return groups.slice(0, 8);

  const labels = quotedLabels(visual.description).slice(0, 16);
  if (labels.length > 0) {
    const groupSize = visual.layout === "grid" ? 2 : Math.min(4, labels.length);
    for (let index = 0; index < labels.length; index += groupSize) {
      groups.push({
        label: visual.layout === "timeline" ? `Stage ${groups.length + 1}` : "",
        items: labels.slice(index, index + groupSize),
      });
    }
  }
  return groups.slice(0, 8);
}

function legacyConnections(visual: PresentationVisual): string[] {
  const connectionText = visual.description.match(/connecting arrows?\s*:\s*([\s\S]+)$/i)?.[1];
  return connectionText
    ? connectionText.split(";").map((item) => item.trim()).filter(Boolean).slice(0, 4)
    : [];
}

function renderVisual(visual: PresentationVisual): string {
  const groups = visual.groups.length > 0 ? visual.groups : legacyVisualGroups(visual);
  const connections = visual.connections.length > 0 ? visual.connections : legacyConnections(visual);
  const legacyLayout = /(?:layered|swim\s*lanes?|lane\s+\d+)/i.test(visual.description)
    ? "layers"
    : /(?:quadrant|2\s*[x×]\s*2)/i.test(visual.description)
      ? "grid"
      : /timeline/i.test(visual.description)
        ? "timeline"
        : visual.layout;
  const layout = visual.groups.length > 0 ? visual.layout : legacyLayout;
  const groupMarkup = groups.map((group) => {
    const visibleItems = group.items.slice(0, 6);
    const items = visibleItems.map((item) => `<span class="visual-node">${escapeHtml(item)}</span>`).join("");
    const remaining = group.items.length - visibleItems.length;
    return `<section class="visual-group">${group.label ? `<b>${escapeHtml(group.label)}</b>` : ""}<div class="visual-items">${items}${remaining > 0 ? `<span class="visual-node visual-more">+${remaining} more</span>` : ""}</div></section>`;
  }).join("");
  const connectionMarkup = connections.length > 0
    ? `<div class="visual-connections">${connections.slice(0, 4).map((connection) => `<span>${escapeHtml(connection)}</span>`).join("")}</div>`
    : "";
  const fallback = `<p class="visual-summary">${escapeHtml(visual.description.slice(0, 220))}${visual.description.length > 220 ? "…" : ""}</p>`;
  return `<figure class="visual ${visual.kind}" aria-label="${escapeHtml(visual.description)}">
    <div class="visual-heading"><strong>${visual.kind === "diagram" ? "Diagram" : "Graphic"}</strong>${visual.title ? `<span>${escapeHtml(visual.title)}</span>` : ""}</div>
    ${groupMarkup ? `<div class="visual-canvas ${layout}">${groupMarkup}</div>${connectionMarkup}` : fallback}
  </figure>`;
}

export function presentationHtmlFilename(slug: string, title: string): string {
  return `${safeFilename(slug)}-${safeFilename(title)}.html`;
}

/** Render a self-contained, keyboard-navigable HTML slide deck. */
export function renderPresentationHtml(input: {
  deck: PresentationDeck;
  projectName: string;
  sourceBaseUrl: string;
}): string {
  const { deck, projectName, sourceBaseUrl } = input;
  const slides = deck.slides.map((slide, index) => {
    const refs = presentationSourceRefs(slide);
    const bullets = slide.bullets.map((bullet) => {
      const marker = bullet.source_refs.length > 0
        ? `[${bullet.source_refs.map((ref) => refs.indexOf(ref) + 1).join(",")}]`
        : "AI";
      return `<li class="${bullet.generated ? "generated" : "grounded"}"><span data-editable="true">${escapeHtml(bullet.text)}</span><small>${escapeHtml(marker)}</small></li>`;
    }).join("");
    const visual = slide.visual?.description
      ? renderVisual(slide.visual)
      : "";
    const sources = refs.length > 0
      ? refs.map((ref, refIndex) => {
        const url = presentationSourceUrl(sourceBaseUrl, ref);
        return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">[${refIndex + 1}] ${escapeHtml(url)}</a>`;
      }).join("")
      : "<span class=\"generated-label\">Generated content — no direct wiki source</span>";
    const notes = slide.speaker_notes
      ? `<details class="notes"><summary>Speaker notes</summary><p>${escapeHtml(slide.speaker_notes)}</p></details>`
      : "";
    return `<section class="slide${index === 0 ? " active cover" : ""}" id="slide-${index + 1}" aria-label="Slide ${index + 1} of ${deck.slides.length}">
      <aside class="rail" aria-hidden="true"><span class="rail-number">${String(index + 1).padStart(2, "0")}</span><span class="rail-tick"></span><span class="rail-mark">TOME</span></aside>
      <div class="slide-main"><header><p class="eyebrow">${escapeHtml(projectName)}</p><h2 data-editable="true">${escapeHtml(slide.title)}</h2>${slide.subtitle ? `<p class="subtitle" data-editable="true">${escapeHtml(slide.subtitle)}</p>` : ""}</header>
      <div class="content ${visual ? "with-visual" : ""}"><ul>${bullets}</ul>${visual}</div>
      ${notes}
      <footer><div class="sources">${sources}</div><span>${index + 1} / ${deck.slides.length}</span></footer></div>
    </section>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="TOME presentation export">
  <title>${escapeHtml(deck.title)}</title>
  <style>
    :root { color-scheme: dark; --bg:#071726; --surface:#0d2033; --panel:#12314e; --panel-2:#0f2841; --ink:#e9f1f7; --muted:#9cb5ca; --cyan:#3cb8ea; --amber:#f0a93b; --coral:#ee7f72; --line:rgba(139,188,222,.28); --serif:"Newsreader",Georgia,"Times New Roman",serif; --sans:"IBM Plex Sans",Inter,ui-sans-serif,system-ui,sans-serif; --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace; }
    * { box-sizing:border-box; }
    html { scroll-snap-type:y mandatory; scroll-behavior:smooth; background:var(--bg); }
    body { margin:0; font-family:var(--sans); background:var(--bg); }
    .slide { position:relative; width:min(94vw,160vh); min-height:min(90vh,56.25vw); margin:5vh auto; padding:0; overflow:hidden; color:var(--ink); background:linear-gradient(160deg,var(--surface),#0a1b2c 70%); border:1px solid var(--line); border-radius:3px; box-shadow:0 30px 80px #0009; scroll-snap-align:center; display:grid; grid-template-columns:82px 1fr; }
    .slide::before { content:""; position:absolute; inset:0 0 auto; height:4px; background:linear-gradient(90deg,var(--cyan),var(--amber),var(--coral)); }
    .rail { display:flex; flex-direction:column; align-items:center; gap:14px; padding:clamp(28px,4vw,52px) 0 30px; border-right:1px solid var(--line); background:#ffffff03; }
    .rail-number { color:var(--cyan); font-family:Georgia,"Times New Roman",serif; font-size:clamp(22px,2.4vw,36px); line-height:1; }
    .rail-tick { flex:1; width:1px; background:linear-gradient(to bottom,var(--line),transparent); }
    .rail-mark { color:var(--muted); font-size:10px; letter-spacing:.16em; writing-mode:vertical-rl; }
    .slide-main { min-width:0; min-height:0; display:flex; flex-direction:column; padding:clamp(28px,4vw,64px); }
    header { margin-bottom:clamp(22px,3vh,42px); }
    .eyebrow { margin:0 0 10px; color:var(--cyan); font-size:clamp(11px,1vw,15px); font-weight:600; letter-spacing:.12em; text-transform:uppercase; }
    h2 { margin:0; color:var(--ink); font-family:var(--serif); font-size:clamp(30px,4.1vw,68px); font-weight:400; line-height:1.04; letter-spacing:-.035em; }
    .subtitle { margin:12px 0 0; color:var(--muted); font-size:clamp(16px,1.65vw,28px); }
    .content { display:grid; flex:1; align-items:center; }
    .content.with-visual { grid-template-columns:minmax(0,1.2fr) minmax(320px,1fr); gap:clamp(24px,3vw,48px); }
    ul { margin:0; padding:0; list-style:none; display:grid; gap:clamp(11px,1.5vh,22px); }
    li { position:relative; display:grid; grid-template-columns:14px minmax(0,1fr) auto; gap:14px; align-items:start; padding-left:14px; font-size:clamp(17px,1.65vw,28px); line-height:1.28; }
    li::before { content:""; width:8px; height:1px; margin-top:.66em; background:var(--cyan); }
    li.generated::before { background:var(--amber); }
    li small { margin-top:.35em; color:var(--muted); font:700 clamp(10px,.85vw,13px)/1 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .content.with-visual > ul li { font-size:clamp(15px,1.25vw,23px); }
    .visual { min-width:0; max-height:min(54vh,500px); margin:0; padding:clamp(14px,1.5vw,24px); overflow:hidden; border:1px solid rgba(60,184,234,.42); border-radius:3px; background:var(--panel); display:flex; flex-direction:column; gap:12px; }
    .visual-heading { display:flex; align-items:baseline; justify-content:space-between; gap:12px; }
    .visual strong { flex:none; color:var(--cyan); font-size:11px; letter-spacing:.12em; text-transform:uppercase; }
    .visual-heading span { overflow:hidden; color:var(--muted); font-size:12px; font-weight:700; text-overflow:ellipsis; white-space:nowrap; }
    .visual.graphic { border-color:rgba(240,169,59,.5); background:#3a2c2a; }
    .visual.graphic strong { color:var(--amber); }
    .visual-canvas { min-height:0; display:grid; gap:9px; align-content:center; }
    .visual-canvas.flow,.visual-canvas.timeline { grid-template-columns:repeat(auto-fit,minmax(96px,1fr)); align-items:stretch; }
    .visual-canvas.grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .visual-canvas.layers { grid-template-columns:1fr; }
    .visual-group { position:relative; min-width:0; padding:8px; border:1px solid rgba(60,184,234,.34); border-radius:3px; background:var(--panel-2); }
    .graphic .visual-group { border-color:rgba(240,169,59,.38); }
    .visual-group > b { display:block; margin-bottom:5px; overflow:hidden; color:var(--cyan); font-size:10px; letter-spacing:.04em; text-overflow:ellipsis; text-transform:uppercase; white-space:nowrap; }
    .visual-items { display:grid; grid-template-columns:repeat(auto-fit,minmax(76px,1fr)); gap:5px; }
    .visual-node { min-width:0; padding:6px 7px; overflow:hidden; border:1px solid rgba(139,188,222,.28); border-radius:2px; background:#ffffff0b; color:var(--ink); font-size:clamp(9px,.7vw,11px); font-weight:650; line-height:1.2; text-align:center; overflow-wrap:anywhere; }
    .visual-more { color:var(--muted); font-style:italic; }
    .flow .visual-group:not(:last-child)::after,.timeline .visual-group:not(:last-child)::after { content:"→"; position:absolute; z-index:2; top:50%; right:-13px; width:16px; color:var(--cyan); font-weight:900; text-align:center; transform:translateY(-50%); }
    .layers .visual-group:not(:last-child)::after { content:"↓"; position:absolute; z-index:2; left:50%; bottom:-12px; height:14px; color:var(--cyan); font-weight:900; transform:translateX(-50%); }
    .visual-connections { display:flex; flex-wrap:wrap; gap:4px; overflow:hidden; }
    .visual-connections span { max-width:100%; padding:3px 6px; overflow:hidden; border:1px solid rgba(60,184,234,.22); color:var(--muted); font-size:9px; line-height:1.15; text-overflow:ellipsis; white-space:nowrap; }
    .visual-summary { display:-webkit-box; margin:0; overflow:hidden; font-size:clamp(12px,1vw,16px); line-height:1.4; -webkit-box-orient:vertical; -webkit-line-clamp:6; }
    .notes { margin-top:24px; color:var(--muted); font-size:14px; }
    .notes summary { cursor:pointer; font-weight:700; }
    .notes p { max-width:90ch; line-height:1.55; }
    footer { display:flex; justify-content:space-between; gap:24px; align-items:flex-end; margin-top:clamp(22px,3vh,42px); padding-top:14px; border-top:1px solid var(--line); color:var(--muted); font:500 clamp(9px,.75vw,12px)/1.35 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .sources { min-width:0; display:flex; flex-wrap:wrap; gap:4px 14px; }
    .sources a { max-width:100%; color:var(--cyan); overflow-wrap:anywhere; text-decoration-thickness:1px; text-underline-offset:2px; }
    .generated-label { color:var(--amber); }
    nav { position:fixed; z-index:10; right:20px; bottom:20px; display:flex; align-items:center; gap:8px; padding:8px; border:1px solid #ffffff24; border-radius:999px; background:#111827e8; color:#fff; box-shadow:0 12px 30px #0008; }
    nav button { width:38px; height:38px; border:0; border-radius:50%; color:#fff; background:#ffffff18; cursor:pointer; font-size:18px; }
    nav button:hover { background:#ffffff2b; }
    #position { min-width:52px; text-align:center; font-size:12px; }
    @media (max-width:800px) { .slide { width:94vw; min-height:90vh; grid-template-columns:54px 1fr; } .slide-main { padding:clamp(24px,5vw,40px); } .content.with-visual { grid-template-columns:1fr; } .visual { max-height:44vh; } }
    @media print { @page { size:13.333in 7.5in; margin:0; } html,body { background:#071726; scroll-snap-type:none; } .slide { width:13.333in; height:7.5in; min-height:0; margin:0; border-radius:0; box-shadow:none; break-after:page; page-break-after:always; } .notes,nav { display:none; } }
    .bar { position:sticky; z-index:20; top:0; display:flex; align-items:center; justify-content:space-between; gap:24px; min-height:64px; padding:12px clamp(16px,3vw,42px); border-bottom:1px solid var(--line); background:rgba(7,23,38,.94); backdrop-filter:blur(14px); }
    .brand { display:flex; align-items:baseline; gap:14px; min-width:0; color:var(--muted); font-size:12px; letter-spacing:.04em; }
    .brand b { color:var(--text); font-size:18px; letter-spacing:.18em; }
    .brand span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .bar-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:7px; }
    .btn { padding:7px 11px; border:1px solid var(--line); border-radius:4px; background:transparent; color:var(--text); cursor:pointer; font:600 11px ui-monospace,SFMono-Regular,Menlo,monospace; }
    .btn:hover { border-color:var(--cyan); color:var(--cyan); }
    .btn.primary { border-color:var(--cyan); background:var(--cyan); color:var(--ink); }
    #stage { width:min(94vw,160vh); min-height:min(76vh,56.25vw); margin:5vh auto 96px; }
    .slide { display:none; width:100%; min-height:min(76vh,56.25vw); margin:0; border-radius:3px; box-shadow:0 30px 80px #0009; }
    .slide.active { display:grid; }
    .slide.cover { background:linear-gradient(145deg,#0d2033,#071726 72%); }
    .slide.cover h2 { max-width:12ch; font-size:clamp(42px,6vw,88px); }
    .slide.cover .eyebrow::before { content:"TOME / "; color:var(--amber); }
    [data-editable][contenteditable="true"] { outline:1px dashed var(--cyan); outline-offset:5px; }
    .nav { position:fixed; z-index:30; right:clamp(14px,3vw,42px); bottom:20px; display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid var(--line); border-radius:999px; background:#0d2033ee; color:var(--text); box-shadow:0 12px 30px #0008; }
    .nav button { width:32px; height:32px; border:1px solid var(--line); border-radius:50%; color:var(--text); background:#ffffff0b; cursor:pointer; font-size:17px; }
    .nav button:hover,.nav button.active { border-color:var(--cyan); color:var(--cyan); }
    .dots { display:flex; gap:5px; max-width:180px; overflow:hidden; }
    .dots button { width:7px; height:7px; min-width:7px; padding:0; border:0; background:var(--muted); }
    .dots button.active { background:var(--cyan); }
    .notes-panel,.help-panel { position:fixed; z-index:25; right:24px; bottom:78px; display:none; width:min(390px,calc(100vw - 32px)); padding:16px; border:1px solid var(--line); border-radius:4px; background:var(--panel); color:var(--text); box-shadow:0 20px 55px #0009; }
    .notes-panel.open,.help-panel.open { display:block; }
    .notes-panel-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; color:var(--cyan); font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace; text-transform:uppercase; }
    .notes-panel-heading button { border:0; background:transparent; color:var(--muted); cursor:pointer; font-size:20px; }
    .notes-panel p,.help-panel p { margin:12px 0 0; color:var(--muted); font-size:13px; line-height:1.55; }
    .help-panel b { color:var(--cyan); font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace; text-transform:uppercase; }
    @media print { .bar,.nav,.notes-panel,.help-panel { display:none !important; } #stage { width:100%; min-height:0; margin:0; } .slide,.slide.active { display:grid; width:13.333in; height:7.5in; min-height:0; margin:0; border-radius:0; box-shadow:none; break-after:page; page-break-after:always; } }
  </style>
</head>
<body>
  <header class="bar">
    <div class="brand"><b>TOME</b><span>${escapeHtml(projectName)} · Review</span></div>
    <div class="bar-actions"><button class="btn" id="btn-edit" type="button">Edit</button><button class="btn primary" id="btn-save" type="button">Save changes to file</button><button class="btn" id="btn-notes" type="button">Notes</button><button class="btn" id="btn-print" type="button">Print / PDF</button><button class="btn" id="btn-full" type="button">Present</button><button class="btn" id="btn-help" type="button" aria-label="Help">?</button></div>
  </header>
  <main id="stage">${slides}</main>
  <nav class="nav" aria-label="Presentation controls"><div class="dots" id="dots">${deck.slides.map((_, index) => `<button type="button" aria-label="Go to slide ${index + 1}" data-slide="${index}"></button>`).join("")}</div><button id="previous" type="button" aria-label="Previous slide">&#8592;</button><span id="position">1 / ${deck.slides.length}</span><button id="next" type="button" aria-label="Next slide">&#8594;</button></nav>
  <aside class="notes-panel" id="notes-panel" aria-live="polite"><div class="notes-panel-heading"><b>Speaker notes</b><button id="close-notes" type="button" aria-label="Close notes">×</button></div><p id="notes-content"></p></aside>
  <aside class="help-panel" id="help-panel"><b>Review controls</b><p>Edit slide text, use the arrows or keyboard to navigate, and save a revised copy when you are done.</p><p>Use Present for a focused full-screen view, or Print / PDF for a paper/PDF copy.</p></aside>
  <script>
    (() => {
      const slides = [...document.querySelectorAll('.slide')];
      const position = document.getElementById('position');
      const dots = [...document.querySelectorAll('[data-slide]')];
      const notesPanel = document.getElementById('notes-panel');
      const notesContent = document.getElementById('notes-content');
      let current = 0;
      const show = (index) => { current = Math.max(0, Math.min(slides.length - 1, index)); slides.forEach((slide, slideIndex) => slide.classList.toggle('active', slideIndex === current)); dots.forEach((dot, dotIndex) => dot.classList.toggle('active', dotIndex === current)); position.textContent = (current + 1) + ' / ' + slides.length; notesContent.textContent = slides[current].querySelector('.notes p')?.textContent || 'No speaker notes for this slide.'; };
      document.getElementById('previous').addEventListener('click', () => show(current - 1));
      document.getElementById('next').addEventListener('click', () => show(current + 1));
      dots.forEach((dot) => dot.addEventListener('click', () => show(Number(dot.dataset.slide))));
      document.addEventListener('keydown', (event) => { if (['ArrowRight','ArrowDown','PageDown',' '].includes(event.key)) { event.preventDefault(); show(current + 1); } if (['ArrowLeft','ArrowUp','PageUp'].includes(event.key)) { event.preventDefault(); show(current - 1); } });
      document.getElementById('btn-edit').addEventListener('click', () => { document.body.classList.toggle('editing'); document.querySelectorAll('[data-editable]').forEach((node) => node.setAttribute('contenteditable', document.body.classList.contains('editing') ? 'true' : 'false')); });
      document.getElementById('btn-notes').addEventListener('click', () => notesPanel.classList.toggle('open'));
      document.getElementById('close-notes').addEventListener('click', () => notesPanel.classList.remove('open'));
      document.getElementById('btn-print').addEventListener('click', () => window.print());
      document.getElementById('btn-full').addEventListener('click', () => document.documentElement.requestFullscreen?.());
      document.getElementById('btn-help').addEventListener('click', () => document.getElementById('help-panel').classList.toggle('open'));
      document.getElementById('btn-save').addEventListener('click', () => { const blob = new Blob(['<!doctype html>\\n' + document.documentElement.outerHTML], { type: 'text/html' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = document.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.html'; link.click(); URL.revokeObjectURL(link.href); });
      const observer = new IntersectionObserver((entries) => { entries.forEach((entry) => { if (entry.isIntersecting) show(slides.indexOf(entry.target)); }); }, { threshold: .6 });
      slides.forEach((slide) => observer.observe(slide));
      show(0);
    })();
  </script>
</body>
</html>`;
}
