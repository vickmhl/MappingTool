export type SourceType = 'text' | 'markdown' | 'pptx' | 'ocr' | 'project';
export type SensitivityLevel = 'internal' | 'restricted' | 'external';
export type OrgChartMode = 'explore' | 'formal';
export type OrgChartExportFormat = 'ppt16x9' | 'a4Landscape' | 'longImage';

export type CandidateKind =
  | 'person'
  | 'orgUnit'
  | 'roleAssignment'
  | 'reportingLine'
  | 'changeEvent';

export type CandidateStatus = 'pending' | 'accepted' | 'rejected';

export type ChangeEventType =
  | 'new'
  | 'resigned'
  | 'transfer'
  | 'reporting-change'
  | 'conflict'
  | 'stale';

export type ReportTemplateKey = 'executive' | 'recruiting' | 'external' | 'diagnostic';

export type AuditAction =
  | 'import'
  | 'candidate-accepted'
  | 'candidate-rejected'
  | 'canvas-layout-saved'
  | 'canvas-layout-reset'
  | 'insight-weights-updated'
  | 'privacy-changed'
  | 'sensitivity-updated'
  | 'source-credibility-updated'
  | 'report-template-applied'
  | 'export'
  | 'project-imported'
  | 'demo-loaded'
  | 'talent-updated';

export interface Project {
  id: string;
  name: string;
  companies: string[];
  updatedAt: string;
  settings: {
    anonymizeExports: boolean;
    exportPrivacy: {
      names: boolean;
      companies: boolean;
      sources: boolean;
      notes: boolean;
    };
    staleAfterDays: number;
    defaultVisibleNodeLimit: number;
    activeCanvasView: 'executive' | 'recruiting' | 'detail';
    orgChartMode: OrgChartMode;
    orgChartExportFormat: OrgChartExportFormat;
    reportTemplate: ReportTemplateKey;
    sensitivityLevel: SensitivityLevel;
    sourceCredibility: Record<SourceType, number>;
    insightWeights: {
      coverage: number;
      confidence: number;
      freshness: number;
      confirmation: number;
    };
  };
}

export interface CanvasNodePosition {
  x: number;
  y: number;
  updatedAt: string;
}

export interface CanvasLayout {
  nodes: Record<string, CanvasNodePosition>;
  updatedAt: string;
}

export interface SourceDocument {
  id: string;
  fileName: string;
  type: SourceType;
  importedAt: string;
  hash: string;
  textPreview: string;
  totalChunks: number;
  pages?: number;
  warnings?: string[];
}

export interface EvidenceChunk {
  id: string;
  sourceDocumentId: string;
  sourceName: string;
  location: string;
  text: string;
  extractedAt: string;
  date?: string;
  confidence: number;
  candidateIds: string[];
}

export interface Person {
  id: string;
  name: string;
  aliases: string[];
  company?: string;
  currentTitle?: string;
  currentDepartment?: string;
  tags: string[];
  sensitiveNote?: string;
  status: 'active' | 'left' | 'unknown';
  evidenceIds: string[];
  updatedAt: string;
}

export interface OrgUnit {
  id: string;
  company: string;
  name: string;
  parentId?: string;
  function?: string;
  status: 'active' | 'inactive' | 'unknown';
  evidenceIds: string[];
  updatedAt: string;
}

export interface RoleAssignment {
  id: string;
  personId?: string;
  personName: string;
  title: string;
  orgUnitId?: string;
  orgUnitName?: string;
  company?: string;
  effectiveDate?: string;
  status: 'current' | 'historical' | 'uncertain';
  evidenceIds: string[];
  updatedAt: string;
}

export interface ReportingLine {
  id: string;
  subordinateId?: string;
  subordinateName: string;
  managerId?: string;
  managerName: string;
  relationType: 'reports-to' | 'manages' | 'dotted-line' | 'unknown';
  confidence: number;
  evidenceIds: string[];
  isCurrent: boolean;
  updatedAt: string;
}

export interface ChangeEvent {
  id: string;
  personId?: string;
  personName?: string;
  type: ChangeEventType;
  description: string;
  date?: string;
  sourceName?: string;
  evidenceIds: string[];
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  action: AuditAction;
  description: string;
  createdAt: string;
  actor: 'local-hr';
  entityCount?: number;
  view?: string;
  sourceName?: string;
}

export interface CandidateRecord<TPayload = unknown> {
  id: string;
  kind: CandidateKind;
  status: CandidateStatus;
  confidence: number;
  payload: TPayload;
  evidenceId: string;
  evidenceText: string;
  sourceName: string;
  createdAt: string;
  reason: string;
}

export interface RoleCandidatePayload {
  personName: string;
  title: string;
  orgUnitName?: string;
  company?: string;
  effectiveDate?: string;
}

export interface ReportingCandidatePayload {
  subordinateName: string;
  managerName: string;
  relationType: ReportingLine['relationType'];
}

export interface OrgUnitCandidatePayload {
  name: string;
  company?: string;
  function?: string;
  parentName?: string;
}

export interface PersonCandidatePayload {
  name: string;
  company?: string;
  title?: string;
  department?: string;
}

export interface ChangeCandidatePayload {
  personName?: string;
  type: ChangeEventType;
  description: string;
  date?: string;
}

export type AnyCandidatePayload =
  | RoleCandidatePayload
  | ReportingCandidatePayload
  | OrgUnitCandidatePayload
  | PersonCandidatePayload
  | ChangeCandidatePayload;

export interface AppState {
  project: Project;
  sources: SourceDocument[];
  evidence: EvidenceChunk[];
  candidates: CandidateRecord<AnyCandidatePayload>[];
  people: Person[];
  orgUnits: OrgUnit[];
  roleAssignments: RoleAssignment[];
  reportingLines: ReportingLine[];
  changeEvents: ChangeEvent[];
  canvasLayouts?: Record<string, CanvasLayout>;
  auditLog?: AuditEntry[];
}

export interface ImportResult {
  source: SourceDocument;
  evidence: EvidenceChunk[];
  candidates: CandidateRecord<AnyCandidatePayload>[];
  warnings: string[];
}

export interface OrgMapFilters {
  company: string;
  search: string;
  focusPersonName: string;
  minConfidence: number;
  visibleLimit: number;
  maxDepth: number;
}
