/**
 * Message-match drop-in snippet (WO-041). Inline <script> for the page
 * <head>: reads utm_content, fetches the mapped headline/lead variant from
 * the hosted middleware, and swaps elements tagged data-mm="headline" /
 * data-mm="lead" WITHOUT layout shift (visibility-hold, boxes keep their
 * size). No utm_content → zero-cost no-op; unmapped utm_content → clean
 * fallback to control after the hold budget. Logs a variant impression.
 * `window.__mmSwapAt` records the swap time for the <50ms acceptance check.
 */

export interface MmSnippetInputs {
  /** The page asset this snippet serves (the map key). */
  assetId: string;
  /** Absolute origin of the hosted middleware, e.g. https://app.copyforge.io */
  apiBase: string;
  /** Max ms to hold the swappable elements before falling back to control. */
  holdMs?: number;
}

export function renderMessageMatchSnippet(inputs: MmSnippetInputs): string {
  if (!/^https?:\/\/[^/]+$/.test(inputs.apiBase)) {
    throw new Error('apiBase must be an absolute origin like https://app.example.com (no trailing slash).');
  }
  if (!/^[0-9A-Za-z]{26}$/.test(inputs.assetId)) {
    throw new Error('assetId must be a 26-char id.');
  }
  const holdMs = inputs.holdMs ?? 150;
  return `<script>
(function(){
  "use strict";
  var utm = new URLSearchParams(location.search).get("utm_content");
  if (!utm) return; /* control traffic: zero cost, zero flicker */
  var API = ${JSON.stringify(inputs.apiBase)};
  var ASSET = ${JSON.stringify(inputs.assetId)};
  var hold = document.createElement("style");
  hold.id = "__mm_hold";
  hold.textContent = "[data-mm]{visibility:hidden}"; /* box keeps its size: no layout shift */
  (document.head || document.documentElement).appendChild(hold);
  var revealed = false;
  function reveal(){
    if (revealed) return;
    revealed = true;
    var s = document.getElementById("__mm_hold");
    if (s && s.parentNode) s.parentNode.removeChild(s);
  }
  var fallback = setTimeout(reveal, ${holdMs}); /* unmapped/slow → control, cleanly */
  function impression(matched){
    try {
      var body = JSON.stringify({ utm_content: utm, matched: matched, ref: Math.random().toString(36).slice(2) });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(API + "/api/mm/" + ASSET + "/impression", new Blob([body], { type: "application/json" }));
      } else {
        fetch(API + "/api/mm/" + ASSET + "/impression", { method: "POST", headers: { "content-type": "application/json" }, body: body, keepalive: true }).catch(function(){});
      }
    } catch (e) { /* impressions never break the page */ }
  }
  fetch(API + "/api/mm/" + ASSET + "?utm_content=" + encodeURIComponent(utm))
    .then(function(r){ return r.json(); })
    .then(function(v){
      var swap = function(){
        var matched = false;
        if (v && v.headline) {
          var hs = document.querySelectorAll('[data-mm="headline"]');
          for (var i = 0; i < hs.length; i++) hs[i].textContent = v.headline;
          matched = hs.length > 0;
        }
        if (v && v.lead) {
          var ls = document.querySelectorAll('[data-mm="lead"]');
          for (var j = 0; j < ls.length; j++) ls[j].textContent = v.lead;
          matched = matched || ls.length > 0;
        }
        clearTimeout(fallback);
        reveal();
        window.__mmSwapAt = performance.now();
        impression(matched && Boolean(v && (v.headline || v.lead)));
      };
      if (document.body) swap();
      else document.addEventListener("DOMContentLoaded", swap);
    })
    .catch(function(){ clearTimeout(fallback); reveal(); });
})();
</script>`;
}
