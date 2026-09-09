-- An extraction that already had rows when `stage` arrived (default 'columns') would reload
-- as an un-extractable column step. Rows exist only while a review is open, so this touches
-- at most a handful of scratch rows — but it is a one-liner (review finding 3, 9 Sep 2026).
UPDATE "PoExtraction" SET "stage" = 'review' WHERE "totalItems" > 0 AND "stage" = 'columns';
