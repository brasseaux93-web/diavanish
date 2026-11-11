import { test } from "node:test";
import assert from "node:assert/strict";
import { pageTitle, titleKeyForPath } from "../client/src/lib/page-title";

const copy: Record<string, string> = {
  diavanish: "Diavanish",
  aperture: "Diavanish",
  doc_home: "Home",
  doc_admin_signin: "Administrator sign-in",
  doc_console: "Console",
  doc_facilitator_signin: "Facilitator sign-in",
  doc_rooms: "Rooms",
  doc_room: "Room",
  doc_join: "Join a room",
  doc_recover: "Recover a seat",
  doc_my_room: "My room",
  doc_verify: "Verify a ledger",
  doc_organisations: "Organisations",
  doc_auth_complete: "Finishing sign-in",
  doc_not_found: "Page not found",
};
const t = (k: string) => copy[k] ?? k;

test("every public route has its own document title", () => {
  assert.equal(pageTitle("/", t), "Home · Diavanish");
  assert.equal(pageTitle("/admin", t), "Administrator sign-in · Diavanish");
  assert.equal(pageTitle("/admin/console", t), "Console · Diavanish");
  assert.equal(pageTitle("/facilitate", t), "Facilitator sign-in · Diavanish");
  assert.equal(pageTitle("/facilitate/rooms", t), "Rooms · Diavanish");
  assert.equal(pageTitle("/facilitate/room/12", t), "Room · Diavanish");
  assert.equal(pageTitle("/join", t), "Join a room · Diavanish");
  assert.equal(pageTitle("/join/recover", t), "Recover a seat · Diavanish");
  assert.equal(pageTitle("/p", t), "My room · Diavanish");
  assert.equal(pageTitle("/verify", t), "Verify a ledger · Diavanish");
  assert.equal(pageTitle("/verify/ABCD", t), "Verify a ledger · Diavanish");
  assert.equal(pageTitle("/organisations", t), "Organisations · Diavanish");
  assert.equal(pageTitle("/auth/complete", t), "Finishing sign-in · Diavanish");
  assert.equal(pageTitle("/nope", t), "Page not found · Diavanish");
});

test("hash query strings do not change the title key", () => {
  assert.equal(titleKeyForPath("/auth/complete?ticket=abc"), "doc_auth_complete");
});
