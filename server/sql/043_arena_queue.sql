-- 043: arena queue ready flag
ALTER TABLE arena_tickets
  ADD COLUMN ready TINYINT(1) NOT NULL DEFAULT 0 AFTER state;
