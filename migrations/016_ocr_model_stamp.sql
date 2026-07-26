ALTER TABLE archived_files ADD COLUMN IF NOT EXISTS ocr_model TEXT;

-- Stamping the model that produced ocr_text is what disambiguates a NULL ocr_text: with the stamp
-- set it means OCR ran and the image genuinely had no text; without it, OCR never succeeded and the
-- row is a retry candidate. Mirrors the vision_model and embedding_model stamps.
--
-- Existing photos with text were all OCR'd by mistral-ocr-latest, the only OCR model this project
-- has used. Rows left NULL are exactly the ones where OCR produced nothing — deliberately left
-- unstamped so a re-OCR pass picks them up.
UPDATE archived_files
SET ocr_model = 'mistral-ocr-latest'
WHERE ocr_text IS NOT NULL
  AND ocr_model IS NULL;
