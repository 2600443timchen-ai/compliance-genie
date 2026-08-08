"""Fully automated Playwright demo runner for Compliance Genie.

Implements the split-screen state machine you sketched, in an Apple-minimal
light visual style (white/light-gray, soft shadows, rounded everything):

    [*] -> State1_GlobalView (Left: floating rounded-square Vertical Stepper
           @ step 1 / Right: whole app framed inside a rounded, shadowed
           "floating window" card, fit to a modest overview scale)
    State1_GlobalView -> State2_FeatureFocus  : start introducing one feature
        (Left: stepper advances / Right: a SUBTLE dolly-in on the target UI
         component — the card's rounded edge stays visible, no edge-to-edge
         full-bleed zoom)
    State2_FeatureFocus -> State3_GlobalView  : feature explanation done
        (Left: stepper moves to next step / Right: eases back to the global
         framing inside the card)
    ... repeats State2 <-> State3 for every feature, per workspace page.

The right-hand "window" is real content (not a screenshot) — a wrapper div
is pan/zoomed with CSS transforms computed from each target element's actual
bounding box, so Playwright's real clicks land correctly on the zoomed-in
elements. The left-hand stepper is a floating white card with rounded-square
step nodes, injected as an unscaled sibling. Captions render as a floating
light pill (not a full-width dark bar) anchored to the bottom-right of the
card. Narration matches docs/demo_script_finance_workspace.md; each step
also prints to stdout.

Setup (one-time):
    pip install playwright
    playwright install chromium

Start cmd — run these in order:
    # 1) start the demo server yourself and leave it running (this script
    #    never restarts it, matching the "don't restart mid-demo" rule)
    python analytics_server.py --workspace finance --port 8765

    # 2) in a second terminal, run the automated recording
    python scripts/demo_recording.py --pace 1.5 --video-dir demo_output

    # headless (no visible window), for CI-style unattended recording:
    python scripts/demo_recording.py --headless --video-dir demo_output

Output:
    Playwright starts a new video segment on every page.goto(), so you will
    get 2 .webm files under --video-dir (one per workspace page), in
    creation order. Concatenate + convert with ffmpeg:
        ffmpeg -f concat -safe 0 -i <(for f in demo_output/*.webm; do
            echo "file '$PWD/$f'"; done) -c:v libx264 -c:a aac out.mp4
"""

from __future__ import annotations

import argparse
import io
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

if sys.platform == "win32" and hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

try:
    from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, sync_playwright
except ImportError:
    print("Playwright is not installed. Run: pip install playwright && playwright install chromium")
    sys.exit(1)


# Adapted for a 1920x1200 physical display at 125% OS scaling: Chromium's
# viewport/window sizing is in CSS (logical) pixels, so the recording
# viewport must target the LOGICAL resolution (physical / scale), not the
# physical one, or a headed window will be sized larger than the visible
# screen and get clipped. 1920/1.25=1536, 1200/1.25=960. If you run this on
# a different monitor/scaling, override with --width/--height (compute the
# same way: physical_px / (scale_percent / 100)).
SCREEN_LOGICAL_WIDTH = 1536
SCREEN_LOGICAL_HEIGHT = 960

STEPPER_WIDTH = 240        # width of the floating stepper card itself
STEPPER_MARGIN = 24        # inset from the window edge + gap before the right pane
CARD_MARGIN = 32           # breathing room around the bounded right-hand "window" card
CARD_MAX_WIDTH = 1560      # the card is size-capped (not edge-to-edge), so it reads as a
CARD_MAX_HEIGHT = 900      # contained floating window with equal top/bottom margin

# #demo-stage is pinned to the product's own real design width and rendered
# there unconstrained, THEN scaled down to fit the (often narrower) card via
# transform — never the other way around. Without this, #demo-stage has no
# explicit width and defaults to 100% of #demo-card's box; since the card is
# now size-capped (and can be narrower than the product's design width,
# e.g. under SCREEN_LOGICAL_WIDTH=1536), the page's own responsive CSS was
# reflowing into that narrower box and elements started overlapping/crowding
# — confirmed by comparing the 1920px-wide render (clean) against the
# 1536px-wide one (search bar overlapping the nav pills). Pinning the width
# means the product always lays out exactly as designed, and shrinking is
# purely a visual transform, not a reflow.
DESIGN_WIDTH = 1920

# Apple-minimal light theme: the global view fills the card (true fit-to-card
# scale, computed at runtime in zoom() — see FIT_PADDING) rather than
# floating at a tiny fixed scale surrounded by blank card, and feature focus
# only "dolly in" a little on top of that — the card's rounded edge must
# stay visible even when zoomed, per the brief (avoid the old edge-to-edge
# 2x+ zooms that felt like a jump-cut and lost spatial context).
OVERVIEW_MULT_INITIAL = 0.96   # State1_GlobalView (barely inset from a full fit)
OVERVIEW_MULT_RETURN = 1.0     # State3_GlobalView (full fit-to-card)

