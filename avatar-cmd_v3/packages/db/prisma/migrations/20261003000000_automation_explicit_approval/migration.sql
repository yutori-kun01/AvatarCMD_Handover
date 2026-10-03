-- 自動投稿（mode=auto）で自動承認の範囲（approval）が未保存・不正なルールに、これまでの実際の動作である "all" を明示保存する。
-- データの更新のみ（スキーマ変更なし）。戻す必要はない（"all" と未指定は同じ動作）。
UPDATE "automation_rules"
SET "action_config" = jsonb_set("action_config"::jsonb, '{approval}', '"all"'::jsonb)
WHERE "action_type" = 'generate_post'
  AND "action_config"->>'mode' = 'auto'
  AND COALESCE("action_config"->>'approval', '') NOT IN ('all', 'standard', 'strict');
