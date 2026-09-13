-- #135: optional per-operator inbox table column order/visibility.
-- Keep version 2 API compatibility; legacy clients omit this field.
ALTER TABLE operator_presentation_preference
  ADD COLUMN table_columns TEXT NOT NULL DEFAULT '["reference","subject","status","priority","customer","updated"]'
  CHECK (
    json_valid(table_columns)
    AND json_type(table_columns) IS 'array'
    AND json_array_length(table_columns) BETWEEN 1 AND 6
    AND length(CAST(table_columns AS BLOB)) <= 128
  );