STAGE_CSS = f"""
html, body {{ background: #eef0f3 !important; }}
#demo-viewport {{
  position: fixed; left: {STEPPER_WIDTH + STEPPER_MARGIN * 2}px; top: 0; right: 0; bottom: 0;
  overflow: hidden; background: #eef0f3; z-index: 1;
  display: flex; align-items: center; justify-content: center;
  box-sizing: border-box; padding: {CARD_MARGIN}px;
}}
#demo-card {{
  position: relative; flex: none;
  width: min(100%, {CARD_MAX_WIDTH}px); height: min(100%, {CARD_MAX_HEIGHT}px);
  border-radius: 28px; overflow: hidden; background: #ffffff;
  box-shadow: 0 24px 60px -12px rgba(15,23,42,0.18), 0 8px 24px -8px rgba(15,23,42,0.10);
  transition: box-shadow 0.4s ease;
}}
#demo-stage {{
  width: {DESIGN_WIDTH}px; min-width: {DESIGN_WIDTH}px;
  transform-origin: 0 0;
  transition: transform 0.8s cubic-bezier(.4,0,.2,1);
  will-change: transform;
}}
#demo-fixed-anchor {{
  /* Anchors relocated fixed-position overlays (Genie drawer, insight
  popover, validation modal) to the CARD's own full box — not <main>'s,
  which sits inset by the product's own gutter/max-width and made the
  drawer look like a floating rectangle mid-card instead of a flush side
  panel. The card's edges are also perfectly stable across every zoom
  state, so nothing needs runtime tracking.
  Deliberately left/top/width/height, NOT `inset: 0`: toggling
  body.ai-drawer-open (which sets a padding-right on body) throws
  the `inset: 0`-computed box off by exactly that width, even though the
  card's own rect (measured independently) never moves — reproduced
  reliably, root cause not fully explained (smells like a Chromium
  layout-cache quirk tied to right/bottom-based sizing specifically), but
  switching to explicit left/top + percentage width/height sidesteps it. */
  position: absolute; left: 0; top: 0; width: 100%; height: 100%;
  pointer-events: none;
}}
/* .ai-drawer docks flush to #demo-card's right edge (top:0;right:0;bottom:0
   from its own stylesheet, now resolved against the anchor above) — round
   its outer corners to match the card's 28px radius so it reads as part of
   the card's silhouette instead of a hard-cornered rectangle poking out of
   a rounded shape. */
#demo-fixed-anchor .ai-drawer {{
  border-top-right-radius: 28px;
  border-bottom-right-radius: 28px;
}}
.demo-focus-outline {{
  outline: 3px solid #c5a059 !important;
  outline-offset: 5px !important;
  box-shadow: 0 0 22px rgba(197, 160, 89, 0.55) !important;
  border-radius: 12px !important;
}}
#demo-stepper {{
  position: fixed; left: {STEPPER_MARGIN}px; top: 50%; transform: translateY(-50%);
  width: {STEPPER_WIDTH}px; max-height: calc(100% - {STEPPER_MARGIN * 2}px);
  z-index: 2; background: #ffffff; color: #64748b;
  font: 500 13.5px/1.5 'Outfit', 'Noto Sans TC', sans-serif;
  padding: 26px 20px; box-sizing: border-box; border-radius: 24px;
  display: flex; flex-direction: column; gap: 2px;
  box-shadow: 0 20px 45px -14px rgba(15,23,42,0.16), 0 6px 16px -6px rgba(15,23,42,0.06);
}}
#demo-stepper .demo-step-title {{
  color: #1f2937; font-size: 14.5px; font-weight: 700; margin-bottom: 20px;
  letter-spacing: 0.01em;
}}
#demo-stepper .demo-step {{
  position: relative; padding: 11px 0 11px 30px; font-size: 13px;
  color: #b0b8c4; transition: color 0.3s ease;
}}
#demo-stepper .demo-step::before {{
  content: ''; position: absolute; left: 2px; top: 13px; width: 12px; height: 12px;
  border-radius: 4px; background: #ffffff; border: 2px solid #d8dde5;
  transition: all 0.3s ease; box-sizing: border-box;
}}
#demo-stepper .demo-step::after {{
  content: ''; position: absolute; left: 7px; top: 27px; bottom: -6px; width: 2px;
  background: #ebeef2;
}}
#demo-stepper .demo-step:last-child::after {{ display: none; }}
#demo-stepper .demo-step.done {{ color: #94a3b8; }}
#demo-stepper .demo-step.done::before {{ background: #c5a059; border-color: #c5a059; }}
#demo-stepper .demo-step.active {{ color: #1f2937; font-weight: 700; }}
#demo-stepper .demo-step.active::before {{
  background: #c5a059; border-color: #c5a059;
  box-shadow: 0 0 0 5px rgba(197, 160, 89, 0.18);
}}
#demo-caption-bar {{
  position: absolute; left: 24px; right: 24px; bottom: 24px; z-index: 999999;
  background: rgba(255, 255, 255, 0.94); color: #1f2937;
  font: 600 17px/1.5 'Outfit', 'Noto Sans TC', sans-serif;
  padding: 16px 26px; text-align: center; border-radius: 18px;
  backdrop-filter: blur(6px);
  box-shadow: 0 16px 40px -10px rgba(15,23,42,0.22), 0 4px 12px -4px rgba(15,23,42,0.08);
  opacity: 0; transform: translateY(10px); transition: all 0.35s ease;
}}
#demo-caption-bar.visible {{ opacity: 1; transform: translateY(0); }}
"""


