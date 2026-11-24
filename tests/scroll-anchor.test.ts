import test from "node:test";
import assert from "node:assert/strict";
import { computeAnchorDelta, type ScrollAnchorSnapshot } from "../src/lib/scroll-anchor";

test("new emails prepended above viewport produce positive delta equal to inserted height", () => {
  const snapshot: ScrollAnchorSnapshot = {
    candidates: [
      { id: "msg-10", offsetTop: 12 },
      { id: "msg-11", offsetTop: 112 },
    ],
  };

  // Two 100px emails inserted above -> msg-10 shifted down by 200px
  const newOffsets = new Map<string, number>([
    ["msg-10", 212],
    ["msg-11", 312],
  ]);

  assert.equal(computeAnchorDelta(snapshot, newOffsets), 200);
});

test("emails deleted above viewport produce negative delta equal to removed height", () => {
  const snapshot: ScrollAnchorSnapshot = {
    candidates: [
      { id: "msg-10", offsetTop: 24 },
      { id: "msg-11", offsetTop: 124 },
    ],
  };

  // One 100px email deleted above -> msg-10 shifted up by 100px
  const newOffsets = new Map<string, number>([
    ["msg-10", -76],
    ["msg-11", 24],
  ]);

  assert.equal(computeAnchorDelta(snapshot, newOffsets), -100);
});

test("topmost visible email deleted with nothing changed above yields 0 delta", () => {
  const snapshot: ScrollAnchorSnapshot = {
    candidates: [
      { id: "msg-10", offsetTop: 0 },
      { id: "msg-11", offsetTop: 100 },
    ],
  };

  // msg-10 was deleted; msg-11 naturally moved into offsetTop 0
  const newOffsets = new Map<string, number>([["msg-11", 0]]);

  assert.equal(computeAnchorDelta(snapshot, newOffsets), 0);
});

test("batch delete spanning above and inside viewport compensates for height removed above", () => {
  const snapshot: ScrollAnchorSnapshot = {
    candidates: [
      { id: "msg-10", offsetTop: 15 },
      { id: "msg-11", offsetTop: 115 },
      { id: "msg-12", offsetTop: 215 },
    ],
  };

  // msg-8, msg-9 (200px total above) and msg-10 were deleted.
  // msg-11 naturally landed at 15 - 200 = -185, and should align to 15 -> delta = -200.
  const newOffsets = new Map<string, number>([
    ["msg-11", -185],
    ["msg-12", -85],
  ]);

  assert.equal(computeAnchorDelta(snapshot, newOffsets), -200);
});

test("partially scrolled-off topmost visible item deleted aligns next surviving item to 0", () => {
  const snapshot: ScrollAnchorSnapshot = {
    candidates: [
      { id: "msg-10", offsetTop: -40 },
      { id: "msg-11", offsetTop: 60 },
    ],
  };

  // msg-10 deleted; msg-11 naturally landed at -40, target is max(0, -40) = 0 -> delta = -40
  const newOffsets = new Map<string, number>([["msg-11", -40]]);

  assert.equal(computeAnchorDelta(snapshot, newOffsets), -40);
});

test("sub-pixel jitter (< 0.5px) returns 0", () => {
  const snapshot: ScrollAnchorSnapshot = {
    candidates: [{ id: "msg-10", offsetTop: 10 }],
  };

  const newOffsets = new Map<string, number>([["msg-10", 10.4]]);

  assert.equal(computeAnchorDelta(snapshot, newOffsets), 0);
});

test("all candidate items gone returns null", () => {
  const snapshot: ScrollAnchorSnapshot = {
    candidates: [
      { id: "msg-10", offsetTop: 10 },
      { id: "msg-11", offsetTop: 110 },
    ],
  };

  const newOffsets = new Map<string, number>([["msg-99", 0]]);

  assert.equal(computeAnchorDelta(snapshot, newOffsets), null);
});
