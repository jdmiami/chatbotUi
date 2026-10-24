# Characters: how they work, and phase 2

Characters are made-up adults (25 or older), created from words in Make → Characters, kept with a
reference sheet, and used later in any prompt or as the new person in Swap a person.

This page says what phase 1 does (built), how the same person is kept across every picture, and what
phase 2 would add (not built) with the models checked on 2026-10-24.

## Phase 1 (built)

### What is stored

One folder per character on the AI machine, `characters/<id>/` (and the same keys in R2 under
`characters/<id>/` whenever the gallery is kept in R2, so the library still lists with the machine
off through the site's `/api/characters`):

- `character.json`: `id`, `name`, `adult: true`, `fictional: true`, `age`, `status` (`draft` until the
  sheet is accepted, then `ready`), `createdAt`, `owner?`, `descriptor` (the plain-words description
  put at the start of prompts), `traits` (look style, shown as, build, height, skin, face, eyes, hair,
  marks, outfits, personality notes), `seed` (locked at creation), `seeds` (the seed each view used),
  `sheet` (the views: `view`, `label`, `file`, `seed`, `identity`).
- the sheet pictures: `front-1.png`, `three-quarter-2.png`, … (a number is added every time a view is
  made again, so a changed picture never shows an old cached copy).

`ai/gate/src/characters.js` is the store (`list`, `get`, `create`, `update`, `rename`, `duplicate`,
`remove`, `accept`, `reference`, `file`, and the sheet run). `characters.get(id)` is synchronous and
returns `{ id, name, adult: true, fictional: true, age, owner?, sheet: [{ view, label, file }],
descriptor, traits, seed }` for characters that are `ready` (a draft returns `null`), so other modules
(the held-for-review rules, the Gallery) can read it. `createStudio({ characters })` takes it.

### Rules (the machine has the last word; the app shows them as you type)

- Words only. There is no upload path: a photo can never become a character. Uploaded photos stay
  ordinary photo inputs with the photo rules in `studio.js`.
- Age is required, a whole number from 25 to 120. Text that says a younger age is refused too.
- Refused in any field (name, idea, look, marks, outfits, notes): kids, teens, school, a young or
  teen-looking look (`mentionsMinor` plus extra cues such as "looks young", "teen-looking",
  "petite schoolgirl", "baby face"); real or famous people (about 100 well-known names, "looks like
  <Name>", "lookalike", "celebrity", "my ex / wife / coworker", "based on a photo"); anything sexual or
  revealing (the sheet is clothed and neutral; adult content is handled elsewhere); links, markup and
  instructions to the model.
- A name list can never be complete. It is a safety net behind the cues and behind the fact that a
  character cannot start from a picture.
- Each sheet picture also goes through the machine's NSFW check; a flagged one is thrown away and made
  again.

### How a job uses a character

`createJob` takes `character` (an id; only the owner's own, only once `ready`):

- Text-to-picture and text-to-video makers: the descriptor goes first in the prompt
  (`injectCharacter`), followed by the character's usual outfit unless the prompt already names clothes.
  The prompt is kept as written; only the stored description is cleaned (letters, numbers and plain
  punctuation, each field cut short), and the safety rules read the combined text.
- Makers that take a reference picture get the front view (or the face close-up for Swap a person's
  second picture) as the starting picture: New angle, Edit with words, Outfit swap (the character is
  picture 1, your outfit picture is picture 2), image-to-video first frame, talking photo, Move a
  photo, and Swap a person ("the new person" and its face close-up).
- A photo you add yourself always wins and is used exactly as before. Swap a person refuses a character
  and a photo together, so a real person's photo can never borrow "character" status.
- The job and its result carry `character: <id>` (`job.character`, `item.character`), so rules can
  see it. `photo: true` stays honest: it is set whenever you uploaded a photo.
- `seed` (a whole number) is accepted on any picture job.

### How the sheet is made, and how the same person is kept

1. The front view comes from the text-to-picture maker that matches the look (photoreal: Qwen Real,
   else Krea Real, else Qwen; anime: Anime; illustration: Qwen), at the locked seed, from the locked
   description plus the everyday outfit, full length on a plain grey background.
2. Every other view is made from the front picture, not from words: New angle (three-quarter, side,
   back, face close-up) when installed, else Edit with words; expressions (smiling, serious) from the
   face close-up; other outfits from the front. All with the same locked seed.
3. If the machine has a vision chat model, it compares each view with the front ("is this the same
   person?", 0 to 100). Views under 60 are made again once with a new seed, and the better of the two
   is kept. The score shows as "Matches" or "Check this" on the tile. With no vision model the check is
   skipped and the sheet says nothing about it.
4. You can make any view again, or the whole sheet (making the front again makes all views again).
   A changed look makes the old sheet out of date and takes the character out of use until it is made
   again.

What keeps identity in phase 1: one locked description, one locked seed, every view conditioned on the
same front picture through the editing models, a check that remakes drifting views, and the front
picture as the reference whenever a character is used later. It does not train anything, so it is as
consistent as the editing models are.

### Cost

About 5 pictures for the core sheet and 8 with the extras, 45 to 60 seconds each on the A40 (measured
for the picture makers; the angle and edit times are estimates until run), so roughly 5 to 10 minutes of
machine time. The vision check adds a short model swap at the end.

### What can only be proven on the real GPU

- The sheet itself: that "New angle" keeps the face across the side and back views, that the face
  close-up matches, and that the prompts above give clean full-length front pictures.
- The vision check: that the chat model on the machine can read two pictures and answer with a score,
  and how well its score matches what a person sees.
- Timing: the per-picture times, and the cost of swapping the chat model in and out around the check.
- The model-swap behaviour of ComfyUI when a job comes from the character maker while a chat model is
  loaded (the same path every Make job takes).

## Phase 2 (not built): train a small model per character

The strongest identity step is a LoRA trained on the character's own sheet, plus a face-identity
adapter for the video makers. Neither fits today's models cheaply, so they are left for phase 2.

### Option A: a LoRA per character on the picture model (recommended)

Train a rank 16 to 32 LoRA on the accepted sheet (8 to 12 pictures, plus a few extra angles made from
the same front), captioned with a trigger word and the descriptor. Then "Add a character" loads that
LoRA at strength about 0.8 in the picture makers, and the sheet's front picture stays the reference for
the editing makers.

| Item | Detail (checked 2026-10-24) |
| --- | --- |
| Base | Qwen-Image, `Qwen/Qwen-Image`, Apache-2.0, 20.4B parameters. https://huggingface.co/Qwen/Qwen-Image |
| Edit base | `Qwen/Qwen-Image-Edit-2509`, Apache-2.0, 20.4B parameters; transformer weights are 5 files, 40.9 GB in total. https://huggingface.co/Qwen/Qwen-Image-Edit-2509 |
| Trainer 1 | `kohya-ss/musubi-tuner`, Apache-2.0. README lists Qwen-Image LoRA training; 12 GB VRAM or more recommended for images (with block swapping and fp8 text encoder), 64 GB RAM recommended. Qwen-Image-Edit is not mentioned in the README. https://github.com/kohya-ss/musubi-tuner |
| Trainer 2 | `ostris/ai-toolkit`, MIT. Lists Qwen-Image and Qwen-Image-Edit as supported; its README gives no VRAM figure for them (its 24 GB figure is for FLUX), so measure on the A40 (48 GB). https://github.com/ostris/ai-toolkit |

Open points to settle before building: which Qwen-Image build the machine's ComfyUI nodes load (the
machine's files are the "2.1" builds named in `workflows.js`; a LoRA must be trained on the same
weights, so the trainer has to be pointed at those files or at their open base), training time and
price on the A40 (to measure; an hourly price must be told to the owner before it runs), a LoRA file of
about 150 to 500 MB per character in R2, and a "Train a model for this character" button with a clear
price and time.

### Option B: a face-identity adapter, no training

Cheaper per character, but each needs its own base model and brings licence limits.

| Model | Size | Licence (as stated on its page) | Fit |
| --- | --- | --- | --- |
| `guozinan/PuLID` (PuLID-FLUX v0.9.1). https://huggingface.co/guozinan/PuLID | 1.14 GB | Apache-2.0 | Needs a FLUX base and InsightFace + EVA-CLIP; FLUX.1 dev weights are non-commercial. |
| `InstantX/InstantID`. https://huggingface.co/InstantX/InstantID | 1.69 GB adapter + ControlNet | Apache-2.0 | SDXL only; needs InsightFace face models, which are "available for non-commercial research purposes". |
| `h94/IP-Adapter-FaceID`. https://huggingface.co/h94/IP-Adapter-FaceID | 65 MB to 1.5 GB per variant | Stated: "released exclusively for research purposes and is not intended for commercial use" | SD 1.5 / SDXL only. Lowest fit. |
| `black-forest-labs/FLUX.1-Kontext-dev`. https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev | 11.9B parameters | "other" (FLUX.1 dev non-commercial licence), gated | In-context editing that keeps a character across scenes; could replace "New angle" for sheets. |

None of these runs on the machine's current Qwen/Krea/LTX/H3 files, so each means another base model
download (tens of GB) and its own workflow. They are worth it only if Option A is not enough.

### Option C: use the editing model's own multi-picture identity

`Qwen-Image-Edit-2509` takes several input pictures and was released with better person consistency.
If the machine's edit builds gain that, switch the "other outfit" and "expression" views to pass the
front and the face close-up together. This is the smallest change, and it reuses Phase 1 exactly.

### What phase 2 adds to the product

- A "Train a model for this character" step after the sheet (price and time shown first), a trained
  badge on the character, and the LoRA used automatically wherever the character is.
- A measurable identity score (the vision score above, or a face-embedding similarity where the
  licence allows it) shown per view, and used to decide when a trained model beats the sheet alone.
- Video: the trained LoRA only helps picture makers. Video keeps using the front picture as its first
  frame; a face adapter for video would be a separate piece of work.