@dataclass
class Step:
    stage_label: str                       # left-stepper entry text
    narration: str                         # caption text (burned into video)
    target: Optional[str] = None           # selector to zoom into; None = global view
    zoom_scale: float = 1.3                # dolly multiplier ON TOP of the fit-to-card scale
    hold: float = 2.5
    action: Optional[Callable[[Page], None]] = None   # runs after zoom-in settles
    action_wait: float = 0.0               # extra hold after the action, before zooming out
    global_scale: Optional[float] = None   # override the return-to-global multiplier for this step


def ensure_stage(page: Page) -> None:
    """Wrap the page's existing content in a floating, rounded "window" card
    (#demo-card) that pan/zooms internally, and inject the fixed left
    stepper + floating caption pill as unscaled siblings."""
    page.add_style_tag(content=STAGE_CSS)
    page.evaluate(
        """
        () => {
          if (document.getElementById('demo-stage')) return;
          const viewport = document.createElement('div');
          viewport.id = 'demo-viewport';
          const card = document.createElement('div');
          card.id = 'demo-card';
          const stage = document.createElement('div');
          stage.id = 'demo-stage';
          while (document.body.firstChild) {
            stage.appendChild(document.body.firstChild);
          }
          card.appendChild(stage);

          // Caption bar lives inside #demo-card (not #demo-stage) so it
          // tracks the card's actual rendered box — which is now centered
          // and size-capped rather than edge-to-edge — without needing to
          // know the card's pixel position, and stays unscaled since it's
          // a sibling of #demo-stage rather than a descendant of it.
          const bar = document.createElement('div');
          bar.id = 'demo-caption-bar';
          card.appendChild(bar);

          viewport.appendChild(card);
          document.body.appendChild(viewport);

          const stepper = document.createElement('nav');
          stepper.id = 'demo-stepper';
          document.body.appendChild(stepper);

          // A CSS `transform` on an ancestor (which #demo-stage always has,
          // once zoom() runs) becomes the containing block for any
          // `position: fixed` descendant — per spec, not a bug in the
          // product. This app has several real fixed-position overlays
          // (the dashboard's Genie assistant drawer, .insight-popover, the
          // validation/document-preview modals) that were swept into
          // #demo-stage along with everything else during the migration
          // above, since they already existed in the static HTML. Once
          // opened, their `top/right/bottom/left` resolve against the
          // stage's transformed box instead of the real viewport, warping
          // their size/position badly.
          //
          // Fix: relocate any fixed-position element found inside #demo-stage
          // into #demo-fixed-anchor instead, AND switch its `position` from
          // `fixed` to `absolute`. #demo-fixed-anchor lives outside the
          // transform (a sibling of #demo-stage, inside #demo-card) so it's
          // never itself scaled/panned, and matches #demo-card's own full
          // box (see its CSS) — stable across every zoom state, and reads
          // as a proper flush side panel against the card's real edge
          // rather than the product's own content-column gutter (tried
          // that: <main>'s own max-width/padding put its "edge" well
          // inside the card, so the drawer looked like a floating
          // rectangle stuck mid-card instead of a docked side panel). A
          // MutationObserver keeps catching this for any fixed overlay
          // created *after* this initial sweep too.
          //
          // The anchor must NOT itself intercept clicks — it sits (in
          // paint order) on top of the scaled #demo-stage content, and
          // without pointer-events:none it would silently swallow every
          // click on the actual KPI cards/buttons underneath it (which is
          // most of the page). Each relocated overlay gets its own
          // pointer-events:auto so IT stays clickable despite the ancestor
          // opting out.
          const anchor = document.createElement('div');
          anchor.id = 'demo-fixed-anchor';
          card.appendChild(anchor);

          // Deliberately do NOT force position:absolute here anymore. Once
          // an element is out of #demo-stage (no transformed ancestor
          // above it), its native `position: fixed` already resolves
          // correctly against the TRUE viewport — which is exactly what
          // .insight-popover's own JS (positionInsightPopover() in
          // risk_command_center.js) assumes: it computes style.left/top
          // from real getBoundingClientRect()/innerWidth math. Forcing
          // position:absolute made those coordinates resolve against
          // #demo-fixed-anchor (= #demo-card's box) instead, silently
          // shifting the popover by the card's own screen offset every
          // time it opened. #ai-drawer is the one deliberate exception —
          // pin_drawer_to_card() explicitly switches IT to position:fixed
          // with hardcoded pixel geometry to dock it to the card, which is
          // a one-off stylistic choice, not a correctness requirement.
          const relocateOne = el => {
            el.style.pointerEvents = 'auto';
            anchor.appendChild(el);
          };
          const relocateFixedDescendants = () => {
            stage.querySelectorAll('*').forEach(el => {
              if (getComputedStyle(el).position === 'fixed') relocateOne(el);
            });
          };
          relocateFixedDescendants();
          new MutationObserver(mutations => {
            for (const m of mutations) {
              m.addedNodes.forEach(node => {
                if (node.nodeType !== 1) return;
                if (getComputedStyle(node).position === 'fixed') {
                  relocateOne(node);
                } else {
                  node.querySelectorAll?.('*').forEach(el => {
                    if (getComputedStyle(el).position === 'fixed') relocateOne(el);
                  });
                }
              });
            }
          }).observe(stage, { childList: true, subtree: true });

          window.__demoZoom = { tx: 0, ty: 0, scale: 1 };
          window.__demoFocusEl = null;
        }
        """
    )


