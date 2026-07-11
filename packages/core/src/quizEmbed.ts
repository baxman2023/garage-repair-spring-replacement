/**
 * Single-file quiz embed (WO-040): a fully self-contained HTML document —
 * inline CSS + JS, zero external resources — that renders one question per
 * screen with a progress bar and posts answers to the hosted API. Questions
 * are EMBEDDED (client-safe subset only: no weights, no disqualify flags), so
 * the quiz renders instantly from file:// or any third-party page; scoring
 * always happens server-side on completion.
 */

export interface PublicQuizQuestion {
  id: string;
  text: string;
  options: Array<{ id: string; text: string }>;
}

export interface QuizEmbedInputs {
  slug: string;
  questions: PublicQuizQuestion[];
  leadCapture: { headline: string; button: string; fields: Array<'name' | 'email' | 'phone'> };
  /** Absolute origin of the hosted API, e.g. "https://app.copyforge.io". */
  apiBase: string;
}

export function renderQuizEmbedHtml(inputs: QuizEmbedInputs): string {
  if (!/^https?:\/\/[^/]+$/.test(inputs.apiBase)) {
    throw new Error('apiBase must be an absolute origin like https://app.example.com (no trailing slash).');
  }
  const config = {
    slug: inputs.slug,
    apiBase: inputs.apiBase,
    questions: inputs.questions,
    leadCapture: inputs.leadCapture,
  };

  // NOTE: everything below is inline — the acceptance requires file:// operation.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quick quiz</title>
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box;margin:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f7f7f9;color:#16181d;display:flex;justify-content:center;padding:16px}
  .cfq{width:100%;max-width:560px}
  .cfq-progress{height:6px;background:#e2e4ea;border-radius:3px;margin-bottom:20px;overflow:hidden}
  .cfq-progress>div{height:100%;background:#2563eb;width:0;transition:width .25s ease}
  .cfq-card{background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
  .cfq-q{font-size:1.25rem;font-weight:650;margin-bottom:16px;line-height:1.35}
  .cfq-opt{display:block;width:100%;text-align:left;padding:14px 16px;margin:8px 0;border:1px solid #d5d8e0;border-radius:10px;background:#fff;font-size:1rem;cursor:pointer}
  .cfq-opt:active{background:#eef2ff}
  .cfq-input{display:block;width:100%;padding:12px 14px;margin:8px 0;border:1px solid #d5d8e0;border-radius:10px;font-size:1rem}
  .cfq-btn{display:block;width:100%;padding:14px;margin-top:12px;border:none;border-radius:10px;background:#2563eb;color:#fff;font-size:1.05rem;font-weight:650;cursor:pointer}
  .cfq-result h1{font-size:1.4rem;margin-bottom:12px;line-height:1.3}
  .cfq-result p{margin:10px 0;line-height:1.55}
  .cfq-muted{color:#6b7280;font-size:.85rem;margin-top:14px;text-align:center}
</style>
</head>
<body>
<div class="cfq">
  <div class="cfq-progress"><div id="cfq-bar"></div></div>
  <div class="cfq-card" id="cfq-card"></div>
  <p class="cfq-muted">Takes under a minute · your answers personalize the result</p>
</div>
<script>
(function(){
  "use strict";
  var CFG = ${JSON.stringify(config)};
  var state = { i: 0, answers: {}, ref: null };
  var card = document.getElementById("cfq-card");
  var bar = document.getElementById("cfq-bar");

  function api(path, body){
    try {
      return fetch(CFG.apiBase + "/api/quiz/" + encodeURIComponent(CFG.slug) + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }).then(function(r){ return r.json(); });
    } catch (e) { return Promise.reject(e); }
  }

  function progress(){
    var total = CFG.questions.length + 1;
    bar.style.width = Math.round((state.i / total) * 100) + "%";
  }

  function esc(s){
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function renderQuestion(){
    progress();
    var q = CFG.questions[state.i];
    var html = '<div class="cfq-q">' + esc(q.text) + '</div>';
    for (var j = 0; j < q.options.length; j++) {
      html += '<button class="cfq-opt" data-opt="' + esc(q.options[j].id) + '">' + esc(q.options[j].text) + '</button>';
    }
    card.innerHTML = html;
    var buttons = card.querySelectorAll(".cfq-opt");
    for (var k = 0; k < buttons.length; k++) {
      buttons[k].addEventListener("click", function(ev){
        var optionId = ev.currentTarget.getAttribute("data-opt");
        state.answers[q.id] = optionId;
        if (state.ref) api("/answer", { sessionRef: state.ref, questionId: q.id, optionId: optionId }).catch(function(){});
        state.i++;
        if (state.i < CFG.questions.length) renderQuestion();
        else renderLeadCapture();
      });
    }
  }

  function renderLeadCapture(){
    progress();
    var lc = CFG.leadCapture;
    var html = '<div class="cfq-q">' + esc(lc.headline) + '</div>';
    for (var i = 0; i < lc.fields.length; i++) {
      var f = lc.fields[i];
      html += '<input class="cfq-input" id="cfq-f-' + f + '" type="' + (f === "email" ? "email" : f === "phone" ? "tel" : "text") + '" placeholder="' + f.charAt(0).toUpperCase() + f.slice(1) + '">';
    }
    html += '<button class="cfq-btn" id="cfq-submit">' + esc(lc.button) + '</button>';
    card.innerHTML = html;
    document.getElementById("cfq-submit").addEventListener("click", function(){
      var contact = {};
      for (var i = 0; i < lc.fields.length; i++) {
        contact[lc.fields[i]] = (document.getElementById("cfq-f-" + lc.fields[i]).value || "").trim();
      }
      var finish = function(ref){
        return api("/complete", { sessionRef: ref, answers: state.answers, contact: contact });
      };
      var flow = state.ref ? finish(state.ref)
        : api("/start", {}).then(function(s){ state.ref = s.sessionRef; return finish(s.sessionRef); });
      flow.then(renderResult).catch(function(){
        card.innerHTML = '<div class="cfq-q">Almost there…</div><p>We could not reach the server. Please check your connection and tap the button again.</p><button class="cfq-btn" id="cfq-retry">Retry</button>';
        document.getElementById("cfq-retry").addEventListener("click", renderLeadCapture);
      });
    });
  }

  function renderResult(result){
    bar.style.width = "100%";
    var html = '<div class="cfq-result">';
    if (result.disqualified && result.decline) {
      html += "<h1>" + esc(result.decline.headline) + "</h1><p>" + esc(result.decline.body) + "</p>";
    } else if (result.band) {
      for (var i = 0; i < result.band.resultBlocks.length; i++) {
        var b = result.band.resultBlocks[i];
        if (b.role === "headline") html += "<h1>" + esc(b.text) + "</h1>";
        else if (b.role === "cta") html += '<button class="cfq-btn">' + esc(b.text) + "</button>";
        else html += "<p>" + esc(b.text) + "</p>";
      }
    }
    html += "</div>";
    card.innerHTML = html;
  }

  // Fire-and-forget session start — rendering never blocks on the network,
  // so the quiz works instantly from file:// and third-party embeds.
  api("/start", {}).then(function(s){ state.ref = s.sessionRef; }).catch(function(){});
  renderQuestion();
})();
</script>
</body>
</html>
`;
}
