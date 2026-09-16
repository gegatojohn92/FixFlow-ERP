-- FixFlow ERP Database Migration: 0001_storage_buckets.sql
-- Plan.md Task 1.2: Configure Storage buckets (site-photos, item-references, receipts-proofs, messenger-snapshots)

-- 1. Create Storage Buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('site-photos', 'site-photos', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('item-references', 'item-references', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('receipts-proofs', 'receipts-proofs', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']),
  ('messenger-snapshots', 'messenger-snapshots', false, 10485760, ARRAY['image/png', 'image/jpeg', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Storage RLS Policies
CREATE POLICY "Allow authenticated read on FixFlow buckets"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id IN ('site-photos', 'item-references', 'receipts-proofs', 'messenger-snapshots'));

CREATE POLICY "Allow authenticated upload to FixFlow buckets"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id IN ('site-photos', 'item-references', 'receipts-proofs', 'messenger-snapshots'));

CREATE POLICY "Allow owners to update FixFlow uploads"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id IN ('site-photos', 'item-references', 'receipts-proofs', 'messenger-snapshots') AND auth.uid() = owner);

CREATE POLICY "Allow owners to delete FixFlow uploads"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id IN ('site-photos', 'item-references', 'receipts-proofs', 'messenger-snapshots') AND auth.uid() = owner);
