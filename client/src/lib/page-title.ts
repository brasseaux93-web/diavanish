/** Per-route document titles. The brand name comes from i18n (`aperture`). */

const ROUTES: { test: (path: string) => boolean; key: string }[] = [
  { test: (p) => p === "/" || p === "", key: "doc_home" },
  { test: (p) => p === "/admin", key: "doc_admin_signin" },
  { test: (p) => p === "/admin/console", key: "doc_console" },
  { test: (p) => p === "/facilitate", key: "doc_facilitator_signin" },
  { test: (p) => p === "/facilitate/rooms", key: "doc_rooms" },
  { test: (p) => p.startsWith("/facilitate/room/"), key: "doc_room" },
  { test: (p) => p === "/join/recover", key: "doc_recover" },
  { test: (p) => p === "/join" || p.startsWith("/join/"), key: "doc_join" },
  { test: (p) => p === "/p", key: "doc_my_room" },
  { test: (p) => p === "/verify" || p.startsWith("/verify/"), key: "doc_verify" },
  { test: (p) => p === "/organisations", key: "doc_organisations" },
  { test: (p) => p === "/auth/complete", key: "doc_auth_complete" },
];

export function titleKeyForPath(path: string): string {
  const raw = path.split("?")[0] || "/";
  return ROUTES.find((r) => r.test(raw))?.key ?? "doc_not_found";
}

export function pageTitle(path: string, t: (key: string) => string): string {
  const brand = t("aperture");
  const key = titleKeyForPath(path);
  const label = t(key);
  return label === brand ? brand : `${label} · ${brand}`;
}
