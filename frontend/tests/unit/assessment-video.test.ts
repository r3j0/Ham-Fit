import assert from "node:assert/strict";
import { test } from "node:test";
import { assessmentVideoEmbed } from "../../lib/assessment-video.ts";
import { adultAssessment } from "../../lib/assessment.ts";
test("each assessment step embeds its configured YouTube video", () => {
  for (const step of adultAssessment().steps)
    assert.match(
      assessmentVideoEmbed(step.videoUrl)!,
      /^https:\/\/www.youtube-nocookie.com\/embed\/[\w-]{11}$/,
    );
  assert.equal(
    assessmentVideoEmbed("https://youtu.be/j5sktGOVq1c"),
    "https://www.youtube-nocookie.com/embed/j5sktGOVq1c",
  );
  for (const url of [
    "bad",
    "https://attacker.test/?v=j5sktGOVq1c",
    "https://youtube.com/?v=bad",
  ])
    assert.equal(assessmentVideoEmbed(url), null);
});
