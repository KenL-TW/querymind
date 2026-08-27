export const SEMANTIC_ASSET_TYPES = ["TERM", "DIMENSION", "METRIC", "RELATIONSHIP"] as const;
export type SemanticAssetType = (typeof SEMANTIC_ASSET_TYPES)[number];

export const SEMANTIC_ASSET_STATUSES = ["ACTIVE", "DEPRECATED"] as const;
export type SemanticAssetStatus = (typeof SEMANTIC_ASSET_STATUSES)[number];

export const SEMANTIC_REVISION_STATUSES = ["DRAFT", "IN_REVIEW", "APPROVED", "REJECTED"] as const;
export type SemanticRevisionStatus = (typeof SEMANTIC_REVISION_STATUSES)[number];

export const SEMANTIC_REVIEW_ACTIONS = ["SUBMITTED", "APPROVED", "REJECTED", "REQUEST_CHANGES", "DEPRECATED"] as const;
export type SemanticReviewAction = (typeof SEMANTIC_REVIEW_ACTIONS)[number];

export const RELATIONSHIP_CARDINALITIES = ["ONE_TO_ONE", "ONE_TO_MANY", "MANY_TO_ONE", "MANY_TO_MANY"] as const;
export type RelationshipCardinality = (typeof RELATIONSHIP_CARDINALITIES)[number];

export const TIME_UNITS = ["day", "week", "month", "quarter", "year"] as const;
export type TimeUnit = (typeof TIME_UNITS)[number];

export const METRIC_UNITS = ["COUNT", "CURRENCY", "QUANTITY", "PERCENT", "RATING", "UNKNOWN"] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];

export const BUSINESS_FILTER_OPERATORS = ["EQ", "NEQ", "IN", "NOT_IN", "IS_NULL", "IS_NOT_NULL"] as const;
export type BusinessFilterOperator = (typeof BUSINESS_FILTER_OPERATORS)[number];

export const DIMENSION_OPERATIONS = ["GROUP", "FILTER", "ORDER"] as const;
export type DimensionOperation = (typeof DIMENSION_OPERATIONS)[number];

export type Scalar = string | number | boolean | null;

export interface SourceRef {
  table: string;
  column: string;
}

export interface SemanticDependency {
  referencedAssetId: string;
  referencedRevisionId: string;
}

export interface BusinessFilter {
  field: SourceRef;
  operator: BusinessFilterOperator;
  value?: Scalar | Scalar[];
}

export interface EntityGrainRef {
  kind: "ENTITY";
  key: string;
  source: {
    table: string;
    keyColumns: string[];
  };
}

export interface TimeGrainRef {
  kind: "TIME";
  key: string;
  source: SourceRef;
  timeUnit: TimeUnit;
}

export type GrainRef = EntityGrainRef | TimeGrainRef;

export interface ColumnExpression {
  kind: "COLUMN";
  source: SourceRef;
}

export interface LiteralExpression {
  kind: "LITERAL";
  value: Scalar;
}

export interface ArithmeticExpression {
  kind: "ADD" | "SUBTRACT" | "MULTIPLY" | "DIVIDE";
  left: MetricExpression;
  right: MetricExpression;
  divisionByZero?: "NULL";
}

export interface AggregateExpression {
  kind: "SUM" | "AVG" | "MIN" | "MAX";
  argument: MetricExpression;
}

export interface CountRowsExpression {
  kind: "COUNT";
  mode: "ROWS";
}

export interface CountColumnExpression {
  kind: "COUNT";
  mode: "COLUMN";
  source: SourceRef;
}

export interface CountDistinctExpression {
  kind: "COUNT_DISTINCT";
  source: SourceRef;
}

export type MetricExpression =
  | ColumnExpression
  | LiteralExpression
  | ArithmeticExpression
  | AggregateExpression
  | CountRowsExpression
  | CountColumnExpression
  | CountDistinctExpression;

export interface MetricSource {
  ref: SourceRef;
  role: "value" | "join" | "filter" | "time";
}

export interface MetricContract {
  canonicalName: string;
  displayName: string;
  definition: string;
  domain: string;
  sources: MetricSource[];
  expression: MetricExpression;
  defaultFilters: BusinessFilter[];
  nativeGrain: GrainRef;
  timeDimension?: SourceRef;
  unit: MetricUnit;
  currency?: string;
  semanticDependencies: SemanticDependency[];
}

export interface TermContract {
  canonicalName: string;
  displayName: string;
  definition: string;
  domain: string;
  source?: SourceRef;
  semanticDependencies: SemanticDependency[];
}

export interface DimensionContract {
  canonicalName: string;
  displayName: string;
  definition: string;
  domain: string;
  source: SourceRef;
  dataType: string;
  allowedOperations: DimensionOperation[];
  nativeGrain?: GrainRef;
  semanticDependencies: SemanticDependency[];
}

export interface RelationshipJoinKey {
  leftTable: string;
  leftColumn: string;
  rightTable: string;
  rightColumn: string;
}

export interface RelationshipContract {
  canonicalName: string;
  displayName: string;
  definition: string;
  domain: string;
  leftTable: string;
  rightTable: string;
  cardinality: RelationshipCardinality;
  joinKeys: RelationshipJoinKey[];
  semanticDependencies: SemanticDependency[];
}

export type SemanticContract = TermContract | DimensionContract | MetricContract | RelationshipContract;

export interface SemanticAssetRecord {
  assetId: string;
  assetType: SemanticAssetType;
  canonicalName: string;
  displayName: string;
  domain: string;
  description: string;
  ownerUserId: string;
  assetStatus: SemanticAssetStatus;
  currentApprovedRevisionId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deprecatedAt: string | null;
}

export interface SemanticRevisionRecord {
  revisionId: string;
  assetId: string;
  revisionNumber: number;
  revisionStatus: SemanticRevisionStatus;
  payloadJson: string;
  schemaSnapshotId: string;
  changeReason: string;
  createdBy: string;
  createdAt: string;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
}

export type SemanticSourceKind = "TABLE" | "COLUMN" | "SEMANTIC_DEPENDENCY";

export interface NormalizedSemanticSource {
  sourceId: string;
  revisionId: string;
  sourceKind: SemanticSourceKind;
  tableName: string | null;
  columnName: string | null;
  referencedAssetId: string | null;
  referencedRevisionId: string | null;
  role: string;
  ordinalPosition: number;
}

export interface SemanticAliasInput {
  alias: string;
  locale?: string;
}

export interface SemanticCreateInput {
  assetId?: string;
  revisionId?: string;
  assetType: SemanticAssetType;
  canonicalName: string;
  displayName: string;
  domain?: string;
  description?: string;
  ownerUserId: string;
  createdBy: string;
  schemaSnapshotId: string;
  changeReason?: string;
  contract: SemanticContract;
  aliases?: SemanticAliasInput[];
}

export interface SemanticRevisionCreateInput {
  assetId: string;
  revisionId?: string;
  schemaSnapshotId: string;
  changeReason?: string;
  createdBy: string;
  contract: SemanticContract;
  aliases?: SemanticAliasInput[];
}

export interface SemanticRevisionUpdateInput {
  revisionId: string;
  schemaSnapshotId?: string;
  changeReason?: string;
  contract?: SemanticContract;
  aliases?: SemanticAliasInput[];
}

export interface SemanticValidationResult<T extends SemanticContract = SemanticContract> {
  contract: T;
  payloadJson: string;
  normalizedSources: Omit<NormalizedSemanticSource, "sourceId" | "revisionId">[];
}
