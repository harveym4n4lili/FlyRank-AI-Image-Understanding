# Manual Setup: Things Only I Can Do

The code can't do these steps for me. Work top to bottom and tick each box as it's done.

## 1 · GitHub repo

- [ ] **Make the repo public:** GitHub → repo → Settings → General → Danger Zone → *Change visibility* → Public.
  The brief requires the repo to be public from day one.
- [ ] **(Recommended) Rename to `flyrank-capstone-image-relevance`.** The brief asks for the format
  `flyrank-capstone-<short-name>`, lowercase with hyphens. Settings → General → Repository name. GitHub redirects
  the old URL, but update the local remote anyway:
  ```bash
  git remote set-url origin https://github.com/harveym4n4lili/flyrank-capstone-image-relevance.git
  ```
- [ ] Add a one-line description and the topics `ai`, `computer-vision`, `embeddings`, `pgvector`, `express`.

## 2 · Tools on this machine

| Tool | Check | Notes |
|---|---|---|
| Node 24 | `node -v` | already installed |
| Docker Desktop | `docker info` | installed per-user; **start it before** `docker compose`, because it doesn't start on its own |
| Git | `git --version` | already installed |

- [ ] (Optional) Turn on Docker Desktop → Settings → General → *Start Docker Desktop when you sign in*.

## 3 · Gemini API key (free, no credit card)

- [ ] Go to **https://aistudio.google.com**, sign in with a Google account, open **Get API key**, and create a key.
  If any page asks for a credit card, stop: that's the wrong path.
- [ ] Never paste the key into code, chat, commits or screenshots. It only goes in `.env`.
- [ ] Check the key works and list the available models. The key goes in a header, not the URL, so it stays
  out of server logs:
  ```bash
  curl -s -H "x-goog-api-key: $GEMINI_API_KEY" \
    "https://generativelanguage.googleapis.com/v1beta/models" | grep '"name"'
  ```
- [ ] Choose the models and write them in `.env`:
  - `GEMINI_VISION_MODEL`: the current **Flash** model on the free tier
  - `GEMINI_EMBED_MODEL`: the current **Gemini embedding** model
- [ ] Look up the free-tier rate limits (requests per minute and per day) on the Gemini pricing / rate-limits page,
  and write them, plus the chosen model ids, into the decisions log in [DESIGN.md](DESIGN.md#decisions-log).
  This closes an open question.

## 4 · Local environment

- [ ] `cp .env.example .env`, then fill in `GEMINI_API_KEY` and the two model ids. Leave the rest at their defaults.
- [ ] Confirm git ignores it: `git check-ignore .env` should print `.env`.
- [ ] Boot the stack and check it:
  ```bash
  docker compose up --build -d
  curl http://localhost:3000/health          # → {"status":"ok","db":true}
  docker compose down                        # when finished
  ```
- [ ] Run the checks: `npm install && npm test && npm run lint && npm run typecheck`.

## 5 · Collect the image corpus (Phase 1)

The target is **50 images, 10 per animal**. Use only **Unsplash** (https://unsplash.com/license) or
**Pexels** (https://www.pexels.com/license/). Read both license pages once, which takes about 2 minutes each.

| Animal | `expected_label` | Must include |
|---|---|---|
| Red fox | `red_fox` | 1 fox **far away in snow** (should come out low-confidence), 1 fox cub |
| Gray wolf | `gray_wolf` | 2 wolves **in forest scenes similar to the fox shots** (the near-miss) |
| Dog | `dog` | 2 **husky / wolf-like** dogs, 1 **red shiba** (orange like a fox) |
| Bear | `brown_bear` / `black_bear` | a mix of both |
| Deer | `white_tailed_deer` / `red_deer` | 1 **silhouette at dusk** (should come out low-confidence) |

Labels must come from `src/config/taxonomy.ts`.

For each photo, add one entry to `data/manifest.json`:

```json
{
  "id": "red-fox-01",
  "file": "red-fox-01.jpg",
  "source_url": "https://unsplash.com/photos/<photo-slug>",
  "download_url": "https://images.unsplash.com/photo-<id>?w=1600",
  "photographer": "Jane Doe",
  "license": "Unsplash",
  "expected_label": "red_fox",
  "notes": "distant, snowy (hard case)"
}
```

Where to find `download_url`:
- **Unsplash:** open the photo → right-click the large image → *Copy image address*. Keep the
  `https://images.unsplash.com/photo-...` part and set `?w=1600`.
- **Pexels:** open the photo → right-click → *Copy image address*. It looks like
  `https://images.pexels.com/photos/<id>/pexels-photo-<id>.jpeg?...`. Replace the query string with `?w=1600`.

Then run:

- [ ] `npm run corpus:download`. This validates the manifest, downloads and resizes each image (≤ 800px),
  skips files that already exist, and prints the total size and per-label counts.
- [ ] If the total is **under ~5 MB**, commit `data/images/`. If it's larger, commit only the manifest. Record
  which one you chose in the decisions log.
- [ ] Open a few images and check they are what the manifest says.

`expected_label` is used **only by the eval script**. The model and the guard never see it.

## 6 · Review the design (Phase 1 gate)

- [ ] Read [DESIGN.md](DESIGN.md), [SPEC.md](SPEC.md) and [GUARD_AND_EVAL.md](GUARD_AND_EVAL.md) and change anything I disagree with.
- [ ] Be able to explain, in my own words, why `subject_label` exists alongside `subject`, and what the
  guard does with a post about penguins.
- [ ] Tick the Phase 1 boxes in [ROADMAP.md](ROADMAP.md).

## 7 · Habits for every session

- [ ] Start Docker Desktop, then `docker compose up -d`.
- [ ] At least one commit per session, with a message that says what changed.
- [ ] Add an entry to `BUILDLOG.md`: what I did, where AI helped, where it was wrong, and what I changed.
- [ ] Paste real command output into `EVIDENCE.md` as soon as each requirement works.
- [ ] Never commit `.env` or keys. If a key ever leaks, **rotate it in AI Studio immediately**, then ask for help.

## 8 · Before submitting

- [ ] Every box in `EVIDENCE.md` is ticked and has pasted proof.
- [ ] Clean-machine test: clone the repo into a new folder, `cp .env.example .env` (add the key),
  run the `run:` and `seed:` commands from `capstone.yaml`, and confirm the probes still work.
- [ ] The README has the real top-1 precision number and an honest *Limitations* section.
- [ ] Submit **only the repo link** through the portal form. No ZIP files.
