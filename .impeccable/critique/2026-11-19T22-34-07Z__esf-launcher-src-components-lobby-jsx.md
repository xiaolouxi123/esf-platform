---
target: Lobby.jsx 大厅首屏与房间卡
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-11-19T22-34-07Z
slug: esf-launcher-src-components-lobby-jsx
---
Provenance: design review of the live Lobby in the running ESF launcher (1344x795 and 1920x1080 captures), plus static App.css/Lobby.jsx/LobbyRooms.jsx evidence. Detector run: 0 findings, but styles live in App.css so this is not evidence of cleanliness.

# Lobby / 大厅首屏 critique

**Target**: Lobby.jsx, LobbyRooms.jsx, App.css (lobby section)
**Score**: 18/40 · **P0**: 2 · **P1**: 2 · **P2**: 3

## Heuristic scores

| # | Heuristic | Score | Evidence |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Queue and room states exist, but a 0-player server and an active match look almost equally actionable. Offline cards fade to 2.52:1 text contrast. |
| 2 | Match between system and real world | 2 | 比赛服 / 约战服 / 公开服 is useful, but the same meaning is encoded five times (badge, 2px rail, border, tinted card, button). |
| 3 | User control and freedom | 2 | The primary CTA changes label by state, but there is no visible way to inspect what 快速匹配 will do before committing. |
| 4 | Consistency and standards | 1 | Same visual weight for 加入 / 查看排位 / 查看约战 / 进入比赛 / 观战 / 已锁服; four amber-ish surfaces on one card. |
| 5 | Error prevention | 2 | Quick match is enabled with 0 players and without a game directory; the failure arrives after the click. |
| 6 | Recognition rather than recall | 2 | Type labels are present but 9px and buried; users must decode color before reading text. |
| 7 | Flexibility and efficiency | 2 | Four rooms visible, no more affordance when the count exceeds four; the section title and 全部 both go to servers. |
| 8 | Aesthetic and minimalist design | 2 | The dragon hero is strong; the card grid is visually noisy and 71% empty inside each card. |
| 9 | Help users recover from errors | 2 | Disabled buttons do not explain why; no title or inline reason for offline / locked / full. |
| 10 | Help and documentation | 1 | Long inline teaching copy in the challenge card; no contextual help component. |
| **Total** |  | **18/40** |  |

## Design specificity

**Verdict: 6/10.** The dragon backdrop, ten-tier ladder, and season medal are authored for this product. The first-screen structure — slogan, four stat cells, two promo cards, four room cards, bottom status bar — is category-interchangeable. The biggest missed opportunity is that the arena one-match rule, the thing that makes this server special, is invisible until you are inside it.

Detector: detect.mjs on Lobby.jsx returned [] (exit 0). No config suppression exists. The styles are 100% in App.css (372 KB), so the single-file detector cannot see 9px Chinese labels, gradient text, or composed opacity. This is a coverage gap, not a pass.

## Overall impression

The page has a memorable world and a clear primary action, but it is trying to say everything at once: three server types, two competitive modes, four room actions, a queue state, an economy, and a social panel. The loudest things are the colored join buttons, not the decision the player came to make. A quieter card system plus one well-placed help popover would make the arena read as a place rather than a dashboard.

## What works

- The dragon hero gives the product a real identity and a clear emotional peak; it is the one thing no competitor can copy verbatim.
- The two-card deck (rank + challenge) is the right structural move. It turns a wall of links into two intents: climb and play with friends.
- The room data is complete: name, map/mode, ping, occupancy, state, favorite. Nothing essential is missing from the card.

## Priority issues

### [P0] One color axis is doing two jobs

**What**: Server type is encoded by a red/violet/blue gradient badge, a 2px colored rail, a tinted card background, a colored border, and a colored join button. The match card alone carries five warm surfaces (amber rail, amber border, warm brown ground, red badge, red CTA). The join buttons are the brightest elements on screen.

**Why it matters**: Color is supposed to answer what kind of room this is, but it is also answering what should I click and how urgent is this. When everything is colored, nothing is prioritized; the eye lands on four CTAs before it reads four room names. The red match CTA also reads as destructive.

**Fix**: Type becomes a quiet label with one small dot and one text color. Remove the rail, tinted ground, and colored border. Join buttons become a single neutral ghost style; only the currently recommended action (quick match) gets amber. Keep red for genuine danger only.

**Suggested command**: /impeccable quieter, then /impeccable colorize to rebuild the type tokens.

### [P0] The primary action is enabled when it cannot work

