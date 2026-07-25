import assert from "node:assert/strict";
import {
  edgeGroupLabel,
  edgeRelationLabel,
} from "../public/js/edge-semantics.js";

testRelationLabelsExposeMeaningInsteadOfSchemaValues();
testGroupLabelsDoNotCallEveryOutgoingChoiceABranch();
console.log("Edge semantics: all assertions passed");

function testRelationLabelsExposeMeaningInsteadOfSchemaValues() {
  assert.equal(edgeRelationLabel({ kind: "direct" }), "直接调用");
  assert.equal(
    edgeRelationLabel({ kind: "direct", flowKind: "fallback" }),
    "降级",
  );
  assert.equal(edgeRelationLabel({ kind: "spawn" }), "异步任务");
}

function testGroupLabelsDoNotCallEveryOutgoingChoiceABranch() {
  assert.equal(
    edgeGroupLabel([
      { kind: "direct", order: 1 },
      { kind: "direct", order: 2 },
    ]),
    "调用顺序",
  );
  assert.equal(
    edgeGroupLabel([
      { kind: "direct", flowKind: "branch" },
      { kind: "direct", flowKind: "fallback" },
    ]),
    "条件路径",
  );
  assert.equal(
    edgeGroupLabel([{ kind: "spawn" }, { kind: "callback" }]),
    "异步路径",
  );
  assert.equal(
    edgeGroupLabel([{ kind: "direct" }, { kind: "remote" }]),
    "下游路径",
  );
}