def set_stepper(page: Page, title: str, labels: list[str], active_index: int) -> None:
    page.evaluate(
        """([title, labels, active]) => {
            const nav = document.getElementById('demo-stepper');
            if (!nav) return;
            const items = labels.map((label, i) => {
                const cls = i < active ? 'demo-step done' : (i === active ? 'demo-step active' : 'demo-step');
                return `<div class="${cls}">${label}</div>`;
            }).join('');
            nav.innerHTML = `<div class="demo-step-title">${title}</div>${items}`;
        }""",
        [title, labels, active_index],
    )


def say(page: Page, text: str, hold: float) -> None:
    print(f"  ▸ {text}")
    page.evaluate(
        """(text) => {
            const bar = document.getElementById('demo-caption-bar');
            bar.textContent = text;
            bar.classList.add('visible');
        }""",
        text,
    )
    time.sleep(hold)


def hide_caption(page: Page) -> None:
    page.evaluate("() => document.getElementById('demo-caption-bar')?.classList.remove('visible')")


ZOOM_TRANSITION_S = 0.7   # must match the CSS transition-duration on #demo-stage
ZOOM_SETTLE_S = ZOOM_TRANSITION_S + 0.1


FIT_PADDING = 20   # small, constant breathing room between content and card edge — not a "border"


def zoom(page: Page, selector: Optional[str], mult: float = 1.0) -> None:
    """Dynamic Viewport Scaling: pan/zoom #demo-stage so `selector` is
    centered at (fit-to-card scale × mult), or (selector=None) return to the
    centered global view at (fit-to-card scale × mult).

    The baseline is always the TRUE fit-to-card scale — computed from the
    page's actual measured natural size (window.__demoNatural) against the
    card's current box, not a guessed/hardcoded number — so the global view
    fills the card with only FIT_PADDING of margin instead of leaving large
    blank borders around a too-small rendering. `mult` is a small multiplier
    on top of that baseline: ~1.0 for the global view, ~1.2-1.6 for a subtle
    feature-focus dolly-in.

    Computed from the target's CURRENT on-screen position (inverting the
    currently-applied transform), so no visual reset/flash is needed between
    zooms. Always blocks until the CSS transition settles (ZOOM_SETTLE_S)
    before returning — the next zoom() call reads the target's live
    getBoundingClientRect() and inverts it against the LAST transform we
    set (window.__demoZoom); if that transition is still mid-flight, the
    read rect doesn't match the assumed end-state and the math produces a
    wrong transform that compounds on every subsequent call. Independent of
    --pace on purpose: it's an animation contract, not narration timing.

    Resolves `selector` via Playwright's locator engine (not a raw
    document.querySelector inside evaluate) so Playwright-only pseudo
    selectors like :has-text() work, then hands the element over as a
    JSHandle for the actual transform math."""
    target_handle = None
    if selector:
        try:
            target_handle = page.locator(selector).first.element_handle(timeout=5000)
        except PlaywrightTimeoutError:
            target_handle = None
        if target_handle is None:
            print(f"  ! zoom target not found, skipping: {selector}")
            return

    page.evaluate(
        """([el, mult, pad]) => {
            const stage = document.getElementById('demo-stage');
            const card = document.getElementById('demo-card');
            if (!stage || !card) return;
            // Measured fresh every call, not cached: scrollWidth/scrollHeight
            // are pure layout properties (transform doesn't affect them), so
            // there's no reset/flash risk in re-reading them here. A
            // one-time snapshot taken at page-load time used to go stale the
            // moment async content (e.g. the dashboard's KPI data) finished
            // loading and the page grew taller — every fit-scale/centering
            // calculation after that kept using the old, too-short height,
            // which is what made the card appear to sink/drift down.
            const nat = { width: stage.scrollWidth, height: stage.scrollHeight };
            if (!nat.width || !nat.height) return;
            const vw = card.getBoundingClientRect();
            const z = window.__demoZoom || { tx: 0, ty: 0, scale: 1 };
            const fitScale = Math.min((vw.width - pad * 2) / nat.width, (vw.height - pad * 2) / nat.height);
            const scale = fitScale * mult;

            if (window.__demoFocusEl) {
                window.__demoFocusEl.classList.remove('demo-focus-outline');
                window.__demoFocusEl = null;
            }

            let tx, ty;
            if (el) {
                const r = el.getBoundingClientRect();
                const localCenterX = (r.left + r.width / 2 - vw.left - z.tx) / z.scale;
                const localCenterY = (r.top + r.height / 2 - vw.top - z.ty) / z.scale;
                tx = vw.width / 2 - localCenterX * scale;
                ty = vw.height / 2 - localCenterY * scale;
                el.classList.add('demo-focus-outline');
                window.__demoFocusEl = el;
            } else {
                // Global view: center the whole (real-size) app inside the
                // card, snug against FIT_PADDING rather than floating in a
                // sea of white.
                tx = (vw.width - nat.width * scale) / 2;
                ty = (vw.height - nat.height * scale) / 2;
            }

            stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
            window.__demoZoom = { tx, ty, scale };
        }""",
        [target_handle, mult, FIT_PADDING],
    )
    time.sleep(ZOOM_SETTLE_S)


