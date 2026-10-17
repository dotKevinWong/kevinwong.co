import { test } from "node:test";
import assert from "node:assert/strict";
import { describeError } from "../lib/instagram-sync.js";

test("describeError names an AggregateError whose message is empty, with its code", () => {
  // What pg throws when every address of a host refuses the connection.
  const error = Object.assign(new AggregateError([new Error("connect ECONNREFUSED 127.0.0.1:9")], ""), { code: "ECONNREFUSED" });
  assert.equal(describeError(error), "AggregateError [ECONNREFUSED]: AggregateError");
});

test("describeError includes a pg-like error's code", () => {
  const error = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), { code: "ECONNREFUSED" });
  assert.equal(describeError(error), "Error [ECONNREFUSED]: connect ECONNREFUSED 127.0.0.1:9");
});

test("describeError redacts a credential in the message", () => {
  const line = describeError(new Error("could not reach postgres://kw:npg_SECRETVALUE@db.example.test/kw"));
  assert.equal(line, "Error: could not reach postgres://[redacted]@db.example.test/kw");
});

test("describeError describes a thrown value that is not an Error", () => {
  assert.equal(describeError("boom"), "Error: boom");
});
