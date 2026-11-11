import { test } from "node:test";
import assert from "node:assert/strict";
import { LEGAL_IDS, isLegalId, legalFromSearch } from "../client/src/lib/legal";

test("legal ids cover the five footer dialogs", () => {
  assert.deepEqual([...LEGAL_IDS], ["privacy", "terms", "security", "accessibility", "opensource"]);
});

test("isLegalId accepts only known ids", () => {
  assert.equal(isLegalId("privacy"), true);
  assert.equal(isLegalId("terms"), true);
  assert.equal(isLegalId("nope"), false);
  assert.equal(isLegalId(null), false);
  assert.equal(isLegalId(""), false);
});

test("legalFromSearch reads ?legal= from a search string", () => {
  assert.equal(legalFromSearch("?legal=privacy"), "privacy");
  assert.equal(legalFromSearch("legal=security&x=1"), "security");
  assert.equal(legalFromSearch("?legal=nope"), null);
  assert.equal(legalFromSearch(""), null);
});
