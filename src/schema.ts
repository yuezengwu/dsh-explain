/** Current dsh-explain SQLite format. Version 2 is migrated in place. */
export const SCHEMA_VERSION = 3

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
  model_json TEXT NOT NULL,
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
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  started_at INTEGER NOT NULL
) STRICT;

CREATE INDEX auto_request_usage_window ON auto_request_usage(started_at);

CREATE TABLE runtime_lease (
  name TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  expires_at INTEGER NOT NULL
) STRICT;

CREATE TABLE review_state (
  topic_id TEXT PRIMARY KEY REFERENCES topics(topic_id),
  stage INTEGER NOT NULL DEFAULT 0 CHECK (stage >= 0 AND stage <= 5),
  streak INTEGER NOT NULL DEFAULT 0 CHECK (streak >= 0),
  next_review_at INTEGER NOT NULL,
  last_reviewed_at INTEGER,
  last_result TEXT CHECK (last_result IS NULL OR last_result IN ('mastered', 'partial', 'forgotten')),
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX review_state_due ON review_state(next_review_at, topic_id);

CREATE TABLE review_batches (
  batch_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('active', 'completed')),
  created_at INTEGER NOT NULL,
  completed_at INTEGER
) STRICT;

CREATE UNIQUE INDEX review_batches_one_active ON review_batches(state) WHERE state = 'active';

CREATE TABLE review_attempts (
  review_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES review_batches(batch_id),
  position INTEGER NOT NULL CHECK (position >= 1 AND position <= 3),
  topic_id TEXT NOT NULL REFERENCES topics(topic_id),
  explanation_id TEXT NOT NULL REFERENCES explanations(explanation_id),
  explanation_revision INTEGER NOT NULL CHECK (explanation_revision >= 1),
  question_kind TEXT NOT NULL CHECK (question_kind IN ('recall', 'application', 'distinction')),
  question TEXT NOT NULL,
  answer TEXT,
  result TEXT CHECK (result IS NULL OR result IN ('mastered', 'partial', 'forgotten')),
  feedback TEXT,
  generation_json TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  next_review_at INTEGER,
  UNIQUE(batch_id, position),
  UNIQUE(batch_id, topic_id),
  CHECK (
    (answer IS NULL AND result IS NULL AND feedback IS NULL AND generation_json IS NULL
      AND completed_at IS NULL AND next_review_at IS NULL)
    OR (answer IS NOT NULL AND result IS NOT NULL AND feedback IS NOT NULL
      AND generation_json IS NOT NULL AND completed_at IS NOT NULL AND next_review_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX review_attempts_recent ON review_attempts(completed_at DESC);

CREATE TABLE review_mutation_requests (
  request_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  review_id TEXT NOT NULL REFERENCES review_attempts(review_id),
  created_at INTEGER NOT NULL
) STRICT;

INSERT INTO meta(singleton, schema_version, store_revision, next_ordinal)
VALUES (1, ${SCHEMA_VERSION}, 0, 1);
INSERT INTO runtime_state(singleton, activity_generation, context_generation)
VALUES (1, 0, 0);
`

/** Atomic v2 to v3 migration. Existing mastered topics become immediately due. */
export const MIGRATE_V2_TO_V3_SQL = `
CREATE TABLE review_state (
  topic_id TEXT PRIMARY KEY REFERENCES topics(topic_id),
  stage INTEGER NOT NULL DEFAULT 0 CHECK (stage >= 0 AND stage <= 5),
  streak INTEGER NOT NULL DEFAULT 0 CHECK (streak >= 0),
  next_review_at INTEGER NOT NULL,
  last_reviewed_at INTEGER,
  last_result TEXT CHECK (last_result IS NULL OR last_result IN ('mastered', 'partial', 'forgotten')),
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX review_state_due ON review_state(next_review_at, topic_id);
CREATE TABLE review_batches (
  batch_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('active', 'completed')),
  created_at INTEGER NOT NULL,
  completed_at INTEGER
) STRICT;
CREATE UNIQUE INDEX review_batches_one_active ON review_batches(state) WHERE state = 'active';
CREATE TABLE review_attempts (
  review_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES review_batches(batch_id),
  position INTEGER NOT NULL CHECK (position >= 1 AND position <= 3),
  topic_id TEXT NOT NULL REFERENCES topics(topic_id),
  explanation_id TEXT NOT NULL REFERENCES explanations(explanation_id),
  explanation_revision INTEGER NOT NULL CHECK (explanation_revision >= 1),
  question_kind TEXT NOT NULL CHECK (question_kind IN ('recall', 'application', 'distinction')),
  question TEXT NOT NULL,
  answer TEXT,
  result TEXT CHECK (result IS NULL OR result IN ('mastered', 'partial', 'forgotten')),
  feedback TEXT,
  generation_json TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  next_review_at INTEGER,
  UNIQUE(batch_id, position),
  UNIQUE(batch_id, topic_id),
  CHECK (
    (answer IS NULL AND result IS NULL AND feedback IS NULL AND generation_json IS NULL
      AND completed_at IS NULL AND next_review_at IS NULL)
    OR (answer IS NOT NULL AND result IS NOT NULL AND feedback IS NOT NULL
      AND generation_json IS NOT NULL AND completed_at IS NOT NULL AND next_review_at IS NOT NULL)
  )
) STRICT;
CREATE INDEX review_attempts_recent ON review_attempts(completed_at DESC);
CREATE TABLE review_mutation_requests (
  request_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  review_id TEXT NOT NULL REFERENCES review_attempts(review_id),
  created_at INTEGER NOT NULL
) STRICT;
INSERT INTO review_state(topic_id, stage, streak, next_review_at, updated_at)
SELECT topic_id, 0, 0, updated_at, updated_at FROM topics WHERE state = 'mastered';
UPDATE meta SET schema_version = 3 WHERE singleton = 1;
`