**What**: quickMatch (Lobby.jsx:847-863) does not call ensureGameDir, does not check onlineServers.length, and is disabled only by queueBusy === queue. With 0 players online it still toasts 已加入 1v1 排位匹配.

**Why it matters**: A first-time player clicks the biggest button, gets a success toast, waits, and nothing happens. This is the exact moment trust is lost. It also violates the product own one-token launch promise.

**Fix**: Gate the CTA on game directory and arena availability. If no game dir, run auto-find then open settings with a specific message. If no one is online, change the CTA to 等一位对手 and open a small queue explainer instead of claiming success. If a match is live, change it to 进入比赛 or 观战.

**Suggested command**: /impeccable harden.

### [P1] The type label is the smallest text on the card

**What**: .lobby-room-kind is 9px (10px only on some variants), while the room name is 13px and the meta line is 10.5px. Offline cards multiply opacity (0.62) and drop meta contrast to 2.52:1; disabled CTA falls to 2.31:1. The same 9-10px baseline recurs in .deck-steps b and several ranked-page captions.

**Why it matters**: The label is the only reliable way to tell a ranked arena from a casual server, especially for color-blind users. At 9px with tight tracking, Chinese strokes merge at 1080p.

**Fix**: Raise type label to 10.5px with 0.02em tracking, meta to 11.5px, and stop fading the whole card when offline. Replace opacity with a neutral 离线 state and keep body text at full contrast. Audit all lobby captions below 10px.

**Suggested command**: /impeccable typeset.

### [P1] Teaching copy and duplicate actions crowd the first screen

**What**: The challenge card carries one sentence plus three steps x two lines (seven lines of permanent instruction). The section title is a button that goes to the same place as the adjacent 全部 link. The hint below claims room rows expand to A2S player lists, but LobbyRooms.jsx has no expand behavior. 排行榜 and 我的战绩 both go to setPage ranked.

**Why it matters**: Permanent instructions are read once and then become noise. A false hint is worse: it teaches a behavior that does not exist. Duplicate destinations make the page feel unmanaged.

**Fix**: Collapse the challenge steps into one line plus a 怎么约战 click popover with the three steps. Make the section title plain text and keep one 全部 link. Delete the false A2S hint. Keep one ranked entry point on the deck (战绩与排行).

**Suggested command**: /impeccable distill.

### [P2] Focus and state details break the craft floor

**What**: .hero-cta uses clip-path and .btn:focus-visible draws its ring outside the border box, so the keyboard focus ring on 快速匹配 is clipped and invisible. .icon-btn--xs is 20x20 (below 24x24). The favorite button has title but no aria-label / aria-pressed. servers.map has no key, despite const key = server.serverKey.

**Why it matters**: Keyboard and screen-reader users cannot see focus or know whether a room is favorited; React reuses nodes by index when the list reorders.

**Fix**: Draw focus with an inset ring or a wrapper, enlarge the favorite hit area, add aria-label / aria-pressed, and pass key={key} to the article.

**Suggested command**: /impeccable harden.

## Persona red flags

**Alex (power user)**: No keyboard shortcut for quick match. Four room cards, each with a differently labeled CTA; no way to filter or sort from the lobby. The 全部 link is the only path to the full list, and it competes with a title that looks like a link.

**Jordan (first-timer)**: Reads 比赛服 / 约战服 / 公开服 as three unlabeled color chips. Clicks the red 加入 on a 0/12 server and gets a success toast, then waits for nothing. Cannot tell whether 快速匹配 needs a game directory until it fails.

**Casey (narrow window)**: At 1100px the grid collapses to one column and each card becomes ~900px wide with three data points; the page becomes a vertical stack of near-empty rows. At 795px height the hero subline is removed entirely, so the value proposition disappears on common laptop screens.

## Minor observations

- The hero em 旅程 inherits the parent gradient transparent fill because there is no .hero h1 em rule, so the semantic emphasis is invisible.
- .lobby-room header b ellipsizes long room names without a title.
- Refresh button has no .icon-btn:disabled style; during loading it still looks clickable.
- The online-room count uses the full list while the grid renders only four; there is no 还有 N 间.
- The bottom status bar still says http://119.29.82.217:3000 in the review build; that is a P2 housekeeping item, not a design issue.

## Questions to consider

- If the arena can only host one match at a time, why does the lobby show four equal room cards instead of one 正在打 / 下一位 arena strip plus a quieter 其他服务器 list?
- What would the first screen look like if color were reserved for exactly one thing: the action the player should take now?
- Could the challenge steps live entirely in the popover, with the card showing only the room current state and one action?
