// Usage dialog, modeled on T3 Code's Usage page: subscription limits per provider, then token totals,
// a daily chart and a per-agent/model breakdown from local transcripts. Data comes from ./usage.py.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, exec, appHome, props, closeOverlay } from "herdr";

const PERIODS = [[1, "Past 24h"], [7, "7 days"], [30, "30 days"], [90, "90 days"]];
const AGENTS = { pi: ["Pi", "#4d9f8a"], claude: ["Claude Code", "#d97757"], codex: ["Codex", null] };
const LIMIT_COLORS = { claude: "#d97757", codex: null, copilot: "#8957e5" };
const ICON = (name) => `mods/agent-columns-usage/${name}.svg`;

const fmtTokens = (v) => v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : `${v}`;
// The mod runtime ignores toLocaleString options, so group digits by hand.
const fmtInt = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const fmtCost = (v) => v > 0 ? `$${fmtInt(Math.floor(v))}.${v.toFixed(2).slice(-2)}` : "—";

// T3 Code's formatDuration / pace: the tick is where even spending would be; ±5% is "on pace".
function duration(ms) {
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function resetsIn(w, now) {
  if (!w.resetsAt) return null;
  const ms = w.resetsAt * 1000 - now;
  return ms <= 0 ? "resets now" : `resets in ${duration(ms)}`;
}
function elapsedShare(w, now) {
  if (!w.resetsAt || !w.windowMins) return null;
  const len = w.windowMins * 6e4;
  return Math.max(0, Math.min(1, 1 - (w.resetsAt * 1000 - now) / len));
}
function pace(w, now) {
  const e = elapsedShare(w, now);
  if (e === null) return null;
  const gap = w.usedPercent - e * 100;
  return gap > 5 ? "ahead of pace" : gap < -5 ? "under pace" : "on pace";
}

function sum(list) {
  const s = { input: 0, cached: 0, cacheWrite: 0, output: 0, cost: 0, requests: 0 };
  for (const m of list) for (const k in s) s[k] += m[k];
  s.tokens = s.input + s.cached + s.cacheWrite + s.output;
  return s;
}

export default class Usage extends View {
  init(_props, cx) {
    this.days = 7;
    this.data = null;
    this.error = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.load(cx);
  }

  load(cx) {
    this.loading = true;
    const days = this.days;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", [`${appHome()}/mods/agent-columns-usage/usage.py`, String(days)]);
        if (days !== this.days) return; // a newer period was picked meanwhile
        if (r.code !== 0) throw new Error(r.stderr.trim() || `usage.py exited ${r.code}`);
        this.data = JSON.parse(r.stdout);
        this.error = null;
      } catch (e) {
        this.error = String(e.message ?? e);
      }
      this.loading = false;
      cx.notify();
    });
  }

  close() { closeOverlay(props().overlay); }

  section(title, ...children) {
    const t = theme();
    return v_flex().gap(8).child(div().text_size(13).font_medium().text_color(t.foreground).child(title)).children(children);
  }

  header() {
    const t = theme();
    const chip = (days, label) => div().id(`period-${days}`).h(26).px(10).flex().items_center().rounded(6).cursor_pointer()
      .text_color(this.days === days ? t.foreground : t.muted).when(this.days === days, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover)).child(label)
      .on_click((_e, cx) => { if (this.days !== days) { this.days = days; this.load(cx); cx.notify(); } });
    const icon = (id, name, action) => div().id(id).size(26).flex().items_center().justify_center().rounded(6).cursor_pointer()
      .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(action).child(svg(ICON(name)).size(14));
    return h_flex().h(30).items_center().gap(10)
      .child(div().text_size(16).font_semibold().text_color(t.foreground).child("Usage"))
      .child(div().flex_1())
      .child(h_flex().gap(2).p(2).rounded(8).border_1().border_color(t.border).children(PERIODS.map(([d, l]) => chip(d, l))))
      .child(icon("refresh", "refresh", (_e, cx) => { this.load(cx); cx.notify(); }).when(this.loading, (el) => el.opacity(0.4)))
      .child(icon("close", "x", () => this.close()));
  }

  limitRow(w, color, now) {
    const t = theme();
    const reset = resetsIn(w, now);
    if (w.unlimited) {
      return h_flex().h(24).gap(10).items_center()
        .child(div().w(150).text_color(t.muted).child(w.label))
        .child(div().flex_1().text_color(t.foreground).child(["Unlimited", w.note].filter(Boolean).join(" · ")))
        .child(div().text_color(t.dim).child(reset ?? ""));
    }
    const left = Math.round(100 - w.usedPercent);
    const e = elapsedShare(w, now);
    const p = pace(w, now);
    return h_flex().h(24).gap(10).items_center()
      .child(div().w(150).text_color(t.muted).truncate().child(w.label))
      .child(div().flex_1().h(8).relative()
        .child(div().absolute().inset_0().rounded_full().bg(t.raised))
        .when(left > 0, (el) => el.child(div().absolute().top(0).bottom(0).left(0).w(`${left}%`).rounded_full().bg(color)))
        .when(e !== null, (el) => el.child(div().absolute().top(-3).bottom(-3).w(2).rounded_full().bg(t.foreground)
          .left(`${Math.min(99, Math.max(0, (1 - e) * 100))}%`).tooltip("Where even spending would be"))))
      .child(div().w(210).text_color(t.dim).truncate()
        .child([`${left}% left`, w.note, p, reset].filter(Boolean).join(" · ")));
  }

  limits(now) {
    const t = theme();
    const accounts = this.data?.limits ?? [];
    if (!accounts.length) return div().text_color(t.dim).child(this.data ? "No signed-in Claude, Codex or GitHub Copilot subscription found." : "Loading…");
    return v_flex().gap(10).children(accounts.map((a) => {
      const color = LIMIT_COLORS[a.provider] ?? t.foreground;
      return v_flex().p(12).gap(4).rounded(8).border_1().border_color(t.border).bg(t.surface)
        .child(h_flex().gap(8).items_center().pb(2)
          .child(div().size(8).rounded_full().bg(color))
          .child(div().font_semibold().text_color(t.foreground).child(a.label))
          .when(Boolean(a.plan), (el) => el.child(div().text_color(t.dim).child(a.plan))))
        .when(Boolean(a.error), (el) => el.child(div().text_color(t.blocked).child(`Couldn't read limits: ${a.error}`)))
        .children(a.windows.map((w) => this.limitRow(w, color, now)));
    }));
  }

  totals(agents) {
    const t = theme();
    const all = sum(Object.values(agents).flatMap((a) => Object.values(a.models)));
    const metric = (label, value) => v_flex().flex_1().p(10).gap(2).rounded(8).border_1().border_color(t.border).bg(t.surface)
      .child(div().text_size(11.5).text_color(t.dim).child(label))
      .child(div().text_size(17).font_semibold().text_color(t.foreground).child(value));
    return h_flex().gap(8)
      .child(metric("Processed tokens", fmtTokens(all.tokens)))
      .child(metric("Cached input", fmtTokens(all.cached)))
      .child(metric("Uncached input", fmtTokens(all.input + all.cacheWrite)))
      .child(metric("Output", fmtTokens(all.output)))
      .child(metric("Cost (reported)", fmtCost(all.cost)));
  }

  chart(agents) {
    const t = theme();
    const dayKeys = [];
    for (let i = this.days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5);
      dayKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
    const names = Object.keys(agents);
    const totalOf = (day) => names.reduce((s, n) => s + (agents[n].days[day] ?? 0), 0);
    const max = Math.max(1, ...dayKeys.map(totalOf));
    const H = 110;
    return v_flex().gap(4)
      .child(h_flex().h(H).items_end().gap(this.days > 30 ? 1 : 3).children(dayKeys.map((day) => {
        const total = totalOf(day);
        return v_flex().id(`day-${day}`).flex_1().h(H).justify_end().tooltip(`${day} · ${fmtTokens(total)} tokens`)
          .children(names.filter((n) => agents[n].days[day]).map((n) =>
            div().h(Math.max(1, (agents[n].days[day] / max) * H)).bg(AGENTS[n]?.[1] ?? t.foreground).rounded(2)));
      })))
      .child(h_flex().justify_between().text_size(11).text_color(t.dim).child(dayKeys[0]).child(dayKeys.at(-1)));
  }

  breakdown(agents) {
    const t = theme();
    const rows = Object.entries(agents).map(([name, a]) => [name, a, sum(Object.values(a.models))]).sort((x, y) => y[2].tokens - x[2].tokens);
    const grand = rows.reduce((s, r) => s + r[2].tokens, 0) || 1;
    const line = (id, label, s, color, strong) => h_flex().id(id).h(26).gap(10).items_center().px(8).rounded(6).hover((st) => st.bg(t.hover))
      .child(div().w(230).truncate().text_color(strong ? t.foreground : t.muted).when(strong, (el) => el.font_semibold()).child(label))
      .child(div().flex_1().h(6).relative().child(div().absolute().inset_0().rounded_full().bg(t.raised))
        .child(div().absolute().top(0).bottom(0).left(0).rounded_full().bg(color).w(`${Math.max(0.5, (s.tokens / grand) * 100)}%`)))
      .child(div().w(70).text_color(t.foreground).child(fmtTokens(s.tokens)))
      .child(div().w(80).text_color(t.muted).child(fmtCost(s.cost)))
      .child(div().w(80).text_color(t.dim).child(`${fmtInt(s.requests)} req`));
    return v_flex().gap(2).children(rows.flatMap(([name, a, s]) => {
      const [label, c] = AGENTS[name] ?? [name, null];
      const color = c ?? t.foreground;
      const models = Object.entries(a.models).map(([m, b]) => [m, sum([b])]).sort((x, y) => y[1].tokens - x[1].tokens);
      return [line(`agent-${name}`, label, s, color, true), ...models.map(([m, ms]) => line(`model-${name}-${m}`, `   ${m}`, ms, color, false))];
    }));
  }

  render() {
    const t = theme();
    const now = Date.now();
    const agents = this.data?.agents ?? {};
    const hasUsage = Object.keys(agents).length > 0;
    return v_flex().id("usage").track_focus(this.handle)
      .on_key_down((e) => { if (e.key === "escape") this.close(); })
      .size_full().min_h(0).p(18).gap(16).bg(t.popover).text_size(12.5)
      .child(this.header())
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().gap(18)
        .child(this.section("Limits", this.limits(now)))
        .child(this.section("Totals", this.data ? this.totals(agents) : div().text_color(t.dim).child("Loading…")))
        .when(hasUsage && this.days > 1, (el) => el.child(this.section("Daily tokens", this.chart(agents))))
        .when(hasUsage, (el) => el.child(this.section("Breakdown", this.breakdown(agents))))
        .when(Boolean(this.data) && !hasUsage, (el) => el.child(div().text_color(t.dim).child("No Pi, Claude Code or Codex usage in this period."))));
  }
}
