export const NEIGHBORHOOD_WALK_CTE = `
WITH RECURSIVE walk (
  depth,
  node_type,
  node_id,
  typed_id,
  path,
  edge_type,
  edge_from_typed,
  edge_to_typed,
  edge_from_id,
  edge_to_id,
  role,
  ordinal
) AS (
  SELECT
    0::int AS depth,
    'idea'::text AS node_type,
    i.content_id AS node_id,
    ('idea:' || i.content_id) AS typed_id,
    ARRAY[('idea:' || i.content_id)]::text[] AS path,
    NULL::text AS edge_type,
    NULL::text AS edge_from_typed,
    NULL::text AS edge_to_typed,
    NULL::text AS edge_from_id,
    NULL::text AS edge_to_id,
    NULL::text AS role,
    NULL::int AS ordinal
  FROM ideas i
  WHERE i.content_id = $1
  UNION ALL
  SELECT
    w.depth + 1,
    step.node_type,
    step.node_id,
    step.typed_id,
    w.path || step.typed_id,
    step.edge_type,
    step.edge_from_typed,
    step.edge_to_typed,
    step.edge_from_id,
    step.edge_to_id,
    step.role,
    step.ordinal
  FROM walk w
  JOIN LATERAL (
    SELECT
      'construction'::text AS node_type,
      c.content_id AS node_id,
      ('construction:' || c.content_id) AS typed_id,
      'input'::text AS edge_type,
      w.typed_id AS edge_from_typed,
      ('construction:' || c.content_id) AS edge_to_typed,
      w.node_id AS edge_from_id,
      c.content_id AS edge_to_id,
      ci.role AS role,
      ci.ordinal AS ordinal
    FROM construction_inputs ci
    JOIN constructions c ON c.content_id = ci.construction_id
    WHERE w.node_type = 'idea'
      AND ci.input_idea_id = w.node_id
      AND ($3 = 'both' OR $3 = 'out')

    UNION ALL
    SELECT
      'idea'::text AS node_type,
      i.content_id AS node_id,
      ('idea:' || i.content_id) AS typed_id,
      'output'::text AS edge_type,
      w.typed_id AS edge_from_typed,
      ('idea:' || i.content_id) AS edge_to_typed,
      w.node_id AS edge_from_id,
      i.content_id AS edge_to_id,
      NULL::text AS role,
      NULL::int AS ordinal
    FROM construction_outputs co
    JOIN ideas i ON i.content_id = co.output_idea_id
    WHERE w.node_type = 'construction'
      AND co.construction_id = w.node_id
      AND ($3 = 'both' OR $3 = 'out')

    UNION ALL
    SELECT
      'construction'::text AS node_type,
      c.content_id AS node_id,
      ('construction:' || c.content_id) AS typed_id,
      'output'::text AS edge_type,
      ('construction:' || c.content_id) AS edge_from_typed,
      w.typed_id AS edge_to_typed,
      c.content_id AS edge_from_id,
      w.node_id AS edge_to_id,
      NULL::text AS role,
      NULL::int AS ordinal
    FROM construction_outputs co
    JOIN constructions c ON c.content_id = co.construction_id
    WHERE w.node_type = 'idea'
      AND co.output_idea_id = w.node_id
      AND ($3 = 'both' OR $3 = 'in')

    UNION ALL
    SELECT
      'idea'::text AS node_type,
      i.content_id AS node_id,
      ('idea:' || i.content_id) AS typed_id,
      'input'::text AS edge_type,
      ('idea:' || i.content_id) AS edge_from_typed,
      w.typed_id AS edge_to_typed,
      i.content_id AS edge_from_id,
      w.node_id AS edge_to_id,
      ci.role AS role,
      ci.ordinal AS ordinal
    FROM construction_inputs ci
    JOIN ideas i ON i.content_id = ci.input_idea_id
    WHERE w.node_type = 'construction'
      AND ci.construction_id = w.node_id
      AND ($3 = 'both' OR $3 = 'in')
  ) AS step ON true
  WHERE w.depth < $2
    AND NOT step.typed_id = ANY(w.path)
)
`

export const NEIGHBORHOOD_NODES_SQL = `
${NEIGHBORHOOD_WALK_CTE}
SELECT
  n.node_type,
  n.node_id,
  n.depth,
  n.title,
  n.operator,
  n.created_at,
  n.created_at_key
FROM (
  SELECT
    n.node_type,
    n.node_id,
    n.depth,
    i.title,
    c.operator,
    COALESCE(i.created_at, c.created_at) AS created_at,
    COALESCE(COALESCE(i.created_at, c.created_at), 'infinity') AS created_at_key
  FROM (
    SELECT node_type, node_id, MIN(depth) AS depth
    FROM walk
    GROUP BY node_type, node_id
  ) n
  LEFT JOIN ideas i ON n.node_type = 'idea' AND i.content_id = n.node_id
  LEFT JOIN constructions c ON n.node_type = 'construction' AND c.content_id = n.node_id
) n
WHERE ($4::int IS NULL OR (depth, node_type, created_at_key, node_id) > ($4::int, $5::text, $6::timestamptz, $7::text))
ORDER BY depth ASC, node_type ASC, created_at_key ASC, node_id ASC
LIMIT $8
`

export const NEIGHBORHOOD_EDGES_SQL = `
${NEIGHBORHOOD_WALK_CTE}
SELECT
  e.edge_type,
  e.edge_from_typed,
  e.edge_to_typed,
  e.role,
  e.ordinal,
  e.depth,
  e.ordinal_key
FROM (
  SELECT
    edge_type,
    edge_from_typed,
    edge_to_typed,
    role,
    ordinal,
    MIN(depth) AS depth,
    COALESCE(ordinal, -1) AS ordinal_key
  FROM walk
  WHERE edge_type IS NOT NULL
  GROUP BY edge_type, edge_from_typed, edge_to_typed, role, ordinal
) e
WHERE ($4::int IS NULL OR (depth, edge_type, edge_from_typed, edge_to_typed, ordinal_key) > ($4::int, $5::text, $6::text, $7::text, $8::int))
ORDER BY depth ASC, edge_type ASC, edge_from_typed ASC, edge_to_typed ASC, ordinal_key ASC
LIMIT $9
`

export const CLAIM_BUNDLE_SQL = `
SELECT
  c.content_id AS claim_id,
  c.claim_text,
  c.created_at AS claim_created_at,
  e.content_id AS evidence_id,
  e.stance,
  e.locator,
  e.created_at AS evidence_created_at
FROM claims c
LEFT JOIN evidence e ON e.claim_id = c.content_id
WHERE c.about_type = $1 AND c.about_id = $2
ORDER BY c.created_at ASC, c.content_id ASC, e.created_at ASC, e.content_id ASC
`
