import type { SemanticAliasInput, SemanticAssetType, SemanticContract } from "./semantic-types";

export const SEMANTIC_SUGGESTION_STATUSES = ["OPEN", "ACCEPTED", "DISMISSED"] as const;
export type SemanticSuggestionStatus = (typeof SEMANTIC_SUGGESTION_STATUSES)[number];

export const SUGGESTION_CONFIDENCE = ["HIGH", "MEDIUM", "LOW"] as const;
export type SuggestionConfidence = (typeof SUGGESTION_CONFIDENCE)[number];

export interface SuggestionForeignKeyEvidence {
  table: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface SuggestionEvidence {
  tables: string[];
  columns: string[];
  foreignKeys: SuggestionForeignKeyEvidence[];
}

/**
 * Versioned, storage-safe wrapper around the existing P2-A contract. The
 * nested `contract` deliberately uses the existing semantic types, so a
 * suggestion can only become a Draft through the normal validation pathway.
 */
export interface SemanticSuggestionV1 {
  version: "p2d.v1";
  target: "NEW_ASSET";
  semanticType: SemanticAssetType;
  canonicalName: string;
  displayName: string;
  definition: string;
  aliases: SemanticAliasInput[];
  confidence: SuggestionConfidence;
  assumptions: string[];
  openQuestions: string[];
  evidence: SuggestionEvidence;
  contract: SemanticContract;
}

export interface StoredSemanticSuggestion {
  suggestionId: string;
  runId: string;
  suggestionType: SemanticAssetType;
  status: SemanticSuggestionStatus;
  canonicalName: string;
  displayName: string;
  confidence: SuggestionConfidence;
  suggestion: SemanticSuggestionV1;
  schemaSnapshotId: string;
  createdAt: string;
  isStale: boolean;
  acceptedAssetId: string | null;
  acceptedRevisionId: string | null;
  acceptedAt: string | null;
  dismissedAt: string | null;
}

export interface SemanticSuggestionDraftInput {
  canonicalName: string;
  displayName: string;
  domain?: string;
  description?: string;
  ownerUserId: string;
  createdBy: string;
  changeReason?: string;
  contract: SemanticContract;
  aliases?: SemanticAliasInput[];
}