def wait_for_text_change(page: Page, selector: str, placeholder_substr: str) -> None:
    """Block, with NO timeout, until `selector`'s text no longer contains
    `placeholder_substr`. See wait_for_ai_reply for why this has no cap."""
    start = time.time()
    last_heartbeat = start
    while True:
        try:
            content = page.locator(selector).first.inner_text(timeout=2000)
        except PlaywrightTimeoutError:
            content = ""
        if content and placeholder_substr not in content:
            return
        now = time.time()
        if now - last_heartbeat >= 20:
            print(f"  ... 仍在等待 {selector} 更新（已等待 {int(now - start)} 秒，API 較慢屬正常現象）")
            last_heartbeat = now
        time.sleep(0.5)


def wait_for_visible(page: Page, selector: str) -> None:
    """Block, with NO timeout, until `selector` is no longer display:none.

    js/workspace.js's loadFinancialRisk() populates the whole left sidebar
    (settlement, statutory range, comparable cases, scenario, missing
    evidence, rationale, confidence, precedent) in one synchronous burst
    after its single await resolves — so once ANY one of those fields is
    written, ALL of them already are (JS doesn't yield mid-function). We
    wait on #risk-rationale-row specifically because it's set to
    display:flex on BOTH the success path and the error/fallback path,
    unlike e.g. #risk-confidence-row which can legitimately stay
    display:none if the model returns no confidence score — so it's the one
    reliable "loadFinancialRisk is done, one way or another" signal."""
    start = time.time()
    last_heartbeat = start
    while True:
        visible = page.evaluate(
            """(sel) => {
                const el = document.querySelector(sel);
                return !!el && getComputedStyle(el).display !== 'none';
            }""",
            selector,
        )
        if visible:
            return
        now = time.time()
        if now - last_heartbeat >= 20:
            print(f"  ... 仍在等待左側欄位資料（{selector}，已等待 {int(now - start)} 秒）")
            last_heartbeat = now
        time.sleep(0.5)


def wait_for_ai_reply(page: Page, container_selector: str) -> None:
    """Block, with NO timeout, until the LAST assistant message inside
    `container_selector` has actually finished streaming in.

    Covers both chat surfaces in this app: the case workspace
    (js/workspace.js's `.message-row.assistant .message-bubble`, which loses
    its `.typing-loader` child once resolved) and the dashboard's Genie
    drawer (js/risk_command_center.js's `.ai-message.assistant`, which loses
    its `.typing` class once resolved).

    Not just "has some text": js/workspace.js reveals the reply with a
    typewriter effect (~3 chars every 15ms) driven by its OWN setInterval,
    invisible from here — a naive "length > 4" check would pass within the
    first tick or two, long before the animation (and the underlying
    JSON-parsing side effects that update the sidebar) actually finish. So
    this polls until the text has stopped changing for STABLE_S — long
    enough that a still-ticking 15ms timer would have changed it again.

    Deliberately unconditional otherwise: this API is genuinely slow
    sometimes, and an earlier 90s cap meant the demo would move on to page 2
    while the bubble still read "正在連線 Gemini Data API…" — the audience
    never saw the real output, which defeats the entire point of waiting in
    the first place. Prints a heartbeat every ~20s so a long wait is visibly
    still alive rather than looking hung."""
    STABLE_S = 0.6
    start = time.time()
    last_heartbeat = start
    last_text = None
    stable_since = None
    while True:
        state = page.evaluate(
            """(sel) => {
                const container = document.querySelector(sel);
                if (!container) return {ready: false, text: null};
                const nodes = container.querySelectorAll(
                    '.message-row.assistant .message-bubble, .ai-message.assistant'
                );
                if (!nodes.length) return {ready: false, text: null};
                const last = nodes[nodes.length - 1];
                if (last.classList.contains('typing')) return {ready: false, text: null};
                if (last.querySelector('.typing-loader')) return {ready: false, text: null};
                const text = (last.textContent || '').trim();
                return {ready: text.length > 4, text};
            }""",
            container_selector,
        )
        now = time.time()
        if state["ready"]:
            if state["text"] != last_text:
                # Still changing (typewriter mid-animation) — reset the
                # stability clock instead of returning immediately.
                last_text = state["text"]
                stable_since = now
            elif now - stable_since >= STABLE_S:
                return
        else:
            last_text = None
            stable_since = None
        if now - last_heartbeat >= 20:
            print(f"  ... 仍在等待 AI 回覆（已等待 {int(now - start)} 秒，API 較慢屬正常現象）")
            last_heartbeat = now
        time.sleep(0.15)


