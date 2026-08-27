-- secuardian — 기본 시드 데이터 (idempotent, SQLite)

-- R18-7/§20.5 확장: descriptions/agent_names 를 JSON(ko/en/jp 확장형)으로 직접 저자.
-- split description/description_en authoring 폐지 — 레거시 컬럼은 읽기 폴백용 스키마만 유지.
INSERT OR IGNORE INTO tbl_agent_config (agent_key, agent_name, is_enabled, is_required, nav_group, sort_order)
VALUES ('general', 'Orchestrator', 1, 1, '기본 Agent', 0);
UPDATE tbl_agent_config SET agent_name = 'Orchestrator', is_required = 1,
  agent_names = '{"ko": "Orchestrator", "en": "Orchestrator", "jp": "オーケストレーター"}',
  descriptions = '{"ko": "사용자 요청의 의도를 분류하고 적합한 에이전트로 라우팅·합성하는 중앙 오케스트레이터입니다.", "en": "Central orchestrator that classifies user intent and routes/synthesizes responses across the appropriate agents.", "jp": "ユーザー要求の意図を分類し、適切なエージェントへルーティング・統合する中央オーケストレーターです。"}' WHERE agent_key = 'general';

INSERT OR IGNORE INTO tbl_agent_config (agent_key, agent_name, is_enabled, is_required, nav_group, sort_order)
VALUES ('chat', 'AI 어시스턴트', 1, 1, '기본 Agent', 1);
UPDATE tbl_agent_config SET agent_name = 'AI 어시스턴트', is_required = 1,
  agent_names = '{"ko": "AI 어시스턴트", "en": "AI Assistant", "jp": "AIアシスタント"}',
  descriptions = '{"ko": "플랫폼 전반의 질의응답과 데이터 조회·생성·수정·삭제를 수행하는 AI 어시스턴트입니다.", "en": "AI assistant that handles platform-wide Q&A and performs data lookup, creation, update, and deletion.", "jp": "プラットフォーム全般の質疑応答とデータの照会・作成・更新・削除を行うAIアシスタントです。"}' WHERE agent_key = 'chat';

DELETE FROM tbl_agent_config WHERE agent_key IN ('example', 'board');
DELETE FROM tbl_addon_agents WHERE agent_key = 'board';

INSERT OR IGNORE INTO tbl_settings (key, value, description) VALUES
  ('orchestrator_model',  'claude-sonnet-4-6',       'Orchestrator LLM 모델'),
  ('domain_agent_model',  'claude-haiku-4-5-20251001','Domain Agent LLM 모델'),
  ('ollama_base_url',     'http://localhost:11434',    'Ollama 서버 주소'),
  ('ollama_model',        'mistral',                  'Ollama 기본 모델'),
  ('local_llm_provider',  'ollama',                    'R19-1 기본 로컬 LLM provider (ollama|llamacpp|vllm)'),
  ('llamacpp_base_url',   'http://localhost:8180',     'llama.cpp server 주소 (OpenAI 호환)'),
  ('llamacpp_model',      '',                          'llama.cpp 모델명 (단일 모델 서빙 시 생략 가능)'),
  ('vllm_base_url',       'http://localhost:8100',     'vLLM OpenAI 호환 서버 주소'),
  ('vllm_model',          '',                          'vLLM 모델명'),
  ('llm_routes',          '',                          'R19-2 작업별 LLM 라우팅 (JSON: task→provider/model)'),
  ('llm_context_budget',  '8000',                      'R19-4 히스토리 토큰 예산 (초과 시 압축, 0=무압축)'),
  ('llm_tool_max_rounds', '6',                         'AI 어시스턴트 tool-call 최대 루프 횟수 (API 오류 자가수정 재시도 상한)'),
  ('fallback_enabled',    'true',                      'LLM Fallback 활성화'),
  ('setup_completed',     'false',                     'Setup Wizard 완료'),
  ('system_custom_instructions', '',                  '시스템 전체 맞춤지침 (모든 사용자에게 적용)'),
  ('user_custom_instructions',   '',                  '사용자 공통 맞춤지침 (Supervisor가 정의하는 사용자 공통 제약·지침)');
