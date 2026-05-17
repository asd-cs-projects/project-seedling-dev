## 1. Fix live monitoring (root cause)

`LiveSessionsMonitor` subscribes to `postgres_changes` on `public.test_sessions`, but that table is **not in the `supabase_realtime` publication** (confirmed: the publication is empty). So no realtime events ever fire — the UI only updates from the 5s polling fallback, and a new student starting a test takes up to 5s to appear, and `current_question` updates never push.

Migration:
- `ALTER TABLE public.test_sessions REPLICA IDENTITY FULL;`
- `ALTER PUBLICATION supabase_realtime ADD TABLE public.test_sessions;`

Also add a small frontend fix: throttle the auto-save in `AssessmentInterface` to write `current_question` / `time_remaining` immediately on question change (currently only every 30s), so the teacher sees real progress, not a stale number.

## 2. Speed up PDF upload + parsing (without extra credits)

Current flow per PDF = **2 Gemini calls + 1 base64 round-trip through the browser**:
1. Client downloads PDF blob from Storage → base64 → sends to `pdf-ocr` (Gemini call #1, vision OCR returning text).
2. Client sends extracted text to `parse-questions` (Gemini call #2, parses JSON).

Changes:

**a. Collapse to a single Gemini call.** Merge `pdf-ocr` + `parse-questions` into one edge function (`extract-questions`) that sends the PDF to Gemini once and asks for the final structured JSON (questions + passages + image/table descriptions) in one go using `responseMimeType: application/json` and `thinkingBudget: 0`. This **halves Gemini token usage** (the OCR text was just an intermediate artifact) and removes one full HTTP round trip.

**b. Skip the client base64 hop.** Client sends only the **storage path** (or a short-lived signed URL); the edge function downloads the PDF using the service role and forwards bytes directly to Gemini. Eliminates: blob download to browser, FileReader base64 encode, and a multi-MB JSON body to the function. Typical 2–5 MB PDFs become an instant function call instead of a 5–15 s upload.

**c. Tighten Gemini config on the remaining call:**
- `thinkingConfig.thinkingBudget: 0` (currently missing on OCR call — silent latency win).
- Drop `maxOutputTokens` to a realistic ceiling (8k is enough for typical question sets).
- Keep the existing model `gemini-3.1-flash-lite` with the same retry/backoff ladder.

**d. Keep the old functions for one release** but make them thin wrappers that call the new one, so existing code paths don't break.

## 3. General app speed (no extra resources)

- Route-level code split: `LiveSessionsMonitor`, `CreateTestWizard`, `AssessmentInterface`, `StudentDetailPage`, `TestResultsPage`, `AIInsights` are heavy and only used by one role. Convert to `React.lazy` + `<Suspense>` in `App.tsx`. Cuts initial JS for both teacher and student dashboards.
- `LiveSessionsMonitor.fetchActiveSessions` currently fires on every realtime event AND every 5s. Once realtime works (fix #1), drop the polling to 30s and debounce realtime refetches to ~500ms.
- `AssessmentInterface` re-runs `loadQuestions` on `testData,testId` change — add a guard so it doesn't re-fetch when only `testData` reference changes from a session restore.

## 4. Where the Gemini credits come from

This is informational, not a code change:

- All AI calls go through your **own Google AI Studio API key**, stored as the Supabase secret `GEMINI_API_KEY` and read by the edge functions `pdf-ocr`, `parse-questions`, `generate-insights` (and `pdf-ocr-vision`, if present).
- Usage therefore shows up in **Google AI Studio → Usage** (and in the linked Google Cloud project's billing if you upgraded past the free tier) for the Google account that owns that API key — **not** in the Lovable dashboard and **not** in the Supabase dashboard.
- If you don't see usage:
  1. The key in `GEMINI_API_KEY` may belong to a different Google account than the one you're logged into AI Studio with. Check the first ~10 chars of the key in Supabase → Edge Functions → Secrets and match it to a key in https://aistudio.google.com/apikey.
  2. Free-tier traffic on `gemini-3.1-flash-lite` may not appear in billing reports — only in the AI Studio Usage tab.
  3. There can be a delay of up to ~24h for usage to appear.
- After the change in §2 you'll be making **roughly half as many Gemini calls per PDF**, so usage should drop further.

## Files touched

- `supabase/migrations/<new>.sql` — realtime publication + replica identity for `test_sessions`.
- `supabase/functions/extract-questions/index.ts` — new combined edge function.
- `supabase/functions/pdf-ocr/index.ts`, `supabase/functions/parse-questions/index.ts` — slim wrappers (or deprecated and removed after callers move).
- `src/components/teacher/PDFUploader.tsx` — call new function with storage path; remove client base64.
- `src/components/assessment/AssessmentInterface.tsx` — save session on question change; guard re-loads.
- `src/components/teacher/LiveSessionsMonitor.tsx` — debounce refetches, lower poll to 30s.
- `src/App.tsx` — `React.lazy` for heavy routes.

No new secrets, no new dependencies, no model changes.
