// Minimal internal review page (no frontend build). It holds no data itself: it asks for the API
// key, keeps it in sessionStorage, and calls the same validated JSON endpoints as curl would.
export const REVIEW_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Suggestion review</title>
<style>
  :root { --bg:#fff; --fg:#1b1f24; --muted:#5b6470; --line:#d8dde3; --ok:#1a7f37; --bad:#b42318; --chip:#f1f3f5; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1216; --fg:#e6e9ee; --muted:#9aa4b2; --line:#2a313a; --ok:#4ac26b; --bad:#ff7b72; --chip:#1b2027; } }
  body { margin:0; padding:16px; font:14px/1.45 system-ui, sans-serif; background:var(--bg); color:var(--fg); }
  h1 { font-size:18px; margin:0 0 12px; }
  .bar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:12px; }
  input, select, button { font:inherit; padding:6px 8px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--fg); }
  button { cursor:pointer; }
  .wrap { overflow-x:auto; }
  table { border-collapse:collapse; width:100%; min-width:720px; }
  th, td { text-align:left; vertical-align:top; padding:8px; border-bottom:1px solid var(--line); }
  th { color:var(--muted); font-weight:600; }
  img { width:120px; height:84px; object-fit:cover; border-radius:6px; background:var(--chip); }
  .ACCEPTED { color:var(--ok); font-weight:600; } .REJECTED { color:var(--bad); font-weight:600; }
  .reasons { margin:0; padding-left:16px; color:var(--muted); }
  .msg { color:var(--muted); }
</style>
</head>
<body>
<h1>Suggestion review</h1>
<div class="bar">
  <input id="key" type="password" placeholder="X-Api-Key" autocomplete="off">
  <select id="status"><option>pending</option><option>approved</option><option>rejected</option></select>
  <select id="verdict"><option value="ACCEPTED">guard: accepted</option><option value="REJECTED">guard: rejected</option><option value="">all</option></select>
  <button id="load">Load</button>
  <span id="msg" class="msg"></span>
</div>
<div class="wrap"><table>
  <thead><tr><th>Post</th><th>Image</th><th>Guard</th><th>Why</th><th>Decision</th></tr></thead>
  <tbody id="rows"></tbody>
</table></div>
<script>
const $ = (id) => document.getElementById(id);
const store = { get: () => { try { return sessionStorage.getItem("apiKey") || ""; } catch { return ""; } },
                set: (v) => { try { sessionStorage.setItem("apiKey", v); } catch {} } };
$("key").value = store.get();
const headers = () => ({ "X-Api-Key": $("key").value });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" })[c]);

async function thumb(img, imageId) {
  const res = await fetch("/images/" + imageId + "/file", { headers: headers() });
  if (res.ok) img.src = URL.createObjectURL(await res.blob());
}

async function load() {
  store.set($("key").value);
  const q = new URLSearchParams({ status: $("status").value });
  if ($("verdict").value) q.set("verdict", $("verdict").value);
  const res = await fetch("/review?" + q, { headers: headers() });
  const body = await res.json();
  if (!res.ok) { $("msg").textContent = body.error?.message || res.status; return; }
  $("msg").textContent = body.count + " suggestion(s)";
  $("rows").innerHTML = body.items.map((s) =>
    '<tr data-id="' + s.id + '"><td>' + esc(s.postTitle) + '</td>' +
    '<td><img data-image="' + s.imageId + '" alt=""><div class="msg">' + esc(s.imageFile) + '</div></td>' +
    '<td><span class="' + s.verdict + '">' + s.verdict + '</span><div class="msg">rank ' + s.rank + ' · sim ' + s.similarity.toFixed(2) + '</div></td>' +
    '<td><ul class="reasons">' + s.reasons.map((r) => '<li>' + esc(r.message) + '</li>').join("") + '</ul></td>' +
    '<td>' + (s.reviewStatus === "pending"
      ? (s.verdict === "ACCEPTED" ? '<button data-act="approve">Approve</button> ' : '') + '<button data-act="reject">Reject</button>'
      : esc(s.reviewStatus)) + '</td></tr>').join("");
  document.querySelectorAll("img[data-image]").forEach((img) => thumb(img, img.dataset.image));
}

$("rows").addEventListener("click", async (e) => {
  const act = e.target.dataset?.act; if (!act) return;
  const row = e.target.closest("tr");
  const res = await fetch("/suggestions/" + row.dataset.id + "/" + act, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: "{}",
  });
  const body = await res.json();
  row.lastElementChild.textContent = res.ok ? body.reviewStatus : (body.error?.message || res.status);
});
$("load").addEventListener("click", load);
if ($("key").value) load();
</script>
</body>
</html>
`;
