-- FixFlow ERP Database Migration: 0003_reference_numbering.sql
-- Single Source of Truth from Plan.md §3.4

CREATE OR REPLACE FUNCTION next_reference_number(p_prefix VARCHAR, p_year INT)
RETURNS VARCHAR AS $$
DECLARE v_next INT;
BEGIN
  INSERT INTO number_sequences (entity_prefix, year, last_value)
  VALUES (p_prefix, p_year, 1)
  ON CONFLICT (entity_prefix, year)
  DO UPDATE SET last_value = number_sequences.last_value + 1
  RETURNING last_value INTO v_next;
  RETURN p_prefix || '-' || p_year || '-' || LPAD(v_next::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;
