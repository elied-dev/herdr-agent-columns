import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, window, terminals, agents, spaces, panes, props, run, setAgentOrder, layout, shared, setShared } from "herdr";

const C = {
  get ink() { return theme().foreground; }, get muted() { return theme().muted; },
  get line() { return theme().border; }, get bg() { return theme().canvas; },
  get white() { return theme().surface; }, get violet() { return theme().accent; },
};
const STATES = [
  { key: "blocked", label: "Needs you", get color() { return theme().blocked; } },
  { key: "working", label: "Working", get color() { return theme().working; } },
  { key: "done", also: "idle", label: "Done", get color() { return theme().done; } },
  { key: "error", label: "Failed", color: "#ef4444" },
  { key: "archived", label: "Archived", get color() { return theme().dim; } },
].map((s) => Object.defineProperty(s, "wash", { get() { return s.color + "26"; } }));
// Herdr reports a failed agent as "blocked"; hc knows the real "error" state.
// Archived = its tab is settled (tab.settle): put away, still running. Herdr brings it back by itself
// when the agent needs you.
const archived = (a) => spaces().some((sp) => sp.tabs.some((t) => t.id === a.tab && t.settled));
const showArchived = () => shared("agent-columns.archived") === true;
const eff = (a) => archived(a) ? "archived" : (terminals().some((x) => x.address === a.address && (x.status === "error" || x.report?.state === "error")) ? "error" : a.status);
const inCol = (a, s) => eff(a) === s.key || eff(a) === s.also;
// View modes live in the layout itself: which of the two bands is hidden.
const node = (n, id) => (n?.id === id ? n : (n?.children ?? []).map((c) => node(c, id)).find(Boolean));
const view = () => {
  const l = layout();
  if (node(l, "cols-cards")?.hidden) return "terminal";
  if (node(l, "workspace")?.hidden) return "board";
  return "split";
};
const setView = (v) => {
  if (v === "terminal") { run("layout.show", { id: "workspace" }); run("layout.hide", { id: "cols-cards" }); return; }
  run("layout.show", { id: "cols-cards" });
  if (v === "board") { run("layout.hide", { id: "workspace" }); run("layout.resize", { id: "cols-cards", weight: 1 }); }
  else { run("layout.show", { id: "workspace" }); run("layout.resize", { id: "cols-cards", px: 355 }); }
};
const matches = (a) => {
  const q = (shared("agent-columns.filter") ?? "").trim().toLowerCase();
  return !q || [a.tab_name, a.title, a.address, a.program?.name, a.space_name].some((v) => v?.toLowerCase().includes(q));
};
const dot = (color, size = 7) => div().size(size).rounded(size).bg(color).flex_none();
const icon = (program, size = 18) => program?.icon
  ? (program.tint ? svg(program.icon).text_color(C.ink) : image(program.icon)).size(size).flex_none()
  : div().size(size).rounded(4).bg(C.violet);
const chip = (label, selected = false) => h_flex().h(27).px(11).gap(7).items_center().rounded(6)
  .bg(selected ? theme().selected : C.white).border(1).border_color(selected ? theme().accent : C.line)
  .text_size(11).text_color(selected ? C.violet : C.muted).child(label);