def run_steps(page: Page, title: str, steps: list[Step], pace: float, start_delay: float = 0.0) -> None:
    labels = [s.stage_label for s in steps]
    # State1_GlobalView: opening overview fit to the card, stepper on step 1.
    set_stepper(page, title, labels, 0)
    zoom(page, None, OVERVIEW_MULT_INITIAL)
    if start_delay:
        # Gives whoever's recording the screen a moment to hit record while
        # looking at the real, settled opening state, before anything starts
        # moving on its own.
        print(f"  ... 停留 {start_delay:.0f} 秒讓錄影/觀眾就緒，之後才開始自動操作")
        time.sleep(start_delay)
    time.sleep(0.8 * pace)

    for i, step in enumerate(steps):
        set_stepper(page, title, labels, i)
        say(page, step.narration, 0.3 * pace)

        # State2_FeatureFocus: zoom in on the target component (zoom()
        # itself blocks until the transition settles).
        if step.target:
            zoom(page, step.target, step.zoom_scale)
        time.sleep(step.hold * pace)

        if step.action:
            step.action(page)
            if step.action_wait:
                time.sleep(step.action_wait * pace)

        hide_caption(page)

        # State3_GlobalView: feature explanation done, zoom back out to a full card fit.
        return_scale = step.global_scale if step.global_scale is not None else OVERVIEW_MULT_RETURN
        zoom(page, None, return_scale)
        time.sleep(0.5 * pace)

    set_stepper(page, title, labels, len(steps))


def click_c900(page: Page) -> None:
    page.click("button.tag-btn:has-text('C900')")
    page.wait_for_selector("#case-id:not(:text('-'))", timeout=10000)


def click_analyze(page: Page) -> None:
    page.click(".case-action-btn")
    print("  ... 等待 AI 分析回填（可能需要數十秒，取決於 Gemini API 延遲）")
    # The sidebar risk numbers and the chat bubble are two separate async
    # calls (loadFinancialRisk vs. askAiToAnalyzeCase's sendQuestionToApi).
    # wait_for_visible on #risk-rationale-row is the authoritative "left
    # sidebar is done" signal (see its docstring) — checked explicitly here,
    # not just inferred from #risk-settlement's text, so the next step never
    # zooms into the sidebar before it's genuinely finished loading.
    wait_for_text_change(page, "#risk-settlement", "等待 AI 試算")
    wait_for_visible(page, "#risk-rationale-row")
    # Waiting on the sidebar alone does NOT guarantee the chat reply the
    # audience actually watches has rendered yet. Wait for the real bubble
    # content too before moving on.
    wait_for_ai_reply(page, "#chat-container")


def run_part1_case_workspace(page: Page, base_url: str, pace: float, start_delay: float = 0.0) -> None:
    print("\n=== Part 1: 案件處置工作台（單案深度分析） ===")
    page.goto(f"{base_url}/pages/v2_workspace_finance.html", wait_until="load")
    ensure_stage(page)

    steps = [
        Step(
            "第一種：搜尋案件",
            "使用者可以直接搜尋既有案件編號，或用關鍵字如「投資型」「醫療險」做模糊查找。",
            target="#case-search", zoom_scale=1.5, hold=2.2,
        ),
        Step(
            "第二種：上傳案卷",
            "案件資料已經是 PDF 或 CSV，可以直接拖曳或點擊上傳，系統會自動解析建檔。",
            target=".upload-dropzone", zoom_scale=1.4, hold=2.2,
        ),
        Step(
            "第三種：手動填寫",
            "沒有現成檔案，也能手動輸入基本資料，點「建立並載入案件」直接生成一個新案件。",
            target=".manual-case-form", zoom_scale=1.3, hold=2.2,
        ),
        Step(
            "載入 C900 試用案件",
            "直接用一個真實案例情境：信用卡盜綁行動支付，目前申訴受理中、尚未進入評議程序。",
            target="button.tag-btn:has-text('C900')", zoom_scale=1.6, hold=1.2,
            action=click_c900, action_wait=1.0,
        ),
        Step(
            "啟動 AI 深度分析",
            "這一鍵會觸發 AI 針對這個案件做完整的財務與監理曝險試算，不是套用固定範本，是即時分析。",
            target=".case-action-btn", zoom_scale=1.5, hold=1.0,
            action=click_analyze,
        ),
        Step(
            "案件資訊與風險評估（左欄）",
            "建議和解金額區間、法定罰鍰級距、缺少證據清單、AI 判斷依據與信心指數，都在左欄。",
            target=".financial-risk-section", zoom_scale=1.15, hold=3.0,
        ),
        Step(
            "補充上傳案卷",
            "案件細節不完整時，可用左側拖放區，或聊天輸入框旁的迴紋針按鈕補充上傳案卷。",
            target=".attach-btn", zoom_scale=1.8, hold=2.5,
        ),
        Step(
            "AI Chat 對話（中欄）",
            "中欄是 AI 分析結論的完整對話串，剛才啟動深度分析時的追問過程都完整留在這裡。",
            target=".chat-section", zoom_scale=1.1, hold=2.5,
        ),
        Step(
            "參考資料面板（上）：相關法規",
            "右欄上半部不是關鍵字搜尋結果，是 AI 讀完案件後主動比對出的相關法規條文，形成可追溯的合規依據鏈。",
            target=".panel-section:has(#laws-content)", zoom_scale=1.6, hold=2.5,
        ),
        Step(
            "參考資料面板（下）：爭議摘要",
            "下半部則是 AI 針對這個案件主動整理的爭議要點摘要，幫使用者快速掌握案情重點。",
            target=".panel-section:has(#summary-content)", zoom_scale=1.6, hold=2.5,
        ),
    ]
    run_steps(page, "案件處置工作台", steps, pace, start_delay=start_delay)


