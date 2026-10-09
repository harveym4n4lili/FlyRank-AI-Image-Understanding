# Manual Setup: Things Only I Can Do

The code can't do these steps for me. Work top to bottom and tick each box as it's done.

## 1 · GitHub repo

- [X] **Make the repo public:** GitHub → repo → Settings → General → Danger Zone → *Change visibility* → Public.
  The brief requires the repo to be public from day one.
- [X] **(Recommended) Rename to `flyrank-capstone-image-relevance`.** The brief asks for the format
  `flyrank-capstone-<short-name>`, lowercase with hyphens. Settings → General → Repository name. GitHub redirects
  the old URL, but update the local remote anyway:
  ```bash
  git remote set-url origin https://github.com/harveym4n4lili/flyrank-capstone-image-relevance.git
  ```
- [X] Add a one-line description and the topics `ai`, `computer-vision`, `embeddings`, `pgvector`, `express`.

## 2 · Tools on this machine

| Tool | Check | Notes |
|---|---|---|
| Node 24 | `node -v` | already installed |
| Docker Desktop | `docker info` | installed per-user; **start it before** `docker compose`, because it doesn't start on its own |
| Git | `git --version` | already installed |

- [ ] (Optional) Turn on Docker Desktop → Settings → General → *Start Docker Desktop when you sign in*.

## 3 · Gemini API key (free, no credit card)

- [X] Go to **https://aistudio.google.com**, sign in with a Google account, open **Get API key**, and create a key.
  If any page asks for a credit card, stop: that's the wrong path.
- [X] Never paste the key into code, chat, commits or screenshots. It only goes in `.env`.
- [X] Check the key works and list the available models. The key goes in a header, not the URL, so it stays
  out of server logs:
  ```bash
  curl -s -H "x-goog-api-key: $GEMINI_API_KEY" \
    "https://generativelanguage.googleapis.com/v1beta/models" | grep '"name"'
  ```
- [x] Choose the models and write them in `.env`:
  - `GEMINI_VISION_MODEL`: the current **Flash** model on the free tier (chosen: `gemini-3.8-flash`)
  - `GEMINI_EMBED_MODEL`: the current **Gemini embedding** model (chosen: `gemini-embedding-2`)
  - Why these: decision #14 in [DESIGN.md](DESIGN.md#decisions-log)
- [x] Look up the free-tier rate limits (requests per minute and per day) on the Gemini pricing / rate-limits page,
  and write them, plus the chosen model ids, into the decisions log in [DESIGN.md](DESIGN.md#decisions-log).
  This closes an open question.

## 4 · Local environment

- [x] `cp .env.example .env`, then fill in `GEMINI_API_KEY` and the two model ids. Leave the rest at their defaults.
- [X] Confirm git ignores it: `git check-ignore .env` should print `.env`.
- [X] Boot the stack and check it:
  ```bash
  docker compose up --build -d
  curl http://localhost:3000/health          # → {"status":"ok","db":true}
  docker compose down                        # when finished
  ```
- [x] Run the checks: `npm install && npm test && npm run lint && npm run typecheck`.
- [x] Set `DEMO_API_KEY` in `.env` (any long random string), then seed the demo workspace:
  `docker compose exec -T api node dist/db/seed.js`. Every endpoint except `/health` needs the header
  `X-Api-Key: <DEMO_API_KEY>`.

## 5 · Image corpus (Phase 1)

The 50 images are **already chosen**: 10 each of red fox, gray wolf, dog, bear and deer, hand-picked from Pexels
and listed in `data/manifest.json`. What they are and why: [GUARD_AND_EVAL.md](GUARD_AND_EVAL.md#image-corpus).

### Download and check

- [X] `npm run corpus:download`. This validates the manifest, downloads each image, resizes it to ≤ 800px, and saves
  it as `data/images/<id>.jpg`. Images it already has are skipped, so it's safe to re-run. At the end it prints the
  total size and the count per label.
- [x] Open `data/images/` and check each image matches its label. Pay particular attention to:
  - **The 4 `SPECIES UNVERIFIED` deer** (`white-tailed-deer-04`, `05`, `red-deer-01`, `02`).
    A **white-tailed deer** has a plain tan coat, white under the tail and on the throat, and forward-curving antlers.
    A **red deer** is larger and reddish, with a pale rump patch and tall branching antlers.
    A **fallow deer** has white spots and flat, palm-shaped antlers; it fits neither label, so replace it.
    Once checked, fix the label if needed and delete the `SPECIES UNVERIFIED` note.
  - `red-fox-09`: the fox should be **small in the frame**, so the model has a real reason to be unsure.
  - `dog-09`: it should actually look wolf-like.
- [x] If the total is **under ~5 MB**, commit `data/images/`. If it's larger, commit only the manifest. Record which
  one you chose in the decisions log in [DESIGN.md](DESIGN.md#decisions-log).
- [x] Note in BUILDLOG.md any photos you swapped and why.

### Replacing or adding an image

1. Find the photo on Pexels (`https://www.pexels.com/search/<term>/`) and copy its **page URL** from the address bar.
2. In `data/manifest.json`, replace that entry's `source_url` (keep its `id`), or add a new entry:
   ```json
   { "id": "red-fox-11", "source_url": "https://www.pexels.com/photo/red-fox-in-the-forest-1234567/",
     "expected_label": "red_fox", "notes": "optional" }
   ```
   `expected_label` must be one of the labels in `src/config/taxonomy.ts`.
3. When replacing, delete the old `data/images/<id>.jpg` (or run with `-- --force`), then run `npm run corpus:download`.

Only Pexels photo pages are accepted, because the script derives the direct image link from the page URL. The script
reports any invalid entry by its position, along with the reason.

`expected_label` is used **only by the eval script**. The model and the guard never see it.

## 6 · Review the design (Phase 1 gate)

- [x] Read [DESIGN.md](DESIGN.md), [SPEC.md](SPEC.md) and [GUARD_AND_EVAL.md](GUARD_AND_EVAL.md) and change anything I disagree with.
- [x] Be able to explain, in my own words, why `subject_label` exists alongside `subject`, and what the
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
