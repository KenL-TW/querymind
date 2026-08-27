-- P2-B design-time semantic governance capabilities.
-- Owner keeps the existing '*' capability. DBA receives only bounded
-- semantic metadata administration; neither role receives business-data
-- authorization from these capabilities.
UPDATE role_definitions
SET capabilities_json = json_insert(capabilities_json, '$[#]', 'view_semantics')
WHERE role_name = 'dba'
  AND NOT EXISTS (SELECT 1 FROM json_each(capabilities_json) WHERE value = 'view_semantics');

UPDATE role_definitions
SET capabilities_json = json_insert(capabilities_json, '$[#]', 'manage_semantic_drafts')
WHERE role_name = 'dba'
  AND NOT EXISTS (SELECT 1 FROM json_each(capabilities_json) WHERE value = 'manage_semantic_drafts');

UPDATE role_definitions
SET capabilities_json = json_insert(capabilities_json, '$[#]', 'review_semantics')
WHERE role_name = 'dba'
  AND NOT EXISTS (SELECT 1 FROM json_each(capabilities_json) WHERE value = 'review_semantics');
