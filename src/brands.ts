import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity of one learned topic. */
export type TopicId = Branded<'dsh-explain/topic'>

/** Stable identity of one explanation and its rephrase revisions. */
export type ExplanationId = Branded<'dsh-explain/explanation'>

/** Stable identity of one append-only learning-thread entry. */
export type EntryId = Branded<'dsh-explain/entry'>

/** Stable identity of one structured ExplainContext observation. */
export type ObservationId = Branded<'dsh-explain/observation'>

/** Client-generated idempotency identity for one feedback mutation. */
export type RequestId = Branded<'dsh-explain/request'>

/** Host-generated identity for one accepted autonomous model request. */
export type AutoRequestId = Branded<'dsh-explain/auto-request'>

/** Construct a TopicId after persistence-boundary validation. */
export const TopicId = (value: string): TopicId => value as TopicId

/** Construct an ExplanationId after persistence-boundary validation. */
export const ExplanationId = (value: string): ExplanationId => value as ExplanationId

/** Construct an EntryId after persistence-boundary validation. */
export const EntryId = (value: string): EntryId => value as EntryId

/** Construct an ObservationId after persistence-boundary validation. */
export const ObservationId = (value: string): ObservationId => value as ObservationId

/** Construct a RequestId after wire-boundary validation. */
export const RequestId = (value: string): RequestId => value as RequestId

/** Construct an AutoRequestId after persistence-boundary validation. */
export const AutoRequestId = (value: string): AutoRequestId => value as AutoRequestId
