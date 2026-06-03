import { describe, expect, it } from 'vitest';
import type { AnyCandidatePayload, CandidateRecord, ReportingLine, RoleAssignment, SourceDocument } from '../types';
import { buildReviewQueueBuckets, buildReviewSourceAlerts } from './reviewQueue';

function source(overrides: Partial<SourceDocument> = {}): SourceDocument {
  return {
    id: 'src_1',
    fileName: 'call.txt',
    type: 'text',
    importedAt: '2026-06-03T00:00:00.000Z',
    hash: 'hash',
    textPreview: '',
    totalChunks: 1,
    warnings: [],
    ...overrides,
  };
}

function candidate(overrides: Partial<CandidateRecord<AnyCandidatePayload>> = {}): CandidateRecord<AnyCandidatePayload> {
  return {
    id: 'cand_1',
    kind: 'roleAssignment',
    status: 'pending',
    confidence: 0.91,
    payload: {
      personName: '张三',
      title: '地图平台负责人',
      orgUnitName: '地图平台事业群',
      company: '云图地图科技',
    },
    evidenceId: 'ev_1',
    evidenceText: '张三目前担任地图平台负责人',
    sourceName: 'call.txt',
    createdAt: '2026-06-03T00:00:00.000Z',
    reason: 'rule',
    ...overrides,
  } as CandidateRecord<AnyCandidatePayload>;
}

describe('reviewQueue', () => {
  it('puts a high-confidence clean candidate into the priority queue', () => {
    const buckets = buildReviewQueueBuckets([candidate()], [source()], [], []);
    const priority = buckets.find((bucket) => bucket.key === 'priority');
    const review = buckets.find((bucket) => bucket.key === 'review');

    expect(priority?.candidateIds).toEqual(['cand_1']);
    expect(review?.candidateIds).toEqual([]);
  });

  it('puts conflicting reporting lines into the review queue', () => {
    const reportingCandidate = candidate({
      id: 'cand_line',
      kind: 'reportingLine',
      confidence: 0.88,
      payload: {
        subordinateName: '李四',
        managerName: '王总',
        relationType: 'reports-to',
      },
      evidenceText: '李四汇报给王总',
    });

    const existingLines: ReportingLine[] = [
      {
        id: 'line_1',
        subordinateName: '李四',
        managerName: '赵总',
        relationType: 'reports-to',
        confidence: 0.9,
        evidenceIds: ['ev_existing'],
        isCurrent: true,
        updatedAt: '2026-06-03T00:00:00.000Z',
      },
    ];

    const buckets = buildReviewQueueBuckets([reportingCandidate], [source()], [], existingLines);
    const review = buckets.find((bucket) => bucket.key === 'review');

    expect(review?.candidateIds).toEqual(['cand_line']);
  });

  it('puts OCR or manual-follow-up sources into the manual queue', () => {
    const manualCandidate = candidate({
      id: 'cand_ocr',
      sourceName: 'diagram.png',
      evidenceText: '图片 OCR：王五在导航与路线规划部做专家',
    });

    const buckets = buildReviewQueueBuckets(
      [manualCandidate],
      [
        source({
          fileName: 'diagram.png',
          type: 'ocr',
          warnings: ['图片资料需要开启本地 OCR；如识别不准，请在组织图页手动补充人员和汇报线。'],
        }),
      ],
      [],
      [],
    );
    const manual = buckets.find((bucket) => bucket.key === 'manual');

    expect(manual?.candidateIds).toEqual(['cand_ocr']);
    expect(manual?.sourceIds).toEqual([]);
  });

  it('creates manual queue tasks for screenshot sources even when no candidate was extracted', () => {
    const buckets = buildReviewQueueBuckets(
      [],
      [
        source({
          id: 'src_image',
          fileName: 'org-chart.png',
          type: 'ocr',
          warnings: ['没有解析到可抽取文本，请确认文件内容或使用手工补录。'],
        }),
      ],
      [],
      [],
    );
    const manual = buckets.find((bucket) => bucket.key === 'manual');

    expect(manual?.count).toBe(1);
    expect(manual?.candidateIds).toEqual([]);
    expect(manual?.sourceIds).toEqual(['src_image']);
  });

  it('builds source alerts for mixed ppt image pages and fully manual sources', () => {
    const alerts = buildReviewSourceAlerts([
      source({
        id: 'src_ppt',
        fileName: 'mapping.pptx',
        type: 'pptx',
        warnings: ['发现 3 张图片；如组织图是截图，请开启本地 OCR 后重新导入，OCR 结果会进入人工确认。'],
      }),
      source({
        id: 'src_img',
        fileName: 'org.png',
        type: 'ocr',
        warnings: ['没有解析到可抽取文本，请确认文件内容或使用手工补录。'],
      }),
    ]);

    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatchObject({
      severity: 'warning',
      title: '图片页待复核',
    });
    expect(alerts[1]).toMatchObject({
      severity: 'manual',
      title: '截图或图片资料待补录',
    });
  });

  it('marks competing current roles for the same person as review', () => {
    const currentRoles: RoleAssignment[] = [
      {
        id: 'role_1',
        personName: '张三',
        title: '搜索产品总监',
        orgUnitName: '搜索产品部',
        company: '云图地图科技',
        status: 'current',
        evidenceIds: ['ev_old'],
        updatedAt: '2026-06-03T00:00:00.000Z',
      },
    ];

    const pendingRole = candidate({
      id: 'cand_role',
      payload: {
        personName: '张三',
        title: '地图平台负责人',
        orgUnitName: '地图平台事业群',
        company: '云图地图科技',
      },
      evidenceText: '张三最新调任地图平台负责人',
    });

    const buckets = buildReviewQueueBuckets([pendingRole], [source()], currentRoles, []);
    const review = buckets.find((bucket) => bucket.key === 'review');

    expect(review?.candidateIds).toEqual(['cand_role']);
  });
});
