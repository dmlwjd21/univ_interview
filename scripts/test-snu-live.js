"use strict";
// Paid, opt-in end-to-end check. Run only with OPENAI_API_KEY set on a server.
const { researchStage } = require("../lib/staged-research");
const { resolveSearch } = require("../lib/resolve-search");

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for the live smoke test");
  const original = { schoolType: "4년제", university: "서울대", major: "컴공", admissionTrack: "학종" };
  const start = Date.now();
  const resolution = await resolveSearch("resolve", original);
  const candidate = resolution.candidates.tracks.find((item) => item.name === "일반전형") || resolution.candidates.tracks[0];
  const input = { ...resolution.resolved, admissionTrack: resolution.resolved.admissionTrack || candidate?.name, aliases: resolution.aliases };
  if (!["schoolType", "university", "major", "admissionTrack"].every((key) => input[key])) throw new Error("Official names could not be resolved; inspect candidates before research");
  const overview = await researchStage("overview", input);
  const questions = await researchStage("questions", input);
  const official = [...overview.sources, ...questions.sources].filter((source) => source.sourceType === "A" && new URL(source.url).hostname.endsWith("snu.ac.kr"));
  const titles = official.map((source) => source.title).join(" ");
  const checks = {
    officialAdmissions: Boolean(overview.officialDomain?.endsWith("snu.ac.kr")),
    latestGuide: Boolean(overview.guide.url) || /수시모집 안내|모집요강/.test(titles),
    interviewGuidance: Boolean(overview.interviewOverview.sourceUrls.length) || /면접.*안내|구술고사/.test(titles),
    pastQuestions: /면접.*구술고사.*문항|기출/.test(titles),
    admissionResults: Boolean(overview.admissionResults.sourceUrl) || /전형결과|선발현황/.test(titles)
  };
  console.log(JSON.stringify({ original, resolution: { resolved: resolution.resolved, candidates: resolution.candidates, confidence: resolution.confidence }, searchedAs: input, elapsedSeconds: Math.round((Date.now() - start) / 1000), checks, officialSources: official.map(({ title, url }) => ({ title, url })) }, null, 2));
  if (Object.values(checks).some((found) => !found)) process.exitCode = 1;
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