export default class Board extends View {
  init(_p, cx) {
    this.observed = {};
    // Every copy makes one (only the header shows it): InputState can't be created while rendering.
    this.search = InputState.new({ placeholder: "Search agents…" });
    this.search.on("change", (_e, cx) => { setShared("agent-columns.filter", this.search.value()); cx.notify(); });
    cx.timer.every(30000, (cx) => cx.notify());
  }
  card(a, state, grouped = false) {
    const old = this.observed[a.address];
    if (!old || old.status !== eff(a)) this.observed[a.address] = { status: eff(a), at: Date.now() };
    const all = terminals();
    const me = all.find((x) => x.address === a.address);
    const parent = me?.parent && agents().find((x) => x.address === me.parent);
    const kids = all.filter((x) => x.parent === a.address && x.state === "live").length;
    const mins = Math.floor((Date.now() - this.observed[a.address].at) / 60000);
    const elapsed = mins ? `${mins}m observed` : "<1m observed";
    return h_flex().id(`agent-${a.address}`).w_full().h(86).flex_none().rounded(7).overflow_hidden()
      .bg(C.white).border(1).border_color(C.line).cursor_pointer().hover(s => s.border_color(state.color))
      .on_click(() => { run("agent.focus", { terminal: a.address }); if (view() === "board") setView("split"); })
      .child(div().w(3).h_full().bg(state.color).flex_none())
      .child(v_flex().flex_1().min_w(0).px(12).py(10).gap(7)
        .child(h_flex().gap(7).items_center().text_size(10).text_color(C.muted)
          .child(icon(a.program, 15)).child(div().truncate().child(a.program.name)).child(div().flex_1())
          .when(Boolean(me?.parent) && !grouped, (el) => el.child(div().max_w(120).truncate().px(5).rounded(4).bg(theme().selected).text_color(C.violet)
            .child(`↳ sub-agent of ${parent?.tab_name ?? me.parent}`)))
          .when(kids > 0, (el) => el.child(div().flex_none().px(5).rounded(4).bg(theme().selected).text_color(C.violet)
            .child(`${kids} sub-agent${kids > 1 ? "s" : ""}`))).child(div().child(a.address)))
        .child(h_flex().items_center().gap(6)
          .child(div().flex_1().min_w(0).text_size(13).font_semibold().text_color(C.ink).truncate().child(/^\d+$/.test(a.tab_name) && a.title ? a.title : a.tab_name))
          .child(archived(a)
            ? div().id(`restore-${a.address}`).flex_none().px(5).rounded(4).text_size(10).text_color(C.muted).cursor_pointer()
                .hover((s) => s.bg(theme().hover).text_color(C.ink)).child("Restore")
                .on_click((_e, cx) => { cx.stop_propagation(); run("tab.unsettle", { id: a.tab }); })
            : div().id(`archive-${a.address}`).flex_none().size(20).flex().items_center().justify_center().rounded(4).text_color(C.muted).cursor_pointer()
                .hover((s) => s.bg(theme().hover).text_color(C.ink)).child(svg("mods/workspace-chrome/archive.svg").size(13))
                .on_click((_e, cx) => { cx.stop_propagation(); run("tab.settle", { id: a.tab }); }))
          .child(div().id(`rename-${a.address}`).flex_none().px(4).text_size(12).text_color(C.muted).cursor_pointer()
            .hover((s) => s.text_color(C.ink)).child("✎")
            .on_click((_e, cx) => { cx.stop_propagation(); run("tab.rename", { id: a.tab }); })))
        .child(h_flex().items_center().justify_between().text_size(10).text_color(C.muted)
          .child(div().truncate().child(a.space_name)).child(div().flex_none().child(elapsed))));
  }
  // A parent with sub-agents in the same column becomes one framed group: the parent
  // full width, its children indented. Anything else stays a plain card.
  groups(cards, state) {
    const parentOf = Object.fromEntries(terminals().filter((x) => x.parent).map((x) => [x.address, x.parent]));
    const here = new Set(cards.map((a) => a.address));
    const kidsOf = (addr) => cards.filter((c) => parentOf[c.address] === addr);
    const nest = (a, depth) => [
      depth ? div().w_full().pl(16).child(this.card(a, state, true)) : this.card(a, state, true),
      ...kidsOf(a.address).flatMap((k) => nest(k, depth + 1)),
    ];
    const frame = (children) => v_flex().w_full().flex_none().gap(6).p(6).rounded(10).bg(C.bg).border(1).border_color(state.color + "66").children(children);
    const seen = new Set();
    return cards.flatMap((a) => {
      const p = parentOf[a.address];
      if (p && here.has(p)) return []; // drawn inside its parent's group
      if (!p) return kidsOf(a.address).length ? [frame(nest(a, 0))] : [this.card(a, state)];
      // Sub-agent whose parent is in another column: one group per parent, headed by its name.
      if (seen.has(p)) return [];
      seen.add(p);
      const name = agents().find((x) => x.address === p)?.tab_name ?? p;
      return [frame([
        div().px(4).text_size(10).text_color(C.violet).truncate().child(`↳ ${name}`),
        ...cards.filter((c) => parentOf[c.address] === p).flatMap((k) => nest(k, 1)),
      ])];
    });
  }
  render() {
    const role = props()?.role;
    const list = agents().filter(matches);
    const active = spaces().find(s => s.active);
    if (role === "header") return v_flex().size_full().bg(C.white).pr(26).justify_center().gap(12)
        .pl(node(layout(), "sidebar")?.hidden && window()?.platform === "macos" ? 84 : 26)
      .child(h_flex().gap(7).items_center()
        .child(div().id("sidebar-hide").size(27).flex_none().flex().items_center().justify_center().rounded(6)
          .text_color(C.muted).cursor_pointer().hover((s) => s.bg(theme().hover).text_color(C.ink))
          .on_click(() => run("layout.toggle", { id: "sidebar" })).child(svg("mods/workspace-chrome/panel-left.svg").size(15)))
        .children([["board", "Board"], ["split", "Split"], ["terminal", "Terminal"]].map(([v, label]) =>
          chip(label, view() === v).id(`view-${v}`).cursor_pointer().on_click(() => setView(v))))
        .child(div().flex_1())
        .child(h_flex().w(320).h(27).flex_none().px(10).gap(7).items_center().rounded(6).bg(C.bg).border(1).border_color(C.line)
          .child(svg("mods/workspace-chrome/search.svg").size(13).text_color(C.muted).flex_none())
          .child(Input.new(this.search).flex_1().h_full().text_size(12).text_color(C.ink))
          .when(Boolean(shared("agent-columns.filter")), (el) => el.child(div().id("clear-search").flex_none().px(3).text_size(12)
            .text_color(C.muted).cursor_pointer().hover((s) => s.text_color(C.ink)).child("✕")
            .on_click(() => { this.search.set_value(""); setShared("agent-columns.filter", ""); }))))
        .child(div().flex_1()).child(dot(theme().done, 6)).child(div().text_size(10).text_color(C.muted).child("Live updates")));
    if (role === "terminals") {
      const tab = active?.tabs.find(t => t.active);
      return h_flex().size_full().px(16).items_center().gap(8).bg(C.white)
        .child(dot(C.violet)).child(div().text_size(12).font_semibold().text_color(C.ink).child("Live workspace"))
        .child(div().text_size(11).text_color(C.muted).child(`${active?.name ?? ""} / ${tab?.name ?? ""}`))
        .child(div().flex_1()).child(div().text_size(10).text_color(C.muted).child("TERMINALS"));
    }
    if (role === "pane") {
      const p = panes().find(p => p.pane === props().pane);
      return h_flex().size_full().px(13).items_center().gap(7).bg(theme().raised).border_b(1).border_color(C.line)
        .child(icon(p?.program, 14)).child(div().text_size(11).text_color(C.ink).child(p?.program?.name ?? "Terminal"))
        .child(div().flex_1()).child(dot(STATES.find(s => s.key === (p ? eff(p) : null))?.color ?? C.muted, 6));
    }
    const archive = STATES.find((s) => s.key === "archived");
    const shown = STATES.filter((s) => s === archive ? showArchived() : s.key !== "error" || list.some((a) => inCol(a, s)));
    setAgentOrder(shown.flatMap(s => list.filter(a => inCol(a, s)).map(a => a.address)));
    const archivedCount = list.filter(archived).length;
    // The archive toggle lives in the header of the board's last column.
    const toggle = () => h_flex().id("toggle-archived").h(22).px(7).gap(5).items_center().rounded(5).cursor_pointer()
      .bg(showArchived() ? theme().selected : C.bg).text_size(10).text_color(showArchived() ? C.violet : C.muted)
      .hover((s) => s.bg(theme().hover)).child(svg("mods/workspace-chrome/archive.svg").size(12))
      .child(showArchived() ? "Hide archived" : `Archived (${archivedCount})`)
      .on_click(() => setShared("agent-columns.archived", !showArchived()));
    return h_flex().size_full().px(24).py(17).gap(16).bg(C.bg).children(shown.map((state, i) => {
      const cards = list.filter(a => inCol(a, state));
      return v_flex().flex_1().min_w(0).h_full().gap(9)
        .child(h_flex().h(27).flex_none().items_center().gap(8).px(3)
          .child(dot(state.color, 8)).child(div().text_size(13).font_semibold().text_color(C.ink).child(state.label))
          .child(div().px(6).py(2).rounded(4).bg(state.wash).text_size(10).text_color(state.color).child(String(cards.length)))
          .when(i === shown.length - 1, (el) => el.child(div().flex_1()).child(toggle())))
        .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().gap(9).children(this.groups(cards, state)));
    }));
  }
}