def hover_events_card(page: Page) -> None:
    page.locator("[data-insight='events']").first.hover()


def pin_drawer_to_card(page: Page) -> None:
    """Explicitly pin #ai-drawer's pixel geometry to #demo-card's right
    edge, AND re-pin #demo-caption-bar, called AFTER the drawer's own 0.28s
    open transition has settled.

    Reproducibly, toggling body.ai-drawer-open (which sets a padding-right
    on <body>) throws off ANY CSS-relative positioning of elements under
    #demo-card by exactly that padding width — not just the drawer itself:
    #demo-fixed-anchor's own inset drifted by the same amount despite
    #demo-card's own rect never moving, and #demo-caption-bar (which uses
    the same left+right auto-width pattern) breaks exactly the same way —
    its left edge jumps far off-screen the moment the drawer opens. Root
    cause not fully pinned down (smells like a Chromium layout-cache quirk
    tied to the padding change, not to any specific CSS property we
    control). Sidestepped entirely by switching both elements to hardcoded
    pixel geometry read from #demo-card's rect AFTER the dust settles — no
    CSS-relative resolution left for the quirk to perturb."""
    page.evaluate(
        """() => {
            const card = document.getElementById('demo-card');
            const drawer = document.getElementById('ai-drawer');
            const caption = document.getElementById('demo-caption-bar');
            if (!card) return;
            const cr = card.getBoundingClientRect();

            if (drawer) {
                const w = drawer.getBoundingClientRect().width || 400;
                drawer.style.position = 'fixed';
                drawer.style.left = (cr.right - w) + 'px';
                drawer.style.right = 'auto';
                drawer.style.top = cr.top + 'px';
                drawer.style.bottom = 'auto';
                drawer.style.height = cr.height + 'px';
                drawer.style.transform = 'none';
            }

            if (caption) {
                const margin = 24;
                caption.style.position = 'fixed';
                caption.style.left = (cr.left + margin) + 'px';
                caption.style.right = 'auto';
                caption.style.width = (cr.width - margin * 2) + 'px';
                caption.style.bottom = (window.innerHeight - cr.bottom + margin) + 'px';
                caption.style.top = 'auto';
            }
        }"""
    )


def pin_and_ask_ai(page: Page) -> None:
    card = page.locator("[data-insight='events']").first
    card.click()
    time.sleep(0.6)
    ask_btn = page.locator("#insight-ask")
    if ask_btn.count() == 0:
        return
    ask_btn.click()
    print("  ... 等待 AI 針對該指標的解讀")
    time.sleep(0.35)  # let the drawer's own 0.28s open transition (and its layout side effects) settle
    pin_drawer_to_card(page)
    wait_for_ai_reply(page, "#ai-conversation")

    time.sleep(1.5)  # let the audience actually read the answer before tidying up

    # Both the drawer and the pinned popover were opened by this step —
    # close them before moving on so they don't linger into the next step
    # and sit on top of it. toggleAiDrawer/hideInsight are
    # risk_command_center.js globals; calling them directly is more robust
    # than hunting down their close-button selectors.
    print("  ... 收回 Genie 助理側邊欄，關閉釘住的 popover")
    # pin_drawer_to_card() left an INLINE `transform: none` on the drawer to
    # hold it in place while open — inline styles beat the stylesheet's
    # `transform: translateX(104%)` closed-state rule, so leaving it there
    # means toggleAiDrawer(false) removes body.ai-drawer-open but the
    # drawer has nothing left to slide away with: it silently stays stuck
    # open. Clear our overrides in the SAME script that toggles the class
    # off, so the close transition animates from the pinned-open position
    # (last painted state) straight to the stylesheet's off-screen one,
    # rather than flashing back to the raw viewport-docked position first.
    page.evaluate(
        """() => {
            const drawer = document.getElementById('ai-drawer');
            if (drawer) {
                drawer.style.position = '';
                drawer.style.left = '';
                drawer.style.right = '';
                drawer.style.top = '';
                drawer.style.bottom = '';
                drawer.style.height = '';
                drawer.style.transform = '';
            }
            if (typeof toggleAiDrawer === 'function') toggleAiDrawer(false);
        }"""
    )
    time.sleep(0.4)  # let the drawer's own 0.28s slide-out transition finish
    page.evaluate("() => { if (typeof hideInsight === 'function') hideInsight(true); }")


