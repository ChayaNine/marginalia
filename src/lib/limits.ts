// Product limits in one place, so the API, the UI copy and the tests agree.

export const MAX_QUESTIONS_PER_SET = 500;

/** Questions drafted per request in the batch loop (see src/lib/drafting.ts). */
export const DRAFT_BATCH_SIZE = 5;
