-- FixFlow ERP Database Migration: 0008_make_storage_buckets_public.sql
-- Fixes: 400 Bad Request when fetching uploaded photos from /storage/v1/object/public/...
--
-- ROOT CAUSE:
--   Buckets were created with `public = false`. Supabase strictly rejects
--   requests to /storage/v1/object/public/<bucket>/... with HTTP 400 Bad Request
--   ("Bucket is private" or "Bucket not found").
--
-- FIX:
--   1. Upsert all 4 FixFlow storage buckets with `public = true`.
--   2. Grant public SELECT access on `storage.objects` for these buckets so
--      standard <img src="..." /> tags load seamlessly.
--   3. Ensure authenticated users can upload (INSERT) into all 4 buckets.

-- 1. Create or Update Storage Buckets to PUBLIC
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('site-photos', 'site-photos', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('item-references', 'item-references', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('receipts-proofs', 'receipts-proofs', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']),
  ('messenger-snapshots', 'messenger-snapshots', true, 10485760, ARRAY['image/png', 'image/jpeg', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Storage Objects RLS Policies

-- Public read access: Anyone can read files from public FixFlow buckets
DROP POLICY IF EXISTS "Allow public read on FixFlow buckets" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated read on FixFlow buckets" ON storage.objects;

CREATE POLICY "Allow public read on FixFlow buckets"
ON storage.objects FOR SELECT TO public
USING (bucket_id IN ('site-photos', 'item-references', 'receipts-proofs', 'messenger-snapshots'));

-- Authenticated upload access
DROP POLICY IF EXISTS "Allow authenticated upload to FixFlow buckets" ON storage.objects;
CREATE POLICY "Allow authenticated upload to FixFlow buckets"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id IN ('site-photos', 'item-references', 'receipts-proofs', 'messenger-snapshots'));

-- Authenticated update access
DROP POLICY IF EXISTS "Allow owners to update FixFlow uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated update to FixFlow buckets" ON storage.objects;
CREATE POLICY "Allow authenticated update to FixFlow buckets"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id IN ('site-photos', 'item-references', 'receipts-proofs', 'messenger-snapshots'));

-- Authenticated delete access
DROP POLICY IF EXISTS "Allow owners to delete FixFlow uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated delete to FixFlow buckets" ON storage.objects;
CREATE POLICY "Allow authenticated delete to FixFlow buckets"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id IN ('site-photos', 'item-references', 'receipts-proofs', 'messenger-snapshots'));
