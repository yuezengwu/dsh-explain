/** Initial dsh-explain SQLite format. Pre-release builds reject every other version. */
export const SCHEMA_VERSION = 1

/** Complete schema installed atomically for a new database. */
export const CREATE_SCHEMA_SQL = `
CREATE TABLE meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version INTEGER NOT NULL,
  store_revision INTEGER NOT NULL CHECK (store_revision >= 0),
  next_ordinal INTEGER NOT NULL CHECK (next_ordinal >= 1)
) STRICT;

CREATE TABLE runtime_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  first_explain_output_at INTEGER,
  last_user_action_at INTEGER,
  activity_generation INTEGER NOT NULL DEFAULT 0 CHECK (activity_generation >= 0),
  last_compacted_at INTEGER,
  context_generation INTEGER NOT NULL DEFAULT 0 CHECK (context_generation >= 0)
) STRICT;

CREATE TABLE topics (
  topic_id TEXT PRIMARY KEY,
  topic_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('learning', 'mastered')),
  topic_revision INTEGER NOT NULL CHECK (topic_revision >= 1),
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE explanations (
  explanation_id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(topic_id),
  source_session_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'closed')),
  active_revision INTEGER NOT NULL CHECK (active_revision >= 1),
  rephrase_pending INTEGER NOT NULL DEFAULT 0 CHECK (rephrase_pending IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (state = 'active' OR rephrase_pending = 0)
) STRICT;

CREATE UNIQUE INDEX explanations_one_active_per_source
  ON explanations(source_session_id) WHERE state = 'active';
CREATE UNIQUE INDEX explanations_one_active_per_topic
  ON explanations(topic_id) WHERE state = 'active';

CREATE TABLE entries (
  entry_id TEXT PRIMARY KEY,
  ordinal INTEGER NOT NULL UNIQUE CHECK (ordinal >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('explanation', 'feedback', 'topic-reopen')),
  explanation_id TEXT REFERENCES explanations(explanation_id),
  topic_id TEXT NOT NULL REFERENCES topics(topic_id),
  revision INTEGER,
  source_session_id TEXT,
  source_turn INTEGER,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (
    (kind = 'explanation' AND explanation_id IS NOT NULL AND revision IS NOT NULL
      AND source_session_id IS NOT NULL AND source_turn IS NOT NULL)
    OR (kind = 'feedback' AND explanation_id IS NOT NULL AND revision IS NOT NULL
      AND source_session_id IS NOT NULL AND source_turn IS NULL)
    OR (kind = 'topic-reopen' AND explanation_id IS NULL AND revision IS NULL
      AND source_session_id IS NULL AND source_turn IS NULL)
  )
) STRICT;

CREATE INDEX entries_page ON entries(ordinal DESC);
CREATE INDEX entries_explanation_revision ON entries(explanation_id, revision, ordinal);

CREATE TABLE mutation_requests (
  request_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  entry_id TEXT NOT NULL REFERENCES entries(entry_id),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE context_observations (
  observation_id TEXT PRIMARY KEY,
  source_session_id TEXT NOT NULL,
  source_turn INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE context_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL UNIQUE CHECK (generation >= 1),
  trigger TEXT NOT NULL CHECK (trigger IN ('idle', 'pressure')),
  through_ordinal INTEGER NOT NULL CHECK (through_ordinal >= 0),
  context_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  request_id TEXT NOT NULL UNIQUE
) STRICT;

CREATE TABLE context_coverage (
  checkpoint_id TEXT NOT NULL REFERENCES context_checkpoints(checkpoint_id),
  explanation_id TEXT NOT NULL UNIQUE REFERENCES explanations(explanation_id),
  PRIMARY KEY (checkpoint_id, explanation_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE observation_coverage (
  checkpoint_id TEXT NOT NULL REFERENCES context_checkpoints(checkpoint_id),
  observation_id TEXT NOT NULL UNIQUE REFERENCES context_observations(observation_id),
  PRIMARY KEY (checkpoint_id, observation_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE auto_request_usage (
  auto_request_id TEXT PRIMARY KEY,
  source_session_id TEXT NOT NULL,
  started_at INTEGER NOT NULL
) STRICT;

CREATE INDEX auto_request_usage_window ON auto_request_usage(started_at);

CREATE TABLE runtime_lease (
  name TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  expires_at INTEGER NOT NULL
) STRICT;

INSERT INTO meta(singleton, schema_version, store_revision, next_ordinal)
VALUES (1, ${SCHEMA_VERSION}, 0, 1);
INSERT INTO runtime_state(singleton, activity_generation, context_generation)
VALUES (1, 0, 0);
`
