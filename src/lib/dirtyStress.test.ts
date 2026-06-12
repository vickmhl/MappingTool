import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AnyCandidatePayload, CandidateKind, CandidateRecord, ImportResult, SourceDocument } from '../types';
import { importSourceFile } from './importer';
import { buildReviewQueueBuckets, buildReviewSourceAlerts } from './reviewQueue';

const fixtureDir = path.resolve(process.cwd(), 'src/fixtures/dirty-stress-100p');
const reportDir = path.resolve(process.cwd(), 'outputs/dirty-stress-100p');

interface ExpectedPerson {
  name: string;
  company: string;
  department: string;
  title: string;
  manager: string;
  level: string;
}

interface ExpectedFixture {
  company: string;
  people: ExpectedPerson[];
  relationships: Array<{ subordinateName: string; managerName: string }>;
}

function textFile(name: string, text: string): File {
  const bytes = new TextEncoder().encode(text);
  return {
    name,
    type: name.endsWith('.md') ? 'text/markdown' : 'text/plain',
    arrayBuffer: async () => bytes.slice().buffer,
    text: async () => text,
  } as File;
}

async function binaryFile(name: string, type: string): Promise<File> {
  const buffer = await readFile(path.join(fixtureDir, name));
  const bytes = new Uint8Array(buffer);
  return {
    name,
    type,
    arrayBuffer: async () => bytes.slice().buffer,
    text: async () => new TextDecoder().decode(bytes),
  } as File;
}

function payloadValues(candidate: CandidateRecord<AnyCandidatePayload>): string[] {
  const payload = candidate.payload as unknown as Record<string, unknown>;
  return ['name', 'personName', 'managerName', 'subordinateName']
    .map((key) => payload[key])
    .filter((value): value is string => typeof value === 'string');
}

