WITH table_signatures AS (
  SELECT format(
    'table|%s|%s|%s|%s',
    c.relname,
    c.relkind,
    c.relrowsecurity,
    c.relforcerowsecurity
  ) AS signature
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
), column_signatures AS (
  SELECT format(
    'column|%s|%s|%s|%s|%s|%s|%s',
    c.relname,
    a.attname,
    pg_catalog.format_type(a.atttypid, a.atttypmod),
    a.attnotnull,
    COALESCE(regexp_replace(pg_get_expr(d.adbin, d.adrelid), '\s+', ' ', 'g'), ''),
    a.attidentity,
    a.attgenerated
  ) AS signature
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
  LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND a.attnum > 0
    AND NOT a.attisdropped
), enum_signatures AS (
  SELECT format(
    'enum|%s|%s|%s',
    t.typname,
    e.enumsortorder,
    e.enumlabel
  ) AS signature
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE n.nspname = 'public'
), index_signatures AS (
  SELECT format(
    'index|%s|%s|%s|%s|%s|%s|%s|%s',
    table_class.relname,
    index_class.relname,
    i.indisunique,
    i.indisprimary,
    i.indisvalid,
    i.indisready,
    i.indnullsnotdistinct,
    regexp_replace(pg_get_indexdef(i.indexrelid), '\s+', ' ', 'g')
  ) AS signature
  FROM pg_index i
  JOIN pg_class table_class ON table_class.oid = i.indrelid
  JOIN pg_class index_class ON index_class.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = table_class.relnamespace
  WHERE n.nspname = 'public'
), constraint_signatures AS (
  SELECT format(
    'constraint|%s|%s|%s|%s|%s|%s|%s',
    source.relname,
    constraint_row.conname,
    constraint_row.contype,
    constraint_row.condeferrable,
    constraint_row.condeferred,
    constraint_row.convalidated,
    regexp_replace(
      pg_get_constraintdef(constraint_row.oid, true),
      '\s+',
      ' ',
      'g'
    )
  ) AS signature
  FROM pg_constraint constraint_row
  JOIN pg_class source ON source.oid = constraint_row.conrelid
  JOIN pg_namespace n ON n.oid = source.relnamespace
  WHERE n.nspname = 'public'
), all_signatures AS (
  SELECT signature FROM table_signatures
  UNION ALL SELECT signature FROM column_signatures
  UNION ALL SELECT signature FROM enum_signatures
  UNION ALL SELECT signature FROM index_signatures
  UNION ALL SELECT signature FROM constraint_signatures
)
SELECT signature FROM all_signatures ORDER BY signature;
