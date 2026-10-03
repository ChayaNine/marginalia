// Version of the ingestion pipeline (extraction + chunking). Browser-safe, so the
// UI can tell which documents would benefit from re-processing.
//
// Bump when extraction or chunking changes in a way that makes old chunks worse.
// Documents processed by an older version are offered a one-click re-process, and
// uploading the same file again re-processes it instead of being rejected.
//   1 – flat text, fixed-size character windows
//   2 – layout-aware PDF reading, sentence/section chunks, pages, summaries
export const PIPELINE_VERSION = 2;