function collectRecognizedNames(results: ImportResult[]): string[] {
  const names = new Set<string>();
  for (const result of results) {
    for (const candidate of result.candidates) {
      for (const value of payloadValues(candidate)) {
        if (/^[\u4e00-\u9fa5]{2,4}\d?$/.test(value)) {
          names.add(value);
        }
      }
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function countByKind(candidates: CandidateRecord<AnyCandidatePayload>[]): Record<CandidateKind, number> {
  return candidates.reduce(
    (acc, candidate) => {
      acc[candidate.kind] += 1;
      return acc;
    },
    {
      person: 0,
      orgUnit: 0,
      roleAssignment: 0,
      reportingLine: 0,
      changeEvent: 0,
    } satisfies Record<CandidateKind, number>,
  );
}

function countWarnings(results: ImportResult[]): Array<{ fileName: string; warnings: string[] }> {
  return results.map((result) => ({
    fileName: result.source.fileName,
    warnings: result.warnings,
  }));
}

function markdownReport(report: Record<string, unknown>): string {
  const metrics = report.metrics as Record<string, unknown>;
  const queues = report.reviewQueues as Array<{ key: string; label: string; count: number }>;
  const warnings = report.sourceWarnings as Array<{ fileName: string; warnings: string[] }>;
  const missed = report.missedExpectedNames as string[];
  const falsePositive = report.falsePositiveNameSamples as string[];

  return [
    '# 脏数据压力测试报告',
    '',
    `- 预期人员：${metrics.expectedPeople}`,
    `- 命中人员：${metrics.recognizedExpected}`,
    `- 人员召回率：${metrics.nameRecallRate}`,
    `- 候选总数：${metrics.totalCandidates}`,
    `- 证据片段：${metrics.totalEvidence}`,
    `- 来源文件：${metrics.totalSources}`,
    '',
    '## 确认队列',
    ...queues.map((queue) => `- ${queue.label}：${queue.count}`),
    '',
    '## 候选类型',
    ...Object.entries(report.candidateKindCounts as Record<string, number>).map(([kind, count]) => `- ${kind}：${count}`),
    '',
    '## 来源提醒',
    ...warnings.flatMap((item) => (item.warnings.length ? [`- ${item.fileName}`, ...item.warnings.map((warning) => `  - ${warning}`)] : [])),
    '',
    '## 漏识别样例',
    missed.slice(0, 30).join('、') || '无',
    '',
    '## 疑似假阳性姓名样例',
    falsePositive.slice(0, 30).join('、') || '无',
    '',
  ].join('\n');
}

describe('dirty 100-person upload and review stress test', () => {
  it('imports noisy same-company files and produces confirmation queues', async () => {
    const expected = JSON.parse(await readFile(path.join(fixtureDir, 'expected.json'), 'utf8')) as ExpectedFixture;
    const files = [
      textFile(
        'cloudmap-complex-transcript-100p.txt',
        await readFile(path.join(fixtureDir, 'cloudmap-complex-transcript-100p.txt'), 'utf8'),
      ),
      textFile(
        'cloudmap-hr-meeting-minutes.md',
        await readFile(path.join(fixtureDir, 'cloudmap-hr-meeting-minutes.md'), 'utf8'),
      ),
      textFile(
        'cloudmap-candidate-mapping-verbatims.txt',
        await readFile(path.join(fixtureDir, 'cloudmap-candidate-mapping-verbatims.txt'), 'utf8'),
      ),
      await binaryFile('cloudmap-org-ppt-with-embedded-image.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
      await binaryFile('cloudmap-screenshot-org.png', 'image/png'),
      await binaryFile('cloudmap-screenshot-notes.png', 'image/png'),
    ];

    const results: ImportResult[] = [];
    for (const file of files) {
      results.push(await importSourceFile(file, { enableOcr: false }));
    }

    const allCandidates = results.flatMap((result) => result.candidates);
    const allSources = results.map((result) => result.source);
    const allEvidence = results.flatMap((result) => result.evidence);
    const expectedNames = expected.people.map((person) => person.name);
    const expectedNameSet = new Set(expectedNames);
    const recognizedNames = collectRecognizedNames(results);
    const recognizedExpected = expectedNames.filter((name) => recognizedNames.includes(name));
    const missedExpectedNames = expectedNames.filter((name) => !recognizedNames.includes(name));
    const falsePositiveNameSamples = recognizedNames.filter((name) => !expectedNameSet.has(name));
    const reviewQueues = buildReviewQueueBuckets(allCandidates, allSources, [], []);
    const sourceAlerts = buildReviewSourceAlerts(allSources);

    const report = {
      generatedAt: new Date().toISOString(),
      metrics: {
        totalSources: allSources.length,
        totalEvidence: allEvidence.length,
        totalCandidates: allCandidates.length,
        expectedPeople: expected.people.length,
        recognizedExpected: recognizedExpected.length,
        missedExpected: missedExpectedNames.length,
        falsePositiveNames: falsePositiveNameSamples.length,
        nameRecallRate: `${Math.round((recognizedExpected.length / expected.people.length) * 1000) / 10}%`,
      },
      candidateKindCounts: countByKind(allCandidates),
      reviewQueues: reviewQueues.map((queue) => ({
        key: queue.key,
        label: queue.label,
        count: queue.count,
      })),
      sourceAlerts,
      sourceWarnings: countWarnings(results),
      missedExpectedNames,
      falsePositiveNameSamples,
      sampleCandidates: allCandidates.slice(0, 20).map((candidate) => ({
        kind: candidate.kind,
        confidence: candidate.confidence,
        payload: candidate.payload,
        sourceName: candidate.sourceName,
      })),
    };

    await mkdir(reportDir, { recursive: true });
    await writeFile(path.join(reportDir, 'stress-report.json'), JSON.stringify(report, null, 2), 'utf8');
    await writeFile(path.join(reportDir, 'stress-report.md'), markdownReport(report), 'utf8');

    expect(results).toHaveLength(6);
    expect(allCandidates.length).toBeGreaterThan(150);
    expect(recognizedExpected.length).toBeGreaterThanOrEqual(90);
    expect(falsePositiveNameSamples.length).toBeLessThanOrEqual(10);
    expect(results.find((result) => result.source.fileName.endsWith('.pptx'))?.warnings.some((warning) => warning.includes('图片'))).toBe(true);
    expect(sourceAlerts.filter((alert) => alert.severity === 'manual').length).toBeGreaterThanOrEqual(2);
    expect(reviewQueues.find((queue) => queue.key === 'review')?.count ?? 0).toBeGreaterThan(0);
    expect(reviewQueues.find((queue) => queue.key === 'manual')?.count ?? 0).toBeGreaterThanOrEqual(2);
  });
});
