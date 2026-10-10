// トピックの学習（反応の良いトピックを優先）
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickTopic, topicStats } from "../src/service/topic-bandit";

const st = (o: Record<string, [number, number]>) => new Map(Object.entries(o).map(([k, [n, mean]]) => [k, { n, mean }]));

test("順番（既定）: 実行回数の位置のトピック", () => {
  assert.equal(pickTopic(["a", "b", "c"], st({ a: [10, 0.5] }), 4), "b");
});

test("学習: 試した回数が少ないトピックを先に、その後は反応率の高いトピック", () => {
  const topics = ["a", "b", "c"];
  assert.equal(pickTopic(topics, st({ a: [5, 0.01], b: [1, 0.05] }), 0, "learn", () => 0.9), "b");
  assert.equal(pickTopic(topics, st({ a: [5, 0.01], b: [5, 0.05] }), 0, "learn", () => 0.9), "c");
  const all = st({ a: [10, 0.01], b: [10, 0.05], c: [10, 0.02] });
  assert.equal(pickTopic(topics, all, 0, "learn", () => 0.9), "b");
  // 20% は順番どおり（新しい傾向を拾う）
  assert.equal(pickTopic(topics, all, 0, "learn", () => 0.1), "a");
});

test("成績: 公開 20 時間以上・表示 30 以上の指標だけを、トピック（title）ごとに平均", () => {
  const pub = new Date("2026-10-01T00:00:00Z");
  const row = (title: string, views: number, eng: number, hours = 24) => ({ publishedAt: pub, metadata: { title }, engagement: { views, engagements: eng, fetchedAt: new Date(pub.getTime() + hours * 3600_000).toISOString() } });
  const m = topicStats([row("a", 100, 2), row("a", 100, 4), row("a", 10, 9), row("a", 100, 50, 3), row("b", 200, 2), row("z", 100, 9)], ["a", "b"]);
  assert.deepEqual(m.get("a"), { n: 2, mean: 0.03 });
  assert.deepEqual(m.get("b"), { n: 1, mean: 0.01 });
  assert.equal(m.has("z"), false);
});
