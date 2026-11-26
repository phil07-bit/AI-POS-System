-- Integrity rules that the ORM cannot express. These are the last line of defence;
-- services validate the same rules first so users get friendly errors.

-- 1. No two ACTIVE leases on the same unit may overlap (inclusive date ranges).
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE leases
  ADD CONSTRAINT leases_active_no_overlap
  EXCLUDE USING gist (unit_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
  WHERE (status = 'active');

ALTER TABLE leases ADD CONSTRAINT leases_dates_valid CHECK (end_date >= start_date);
ALTER TABLE leases ADD CONSTRAINT leases_rent_positive CHECK (rent_amount_minor > 0);
ALTER TABLE leases ADD CONSTRAINT leases_deposit_nonneg CHECK (deposit_amount_minor >= 0);
ALTER TABLE leases ADD CONSTRAINT leases_due_day_range CHECK (due_day IS NULL OR (due_day BETWEEN 1 AND 31));

-- 2. Money sanity.
ALTER TABLE rent_charges ADD CONSTRAINT rent_charges_amount_positive CHECK (amount_minor > 0);
ALTER TABLE rent_charges ADD CONSTRAINT rent_charges_period_valid CHECK (period_end >= period_start);
ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK (amount_minor > 0);
ALTER TABLE payment_allocations ADD CONSTRAINT allocations_amount_positive CHECK (allocated_amount_minor > 0);
ALTER TABLE ledger_adjustments ADD CONSTRAINT adjustments_amount_positive CHECK (amount_minor > 0);
ALTER TABLE units ADD CONSTRAINT units_asking_rent_nonneg CHECK (asking_rent_minor IS NULL OR asking_rent_minor >= 0);

-- 3. Append-only financial history and audit trail: block deletes at the database level.
CREATE OR REPLACE FUNCTION aipos_forbid_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Deleting rows from % is not permitted (append-only ledger/audit). Use a reversal or adjustment.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments FOR EACH ROW EXECUTE FUNCTION aipos_forbid_delete();
CREATE TRIGGER allocations_no_delete BEFORE DELETE ON payment_allocations FOR EACH ROW EXECUTE FUNCTION aipos_forbid_delete();
CREATE TRIGGER adjustments_no_delete BEFORE DELETE ON ledger_adjustments FOR EACH ROW EXECUTE FUNCTION aipos_forbid_delete();
CREATE TRIGGER receipts_no_delete BEFORE DELETE ON receipts FOR EACH ROW EXECUTE FUNCTION aipos_forbid_delete();
CREATE TRIGGER rent_charges_no_delete BEFORE DELETE ON rent_charges FOR EACH ROW EXECUTE FUNCTION aipos_forbid_delete();

-- Audit logs: no updates or deletes by the application.
CREATE OR REPLACE FUNCTION aipos_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION aipos_audit_immutable();

-- Allocation amounts on a payment can never exceed the payment amount (defence in depth).
CREATE OR REPLACE FUNCTION aipos_check_allocation_total() RETURNS trigger AS $$
DECLARE
  total bigint;
  pay_amount int;
BEGIN
  SELECT amount_minor INTO pay_amount FROM payments WHERE id = NEW.payment_id;
  SELECT COALESCE(SUM(allocated_amount_minor), 0) INTO total
    FROM payment_allocations WHERE payment_id = NEW.payment_id AND reversed_at IS NULL;
  IF total > pay_amount THEN
    RAISE EXCEPTION 'Allocations (%) exceed payment amount (%)', total, pay_amount;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER allocations_within_payment AFTER INSERT OR UPDATE ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aipos_check_allocation_total();