def run_part2_dashboard(page: Page, base_url: str, pace: float, start_delay: float = 0.0) -> None:
    print("\n=== Part 2: 交叉分析與洞察儀表板 ===")
    page.goto(f"{base_url}/pages/v2_workspace_analytical_finance.html", wait_until="load")
    ensure_stage(page)

    print("  ... 等待 Gemini Data API 載入儀表板")
    wait_for_text_change(page, "[data-insight='events'] strong", "—")

    steps = [
        Step(
            "四張 KPI 卡片",
            "新增高風險事件、潛在財務曝險、SLA 逾期風險、待完成法規缺口——每個數字背後都有明確的計算依據。",
            target="[data-insight='events']", zoom_scale=1.5, hold=1.5,
        ),
        Step(
            "Hover 查看細節",
            "每一個數字背後都可以直接懸停查看詳細解釋，不用跳頁。",
            target="[data-insight='exposure']", zoom_scale=1.5, hold=1.0,
            action=hover_events_card, action_wait=1.5,
        ),
        Step(
            "點擊釘住 + 詢問 AI",
            "點擊卡片會把 popover 釘住展開；再點「詢問 AI」，會把當前指標的上下文餵給 AI，像顧問一樣給出下一步建議。",
            target="[data-insight='events']", zoom_scale=1.6, hold=1.0,
            action=pin_and_ask_ai, action_wait=0.5,  # action itself already waits for the reply, reads it, and closes the drawer/popover
        ),
        Step(
            "重大異常訊號卡",
            "下方左側是重大異常訊號卡：案件趨勢走勢圖、影響範圍、主要缺口、判定信心，還有外部產業基準可以互相比對。",
            target=".priority-brief.signature-card", zoom_scale=1.3, hold=2.5,
        ),
        Step(
            "正式資料排行",
            "右側則是正式資料排行，依驗證過的外部來源列出排名，並明確標示不推論公司內部案件或治理狀態。",
            target=".source-ranking-panel", zoom_scale=1.3, hold=2.5,
        ),
    ]
    run_steps(page, "交叉分析與洞察儀表板", steps, pace, start_delay=start_delay)

    say(page, "整個產品只做一件事：把單案深度合規判斷與跨案件宏觀風險洞察，用同一套即時 AI 分析串起來。", 4.0 * pace)
    hide_caption(page)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default="http://127.0.0.1:8765", help="Already-running analytics_server.py URL")
    parser.add_argument("--pace", type=float, default=1.0, help="Multiplier for all pause durations")
    parser.add_argument("--headless", action="store_true", help="Run headless (no visible window)")
    parser.add_argument("--video-dir", default="demo_recordings", help="Directory to save the .webm recording")
    parser.add_argument(
        "--width", type=int, default=SCREEN_LOGICAL_WIDTH,
        help=f"Recording viewport width in CSS/logical px (default {SCREEN_LOGICAL_WIDTH}, "
             f"matched to a 1920px-wide display at 125% scaling)",
    )
    parser.add_argument(
        "--height", type=int, default=SCREEN_LOGICAL_HEIGHT,
        help=f"Recording viewport height in CSS/logical px (default {SCREEN_LOGICAL_HEIGHT}, "
             f"matched to a 1200px-tall display at 125% scaling)",
    )
    parser.add_argument("--skip-part1", action="store_true")
    parser.add_argument("--skip-part2", action="store_true")
    parser.add_argument(
        "--start-delay", type=float, default=10.0,
        help="Seconds to pause on the opening screen before any automated action starts "
             "(default 10s) — time to hit record / get the audience settled",
    )
    args = parser.parse_args()

    video_dir = Path(args.video_dir)
    video_dir.mkdir(parents=True, exist_ok=True)

    # In headed mode, also size+place the actual OS window to match, so it
    # doesn't get clipped by (or hang off) the physical screen at 125%
    # scaling. Doesn't affect the recorded video either way — Playwright
    # captures the page's own viewport via CDP, not an OS-level screen grab.
    launch_args = []
    if not args.headless:
        launch_args = [f"--window-size={args.width},{args.height}", "--window-position=0,0"]

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=args.headless, args=launch_args)
        context = browser.new_context(
            viewport={"width": args.width, "height": args.height},
            record_video_dir=str(video_dir),
            record_video_size={"width": args.width, "height": args.height},
        )
        page = context.new_page()
        try:
            # The start delay only belongs on whichever part actually runs
            # first — no point pausing twice if --skip-part1 makes part 2
            # the real opening screen.
            if not args.skip_part1:
                run_part1_case_workspace(page, args.base_url, args.pace, start_delay=args.start_delay)
                if not args.skip_part2:
                    run_part2_dashboard(page, args.base_url, args.pace)
            elif not args.skip_part2:
                run_part2_dashboard(page, args.base_url, args.pace, start_delay=args.start_delay)

            # Fixed 5s pause on the final settled view before the recording
            # ends — not pace-scaled, this is wrap-up breathing room for
            # whoever's watching/recording, not narration timing.
            print("  ... 結尾停留 5 秒")
            time.sleep(5)
        finally:
            context.close()
            browser.close()

    print(f"\nDone. Recording saved under: {video_dir.resolve()}")


if __name__ == "__main__":
    main()
