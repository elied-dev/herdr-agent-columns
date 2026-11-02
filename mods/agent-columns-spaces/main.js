import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, theme, run, shared, openOverlay } from "herdr";

// Same avatar colors as the shipped spaces sidebar (it stores the pick in "space.colors").
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const PALETTE = Object.keys(MARK);
const avatar = (sp, i) => {
  const c = (shared("space.colors") ?? {})[sp.id] ?? PALETTE[i % PALETTE.length];
  const fill = c.startsWith("#") ? c : (MARK[c] ?? theme()[c]);
  return div().size(18).flex_none().rounded(5).bg(fill).flex().items_center().justify_center()
    .text_size(10.5).font_bold().text_color("#ffffff").child([...sp.name][0]?.toUpperCase() ?? "?");
};
// Right-click opens Herdr's own context menu (the shipped `menu` mod): rename, close, worktrees...
const menu = (tab, target) => openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab, target } });
const color = (st) => (st ? theme()[st] : theme().dim);
const dot = (st) => div().size(7).rounded(7).bg(color(st)).flex_none();
// Small clickable glyph; stops the click so the row behind it doesn't also fire.
const btn = (id, icon, fn) => div().id(id).flex_none().size(22).flex().items_center().justify_center().rounded(6)
  .text_color(theme().muted).cursor_pointer().hover((s) => s.bg(theme().hover).text_color(theme().foreground))
  .child(svg(`mods/workspace-chrome/${icon}.svg`).size(13))
  .on_click((_e, cx) => { cx.stop_propagation(); fn(); });

export default class SpacesTabs extends View {
  render() {
    const t = theme();
    return v_flex().size_full().bg(t.chrome).px(8).pb(8).gap(2).overflow_y_scrollbar()
      .child(h_flex().px(8).pb(6).items_center().text_size(11.5).text_color(t.dim)
        .child(div().flex_1().child("Spaces"))
        .child(btn("new-space", "plus", () => run("space.new", {}))))
      .children(spaces().flatMap((sp, i) => [
        h_flex().id(`sp-${sp.id}`).items_center().gap(7).px(8).py(5).rounded(6)
          .bg(sp.active ? t.selected : t.chrome).hover((s) => s.bg(t.hover)).cursor_pointer()
          .on_click(() => run("space.select", { id: sp.id }))
          .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); menu("space", { id: sp.id }); })
          .child(avatar(sp, i))
          .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(sp.name))
          .child(btn(`sp-ren-${sp.id}`, "square-pen", () => run("space.rename", { id: sp.id })))
          .child(btn(`sp-tab-${sp.id}`, "plus", () => run("tab.new", { space: sp.id }))),
        ...sp.tabs.filter((tb) => !tb.settled).map((tb) =>
          h_flex().id(`tb-${tb.id}`).items_center().gap(7).pl(24).pr(8).py(4).rounded(6)
            .bg(sp.active && tb.active ? t.selected : t.chrome).hover((s) => s.bg(t.hover)).cursor_pointer()
            .on_click(() => { run("space.select", { id: sp.id }); run("tab.select", { id: tb.id }); })
            .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); menu("tab", { id: tb.id, space: sp.id }); })
            .child(dot(tb.status))
            .child(div().flex_1().min_w(0).truncate().text_size(12)
              .text_color(sp.active && tb.active ? t.foreground : t.muted).child(tb.name))
            .child(btn(`tb-ren-${tb.id}`, "square-pen", () => run("tab.rename", { id: tb.id })))),
      ]));
  }
}
