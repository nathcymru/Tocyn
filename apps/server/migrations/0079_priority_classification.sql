-- #317 classification evidence. Existing tickets remain unclassified until an
-- authorised staff mutation supplies a complete classification. The columns
-- deliberately have no defaults: historic contracts and urgency are unknown.
ALTER TABLE tickets ADD COLUMN priority_category TEXT CHECK (priority_category IS NULL OR priority_category IN (
  'incidents-interruptions','security-privacy','access-authentication','technical-problems',
  'service-requests','transactions-billing','status-follow-up','information-requests',
  'how-to-assistance','feedback','other'));
ALTER TABLE tickets ADD COLUMN priority_scope TEXT CHECK (priority_scope IS NULL OR priority_scope IN ('systemic','localised','isolated'));
ALTER TABLE tickets ADD COLUMN priority_regulatory_officer_on_site INTEGER CHECK (priority_regulatory_officer_on_site IS NULL OR priority_regulatory_officer_on_site IN (0,1));
ALTER TABLE tickets ADD COLUMN priority_vip_blocked INTEGER CHECK (priority_vip_blocked IS NULL OR priority_vip_blocked IN (0,1));
ALTER TABLE tickets ADD COLUMN priority_hard_deadline INTEGER CHECK (priority_hard_deadline IS NULL OR priority_hard_deadline IN (0,1));
ALTER TABLE tickets ADD COLUMN priority_score INTEGER CHECK (priority_score IS NULL OR priority_score BETWEEN 1 AND 45);
ALTER TABLE tickets ADD COLUMN contract_sla_tier TEXT CHECK (contract_sla_tier IS NULL OR contract_sla_tier IN ('alpha','bravo','charlie','delta'));
ALTER TABLE tickets ADD COLUMN criticality_tier INTEGER CHECK (criticality_tier IS NULL OR criticality_tier IN (1,2,3,4));

-- An incomplete classification cannot be written, even by a bypassing caller.
-- Null remains permissible for historical rows and existing intake paths until
-- the non-operator intake policy is approved and enforced end to end.
CREATE TRIGGER priority_classification_insert BEFORE INSERT ON tickets BEGIN
  SELECT RAISE(ABORT,'incomplete priority classification') WHERE NOT (
    (NEW.priority_category IS NULL AND NEW.priority_scope IS NULL AND
     NEW.priority_regulatory_officer_on_site IS NULL AND NEW.priority_vip_blocked IS NULL AND
     NEW.priority_hard_deadline IS NULL AND NEW.priority_score IS NULL AND
     NEW.contract_sla_tier IS NULL AND NEW.criticality_tier IS NULL)
    OR COALESCE(
      NEW.priority_category IS NOT NULL AND NEW.priority_scope IS NOT NULL AND
      NEW.priority_regulatory_officer_on_site IS NOT NULL AND NEW.priority_vip_blocked IS NOT NULL AND
      NEW.priority_hard_deadline IS NOT NULL AND NEW.priority_score IS NOT NULL AND
      NEW.contract_sla_tier IS NOT NULL AND NEW.criticality_tier IS NOT NULL AND
      NEW.priority_score =
        (CASE NEW.priority_category
          WHEN 'incidents-interruptions' THEN 10 WHEN 'security-privacy' THEN 10
          WHEN 'access-authentication' THEN 7 WHEN 'technical-problems' THEN 7
          WHEN 'service-requests' THEN 4 WHEN 'transactions-billing' THEN 4
          WHEN 'status-follow-up' THEN 4 WHEN 'information-requests' THEN 1
          WHEN 'how-to-assistance' THEN 1 WHEN 'feedback' THEN 1 WHEN 'other' THEN 1 END)
        * (CASE NEW.priority_scope WHEN 'systemic' THEN 3 WHEN 'localised' THEN 2 WHEN 'isolated' THEN 1 END)
        + 5 * (NEW.priority_regulatory_officer_on_site + NEW.priority_vip_blocked + NEW.priority_hard_deadline), 0)
  );
END;

CREATE TRIGGER priority_classification_update BEFORE UPDATE OF
  priority_category,priority_scope,priority_regulatory_officer_on_site,priority_vip_blocked,
  priority_hard_deadline,priority_score,contract_sla_tier,criticality_tier ON tickets BEGIN
  SELECT RAISE(ABORT,'priority classification cannot be cleared')
    WHERE OLD.priority_category IS NOT NULL AND NEW.priority_category IS NULL;
  SELECT RAISE(ABORT,'incomplete priority classification') WHERE NOT (
    (NEW.priority_category IS NULL AND NEW.priority_scope IS NULL AND
     NEW.priority_regulatory_officer_on_site IS NULL AND NEW.priority_vip_blocked IS NULL AND
     NEW.priority_hard_deadline IS NULL AND NEW.priority_score IS NULL AND
     NEW.contract_sla_tier IS NULL AND NEW.criticality_tier IS NULL)
    OR COALESCE(
      NEW.priority_category IS NOT NULL AND NEW.priority_scope IS NOT NULL AND
      NEW.priority_regulatory_officer_on_site IS NOT NULL AND NEW.priority_vip_blocked IS NOT NULL AND
      NEW.priority_hard_deadline IS NOT NULL AND NEW.priority_score IS NOT NULL AND
      NEW.contract_sla_tier IS NOT NULL AND NEW.criticality_tier IS NOT NULL AND
      NEW.priority_score =
        (CASE NEW.priority_category
          WHEN 'incidents-interruptions' THEN 10 WHEN 'security-privacy' THEN 10
          WHEN 'access-authentication' THEN 7 WHEN 'technical-problems' THEN 7
          WHEN 'service-requests' THEN 4 WHEN 'transactions-billing' THEN 4
          WHEN 'status-follow-up' THEN 4 WHEN 'information-requests' THEN 1
          WHEN 'how-to-assistance' THEN 1 WHEN 'feedback' THEN 1 WHEN 'other' THEN 1 END)
        * (CASE NEW.priority_scope WHEN 'systemic' THEN 3 WHEN 'localised' THEN 2 WHEN 'isolated' THEN 1 END)
        + 5 * (NEW.priority_regulatory_officer_on_site + NEW.priority_vip_blocked + NEW.priority_hard_deadline), 0)
  );
END;
