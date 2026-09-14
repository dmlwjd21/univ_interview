"use strict";

const string = { type: "string" };
const nullableString = { type: ["string", "null"] };
const integer = { type: "integer" };
const list = (items) => ({ type: "array", items });
const object = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const grade = { type: "string", enum: ["A", "B", "C"] };
const source = object({ title: string, url: string, sourceType: grade, year: { type: ["integer", "null"] } });
const metricFields = ["capacity", "applicants", "competitionRate", "additionalAdmits", "additionalRank",
  "registeredAverage", "cut50", "cut70", "studentRecordGrade", "convertedScore", "calculationBasis"];

const schema = object({
  university: string, major: string, admissionTrack: string, searchedAt: string,
  interviewOverview: object({
    admissionYear: integer,
    status: { type: "string", enum: ["confirmed", "not_required_official", "unknown"] },
    summary: string, interviewType: nullableString, sourceUrls: list(string), notes: list(string)
  }),
  questions: list(object({
    year: integer, note: string,
    items: list(object({
      question: string, interviewType: nullableString, questionCategory: string,
      sourceType: grade, sourceName: string, sourceUrl: string
    }))
  })),
  trends: list(object({ topic: string, years: list(integer), summary: string, sourceUrls: list(string) })),
  reviews: list(object({
    year: { type: ["integer", "null"] }, atmosphere: nullableString, interviewerCount: nullableString,
    duration: nullableString, questionFeatures: nullableString, followUpFeatures: nullableString,
    preparationTips: list(string), sourceName: string, sourceUrl: string, sourceType: grade
  })),
  tips: list(object({ text: string, sourceUrls: list(string) })),
  admissionResults: object({
    year: integer, status: { type: "string", enum: ["found", "not_found"] },
    ...Object.fromEntries(metricFields.map((key) => [key, nullableString])),
    sourceName: nullableString, sourceUrl: nullableString,
    sourceType: { type: ["string", "null"], enum: ["A", "B", null] }, notes: string
  }),
  sources: list(source)
});

function assertSchema(value, spec = schema, path = "result") {
  const types = Array.isArray(spec.type) ? spec.type : [spec.type];
  const matches = types.some((type) => type === "null" ? value === null :
    type === "array" ? Array.isArray(value) : type === "integer" ? Number.isInteger(value) :
    type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value) : typeof value === type);
  if (!matches || (spec.enum && !spec.enum.includes(value))) throw new Error(`Invalid ${path}`);
  if (value === null) return;
  if (spec.type === "object") {
    for (const key of spec.required) {
      if (!Object.hasOwn(value, key)) throw new Error(`Missing ${path}.${key}`);
      assertSchema(value[key], spec.properties[key], `${path}.${key}`);
    }
    if (Object.keys(value).some((key) => !Object.hasOwn(spec.properties, key))) throw new Error(`Extra field in ${path}`);
  }
  if (spec.type === "array") value.forEach((item, i) => assertSchema(item, spec.items, `${path}[${i}]`));
}

module.exports = { schema, assertSchema, metricFields };
