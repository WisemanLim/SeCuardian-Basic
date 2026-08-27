# SeCuardian-Basic — Multi-AI Agent Systems 기술·시장 동향 조사 (Survey)

> 작성일: 2026-08-27 / v0.1 / 목적: [SeCuardian-Basic-PRD.md](SeCuardian-Basic-PRD.md) 의 B-2(스택)·B-3(하드웨어/배치)·B-4(NFR)·B-10(규제) 근거
> 조사 방법: WebSearch/WebFetch(2026-08-27) — 1차 출처(GitHub·HF 모델카드·arXiv·규제기관) 우선, 2차 출처(벤더 블로그)는 교차 검증. 근사치·미검증 값은 **(확인 필요)** 표기.
> 구조는 `eden-MultiAIAgent/MAS-Basic/.docs/MAS-Basic.Survey.md` 를 미러링하되 보안(SIEM/SOAR/DFIR/AI Red Team/가드레일/보안 특화 LLM) 축으로 항목 교체.
> 관련 내부 조사: `SeCuardian-Marketplace/.docs/extra-agents/` (ADDON-AGENTS.md, Perplexity-Local LLM·HuggingFace 보안 모델·multi_agent_registry_blueprint 등)


---

## §1 개요 / 조사 범위

### 1.1 배경
- 2025~2026년 사이 LLM Agent 는 "단일 어시스턴트" 에서 **다중 에이전트 협업(MAS)** 과 **에이전트 패키지 배포 생태계** 로 무게중심이 이동했다. Gartner 2026 Security Operations Hype Cycle 은 *AI SOC Agents* 를 2025 Innovation Trigger → 2026 Peak of Inflated Expectations 로 올렸으며 시장 침투율은 1~5% 수준으로 본다 ([Dropzone](https://www.dropzone.ai/blog/gartner-hype-cycle-security-operations-2026), [Simbian](https://simbian.ai/blog/gartner-hype-cycle-security-operations-2026-ai-soc-agents)).
- 상호운용 표준은 MCP(도구) + A2A(에이전트 간) 가 Linux Foundation **Agentic AI Foundation(AAIF)** 산하로 통합되며 사실상 수렴했다 ([Forbes 2026-08-19](https://www.forbes.com/sites/janakirammsv/2026/08/19/agent2agent-joins-the-agentic-ai-foundation-alongside-mcp/)).
- 패키징은 2026-08-06 **Agent Plugins 1.0** (OpenAI·Microsoft·AWS·GitHub·Cursor·Vercel 합의) 으로 표준화가 시작됐다 ([blakecrosley](https://blakecrosley.com/blog/agent-plugins-standard)).
- 반면 공급망 공격(ClawHub 1,184개 악성 Skill, MCP tool poisoning, postmark-mcp 백도어) 이 현실화되어 **Agent 런타임 보안** 이 설계의 1급 요구사항이 됐다 ([Unit42](https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/), [CSA](https://labs.cloudsecurityalliance.org/research/csa-research-note-mcp-tool-poisoning-ai-agent-exfiltration-2/)).

### 1.2 조사 범위
| 항목 | 범위 |
|---|---|
| (a) 패키징·마켓플레이스 | Claude Code Plugins/Agent Skills, Agent Plugins 1.0, AWS/Salesforce/Microsoft/Google 마켓, ClawHub |
| (b) 보안 도메인 Agent | AI SOC, agentic pentest, SIEM/SOAR·MCP 연동, DFIR Agent |
| (c) 프로토콜 | MCP, A2A, AG-UI, ACP(IBM→A2A 병합), AGNTCY |
| (d) 런타임 보안 | 샌드박싱, 프롬프트 인젝션, 패키지 공급망, OWASP Agentic/LLM Top 10, NIST AI RMF, EU AI Act, 韓 AI 기본법, KISA 레드티밍 가이드 |
| (e) 인프라 | on-prem/private/public/hybrid, GPU 사이징, vLLM/Ollama/MLX/SGLang, 한국어·보안 특화 LLM |
| (f)(g) 레퍼런스 | GitHub 오픈소스 20종+, arXiv 2024~2026 논문 |

### 1.3 조사 방법
웹 검색(2026-08-27) + 1차 출처(GitHub README, Hugging Face 모델카드, arXiv, 규제기관 공고) 우선. 2차 출처(벤더 블로그) 는 교차 검증 후 인용.

---

## §2 프레임워크·런타임 동향

### 2.1 오픈소스 프레임워크
| 프레임워크 | 2026 상태 | 비고 |
|---|---|---|
| LangGraph | 2026 초 GitHub 스타에서 CrewAI 추월, 체크포인트·감사추적·롤백으로 프로덕션 1순위 | [alicelabs](https://alicelabs.ai/en/insights/best-ai-agent-frameworks-2026), [pecollective](https://pecollective.com/blog/ai-agent-frameworks-compared/) |
| CrewAI | 빠른 프로토타이핑, 선형 워크플로우에 적합 | [gurusup](https://gurusup.com/blog/best-multi-agent-frameworks-2026) |
| AutoGen → Microsoft Agent Framework 1.0 | 2026-04-03 Semantic Kernel + AutoGen 병합, AutoGen 은 유지보수 모드 | [qubittool](https://qubittool.com/blog/ai-agent-framework-comparison-2026) |
| OpenAI Agents SDK | Swarm 후속, 샌드박스 실행·하네스 시스템 내장 | [qubittool](https://qubittool.com/blog/ai-agent-framework-comparison-2026) |
| Claude Agent SDK | Claude Code 에서 추출된 범용 SDK | [fungies](https://fungies.io/ai-agent-frameworks-comparison-2026-langchain-crewai-autogen/) |
| Google ADK / HF smolagents / AWS Strands | 2025~26 신규 진입 | [medium ATNO](https://medium.com/@atnoforgenai/10-ai-agent-frameworks-you-should-know-in-2026-langgraph-crewai-autogen-more-2e0be4055556) |
| TrueForge (truefoundry) | MIT, "벤더 중립 Agent Harness" — BYO 모델·MCP·샌드박스 | [GitHub](https://github.com/truefoundry/trueforge) |

### 2.2 런타임(하네스) 계층의 분리
- 2026년 관찰되는 패턴은 **"프레임워크(오케스트레이션 그래프)"** 와 **"하네스(런타임: 도구 호출·샌드박스·권한·관측)"** 의 분리다. TrueForge 가 Claude Managed Agents 대안으로 포지셔닝된 것이 대표 사례 ([AI Weekly](https://aiweekly.co/alerts/truefoundry-open-sources-trueforge-a-claude-agents-rival)).
- 라우팅 계층도 독립화: LLMRouter(UIUC) 는 16종+ 라우터(single/multi-round, agentic, personalized) 를 라이브러리로 제공 ([GitHub](https://github.com/ulab-uiuc/LLMRouter)).

### 2.3 MAS 실패 양상(설계 교훈)
- "Why Do Multi-Agent LLM Systems Fail?"(Cemri et al., 2025) 은 150개 트레이스에서 14개 실패 모드를 도출, **시스템 설계·에이전트 간 불일치·검증 부재** 3범주로 분류 ([arXiv 2503.13657](https://arxiv.org/abs/2503.13657)).
- 오케스트레이션 서베이(2023~2026 초) 는 중앙집중·분산·계층형 3토폴로지 + 적응성 축을 제안하고, 캐스케이딩 오류를 주요 병목으로 지목 ([MDPI Future Internet 18(6):326](https://www.mdpi.com/1999-5903/18/6/326)).
- 절차적 과업에서는 in-context prompting 이 오케스트레이션을 대체할 수 있다는 반론도 등장 ([arXiv 2604.27891](https://arxiv.org/pdf/2604.27891)) → **에이전트 수를 늘리는 것 자체가 목적이 되어선 안 됨.**

---

## §3 프로토콜·상호운용

### 3.1 계층별 표준 지도
| 계층 | 표준 | 거버넌스 | 상태(2026-08) |
|---|---|---|---|
| Agent ↔ Tool/Data | **MCP** | LF AAIF | 커뮤니티 인덱스 서버 18,000+ (확인 필요) ([Zylos](https://zylos.ai/research/2026-03-26-agent-interoperability-protocols-mcp-a2a-acp-convergence/)) |
| Agent ↔ Agent | **A2A v1.0** (2026-03) | LF → AAIF 합류(2026-08) | 150+ 조직, 다중 프로토콜 바인딩·버전 협상·멀티테넌시·**서명된 Agent Card** ([PRNewswire](https://www.prnewswire.com/news-releases/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year-302737641.html), [Wikipedia](https://en.wikipedia.org/wiki/Agent2Agent)) |
| Agent ↔ User(UI) | **AG-UI** | CopilotKit 주도 | 이벤트 스트림 기반 프론트 연동 ([HackerNoon](https://hackernoon.com/a-formal-analysis-of-agentic-ai-protocols-a2a-acp-and-agui)) |
| Agent ↔ Agent (REST) | **ACP** (IBM BeeAI) | LF | **2025-08-29 A2A 에 병합, 저장소 아카이브** ([Ry Walker](https://rywalker.com/research/agent-coordination-protocols), [IBM](https://www.ibm.com/think/topics/agent-communication-protocol)) |
| 디스커버리·ID·관측 | **AGNTCY** (Cisco 등) | LF (2025-07 기부) | 하부 인프라 계층 ([Prompt20](https://blog.prompt20.com/posts/ai-agent-protocols/)) |
| Agent ↔ Editor | Zed ACP(Agent Client Protocol) | Zed | IDE 통합 ([Prompt20](https://blog.prompt20.com/posts/ai-agent-protocols/)) |

### 3.2 시사점
- ACP(IBM) 는 소멸했으므로 신규 설계는 **MCP + A2A** 만 1급 지원, AG-UI 는 콘솔 UI 계층 선택지.
- A2A v1.0 의 서명된 Agent Card 는 마켓플레이스 신뢰 체계(§4)·공급망 보안(§6.4) 과 직접 연결된다.
- 프로토콜 의미론 연구(시맨틱 뷰, 형식 분석) 가 2026년 활발 ([arXiv 2604.02369](https://arxiv.org/pdf/2604.02369), [arXiv 2606.19135](https://arxiv.org/pdf/2606.19135)).

---

## §4 마켓플레이스·패키징·배포 생태계

### 4.1 패키징 표준
| 표준/포맷 | 내용 | 출처 |
|---|---|---|
| Agent Skills (agentskills.io) | `SKILL.md` 중심 재사용 지침 패키지, Claude Code·Cursor·Copilot·Codex·Gemini CLI 등 30+ 에이전트 호환 | [netresearch](https://github.com/netresearch/claude-code-marketplace) |
| Claude Code Plugins | skills + agents + hooks + MCP 서버를 **하나의 버전 단위** 로 묶고, marketplace.json 으로 배포 | [hidekazu-konishi](https://hidekazu-konishi.com/entry/claude_code_plugins_complete_guide.html), [thepromptshelf](https://thepromptshelf.dev/blog/claude-code-plugin-marketplace-2026/) |
| **Agent Plugins 1.0** (2026-08-06) | plugin.json 매니페스트로 Skills + MCP 서버를 한 폴더에; OpenAI·MS·AWS·GitHub·Cursor·Vercel 합의. "패키징 표준이지 마켓이 아님". Anthropic 은 파트너 목록에 없으나 Claude Code 로 변환 설치 가능 | [blakecrosley](https://blakecrosley.com/blog/agent-plugins-standard), [agenticskills.io](https://agenticskills.io/learn/what-are-agent-plugins) |

### 4.2 마켓플레이스 지형
| 마켓 | 특징 | 출처 |
|---|---|---|
| Salesforce AgentExchange | 2026-04 AppExchange+Slack+Agentforce 통합, Agentforce 에이전트/서브에이전트/MCP 1,000+ (확인 필요), 파트너 200+ | [MintMCP](https://www.mintmcp.com/blog/ai-agent-marketplaces), [Salesforce PR](https://seekingalpha.com/pr/20022053-salesforce-launches-agentexchange-the-trusted-marketplace-for-agentforce) |
| AWS Marketplace (AI Agents) | 2025-07 Anthropic 과 출범, Agentforce 360 for AWS 2026 초 | [alternativeto](https://alternativeto.net/news/2025/7/aws-to-launch-ai-agent-marketplace-with-anthropic-at-july-summit), [Salesforce](https://www.salesforce.com/news/stories/agentforce-360-for-aws-announcement/) |
| Microsoft Marketplace / Google Agentspace·Gemini Enterprise | 엔터프라이즈 거버넌스 중심 | [Fastio](https://fast.io/resources/top-ai-agent-marketplaces/) |
| ServiceNow AI Marketplace | ITSM 네이티브 | [planetarylabour](https://planetarylabour.com/articles/agentic-ai-enterprise) |
| ClawHub (OpenClaw) | 13,000+ 스킬(2026-02), GitHub 기반 최소 검증 → 2026-01 ClawHavoc 공급망 사고 | [Unit42](https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/) |
| 수익 배분 | 엔터프라이즈 마켓 퍼블리셔 70~80% (확인 필요) | [Groath](https://groath.ai/blog/ai-agent-marketplace) |

### 4.3 배포 패턴
- **패키징 ≠ 배포**: 표준 포맷(Agent Plugins) + 사설 마켓(marketplace.json 저장소) + 서명/검증 파이프라인 조합이 엔터프라이즈 기본형.
- 보안 스킬 컬렉션 사례: `mukul975/Anthropic-Cybersecurity-Skills` 817개 스킬, MITRE ATT&CK/NIST CSF 2.0/ATLAS/D3FEND/NIST AI RMF 매핑, Apache 2.0 ([GitHub](https://github.com/mukul975/Anthropic-Cybersecurity-Skills)).
- 런타임 가드도 플러그인으로 배포: Adrian 은 Claude Code 마켓플레이스 플러그인으로 도구 호출을 실시간 분류·차단 ([GitHub](https://github.com/secureagentics/adrian)).

### 4.4 에이전트 경제 연구
- Magentic Marketplace(MS, 2025-10) 양면 시장 시뮬레이터 ([arXiv 2510.25779](https://arxiv.org/abs/2510.25779)), Agent Bazaar(2026-05) 경제적 정렬 평가 ([arXiv 2605.17698](https://arxiv.org/abs/2605.17698)), When Agent Markets Arrive(2026-04) ([arXiv 2604.06688](https://arxiv.org/html/2604.06688)) — 평판·거버넌스 메커니즘이 마켓 안정성의 핵심으로 정리됨.

---

## §5 보안 도메인 Agent 동향

### 5.1 AI SOC
- Gartner: SOC 워크로드 60% 가 AI 로 이동 전망, 단 침투율 1~5%; "AI washing" 경계·파일럿 검증 권고 ([BleepingComputer](https://www.bleepingcomputer.com/news/security/how-to-evaluate-ai-soc-agents-7-questions-gartner-says-you-should-be-asking/), [nhimg](https://nhimg.org/articles/gartners-2026-security-operations-hype-cycle-and-the-ai-soc-shift/)).
- 구조 변화: SIEM 이 "통합 SOC 플랫폼 + 보안 데이터레이크" 로 분화, XDR 은 플랫폼에 흡수 ([Dropzone](https://www.dropzone.ai/blog/gartner-hype-cycle-security-operations-2026)).
- SIEM(수집·경보)·SOAR(정형 플레이북) 대비 agentic SOC 는 **비정형 시나리오 추론**; 기존 티켓·SIEM 프로세스를 유지하며 얹는 형태가 채택 장벽이 낮음 ([UnderDefense](https://underdefense.com/blog/agentic-soc-platforms/), [D3](https://d3security.com/blog/ai-soc-platforms-2026/)).
- 오픈소스: zhadyz/AI_SOC(Foundation-Sec-8B + Wazuh + TheHive + RAG), beenuar/AiSOC(MIT, alert fusion·purple-team drill), Sec-Link/Argus(Next.js + Django + PostgreSQL) — §7 참조.

### 5.2 SIEM/SOAR ↔ Agent 연동(MCP)
- Elastic 공식 MCP 서버(ES|QL·Kibana 탐지), Microsoft Sentinel MCP 서버(테이블·그래프 데이터, Copilot/Foundry 연동), Splunk 는 커뮤니티 구현; CrowdStrike·SentinelOne·XSOAR 는 미제공(2026 시점) ([ChatForest](https://chatforest.com/guides/mcp-cybersecurity-threat-intelligence/), [guptadeepak](https://guptadeepak.com/tools/top-5-siem-tools-2026/)).
- 오픈소스 SIEM 중 Wazuh 가 가장 활발히 유지되며 on-prem 기본 후보 ([netguardia](https://netguardia.com/security-operations/software-tools/the-2026-siem-landscape-splunk-elastic-chronicle-sentinel-and-the-open-source-challengers/)).
- 위협 인텔 MCP: cve-mcp-server 27도구/21 API(CVE·EPSS·KEV·ATT&CK·Shodan·VT) ([GitHub](https://github.com/mukul975/cve-mcp-server)).

### 5.3 Agentic Pentest / Red Team
- XBOW: 2025-06 HackerOne 미국 리더보드 1위, 1,060+ 취약점, 2026-03 $120M Series C(총 $237M, 확인 필요) ([ironhackers](https://ironhackers.es/en/agentic-red-team-pentestgpt-xbow-2023-2026/), [stingrai](https://www.stingrai.io/blog/xbow-alternatives-2026)).
- 시장은 **하이브리드(사람 검증)** vs **완전 자율** 두 축으로 분화; 39+ 도구 비교 ([appsecsanta](https://appsecsanta.com/research/ai-pentesting-agents-2026)).
- 오픈소스: Strix(36k+ 스타), HexStrike-AI(MCP 서버, 150+ 도구, 12+ 에이전트, MIT, 7.2k+), Decepticon(레드팀 공격체인, 5.3k), open-kritt(코드 취약점 연구), Nettacker(OWASP).
- 연구: LLM 기반 펜테스트 서베이 ([arXiv 2607.02605](https://arxiv.org/pdf/2607.02605)), 디지털 트윈 기반 위험 완화 공격 프레임워크 ([arXiv 2604.22427](https://arxiv.org/pdf/2604.22427)), CTFExplorer 벤치마크 ([arXiv 2602.08023](https://arxiv.org/pdf/2602.08023)).

### 5.4 DFIR Agent
- Velociraptor MCP 서버(SOCFortress) 로 Claude Code 가 아티팩트 작성·플릿 헌팅·타임라인 재구성 수행 ([SOCFortress](https://socfortress.medium.com/introducing-velociraptor-mcp-server-bringing-dfir-and-ai-together-for-smarter-investigations-a5545f347f49), [Medium 2026-07](https://medium.com/@shaddy43/from-alert-to-answer-ai-driven-dfir-with-claude-code-velociraptor-f9680f76cd95)).
- 동일 채널이 남용 사례(MCP compromise) 로도 보고됨 → DFIR 에이전트는 **읽기 전용 기본 + 승인 게이트** 필요 ([System Weakness](https://systemweakness.com/digital-forensics-and-incident-response-velociraptor-mcp-compromise-abuse-case-cd9378113bed)).

### 5.5 Agent 자체를 지키는 보안 도구(Agent Security)
- 런타임 가드: Adrian(도구 호출 실시간 분류), 위협모델링: Agent-Wiz(LangGraph/AutoGen/CrewAI 코드 → 공격면 시각화), 공격 프레임워크: AgentHound("agentic stack 의 BloodHound" — MCP/A2A/게이트웨이 recon·자격증명 탈취·모델 유출 경로 분석) — §7 참조.
- 코드 리뷰 에이전트: anthropics/claude-code-security-review(GitHub Action) ([GitHub](https://github.com/anthropics/claude-code-security-review)).

---

## §6 인프라·하드웨어

### 6.1 GPU 사이징표 (LLM 서빙, 2026)
| 모델 규모 | 정밀도 | 가중치 VRAM | 권장 GPU 구성 | 출처 |
|---|---|---|---|---|
| 8B (Foundation-Sec-8B, Llama-Primus 등) | FP16 / Q4 | ~16GB / ~5GB | RTX 4090/5090 1장, L4 24GB | [localllm.in](https://localllm.in/blog/ollama-vram-requirements-for-local-llms) |
| 30~32B (EXAONE 4.0 32B, HyperCLOVA X SEED 32B) | FP8 / Q4 | ~32GB / ~18GB | RTX 5090 32GB(Q4 여유), L40S 48GB, H100 80GB 1장 | [modelfit](https://modelfit.io/gpu/rtx-5090/) |
| 70B | FP16 | ~140GB | H100 80GB ×2 | [gpu-mart](https://www.gpu-mart.com/guides/self-hosted-llm) |
| 70B | FP8 | ~70GB (idle 71~74GB) | H100 80GB ×1 (KV 캐시 여유 적음) | [Spheron](https://www.spheron.network/blog/vllm-vs-tensorrt-llm-vs-sglang-benchmarks/) |
| 70B | Q4_K_M | ~40GB | RTX 5090 ×2, RTX PRO 6000 96GB ×1 | [willitrunai](https://willitrunai.com/blog/vllm-multi-gpu-setup-guide) |
| 235B MoE (Qwen3 계열 등) | Q4 | ~130GB+ | RTX PRO 6000 Blackwell ×2 (192GB) | [compute-market](https://www.compute-market.com/blog/multi-gpu-local-llm-setup-guide-2026) |
| KV 캐시 | 70B 1시퀀스 ≈ 1.7GB (긴 컨텍스트) → 동시 10사용자 시 가중치보다 큼 | — | 동시성 계획 필수 | [sitepoint](https://www.sitepoint.com/the-2026-definitive-guide-to-running-local-llms-in-production/) |
| Apple Silicon | M3 Ultra 96GB(819GB/s) 가 2026 Mac Studio 상한; 256/512GB 구성 단종 (확인 필요) | — | 소규모 on-prem/에지, 저전력(≤270W) | [InsiderLLM](https://insiderllm.com/guides/m4-max-ultra-local-llms-apple-silicon/) |

> SeCuardian-Basic 기본 사이징 제안: **8B 보안 특화 모델 + 32B 한국어 범용 모델** 을 단일 48~96GB 급 GPU(L40S/RTX PRO 6000) 또는 RTX 5090 ×2 에서 vLLM 으로 동시 서빙 (확인 필요 — 실제 동시 사용자 수·컨텍스트 길이 측정 후 확정).

### 6.2 서빙 스택
| 엔진 | 위치 | 특징 | 출처 |
|---|---|---|---|
| vLLM | 프로덕션 기본 | PagedAttention, TP 설정 용이, 가장 넓은 모델 호환 | [theaiengineer](https://theaiengineer.substack.com/p/vllm-vs-ollama-vs-sglang-vs-tensorrt) |
| SGLang | 프로덕션(공유 프리픽스 多) | RadixAttention 으로 피크 VRAM 최소, 컨텍스트 공유 요청에 우위 — **멀티에이전트의 공통 시스템 프롬프트에 유리** | [Spheron](https://www.spheron.network/blog/vllm-vs-tensorrt-llm-vs-sglang-benchmarks/) |
| TensorRT-LLM | 최저 지연 | 100 동시요청 p95 TTFT 1,280ms vs vLLM 1,450ms; 컴파일 비용·유연성 낮음 | [Spheron](https://www.spheron.network/blog/vllm-vs-tensorrt-llm-vs-sglang-benchmarks/) |
| Ollama | 개발·에지 | 0.19(2026-03) 부터 Apple Silicon 네이티브 MLX 러너 | [codersera](https://codersera.com/blog/mac-as-a-local-llm-server-2026/) |
| MLX-LM / vllm-mlx / LM Studio | Mac 전용 | 통합 메모리 활용 | [codersera](https://codersera.com/blog/apple-silicon-llms-complete-guide-2026/) |
| LLMRouter | 라우팅 | 비용·난이도 기반 모델 선택, agentic router 포함 | [GitHub](https://github.com/ulab-uiuc/LLMRouter) |

**한국어 LLM (오픈 가중치)**
| 모델 | 제공 | 라이선스 | 비고 | 출처 |
|---|---|---|---|---|
| EXAONE 4.0 (32B/1.2B) · K-EXAONE 2.0 | LG AI Research | 4.0 은 자체 NC 라이선스, K-EXAONE 2.0 은 Apache 2.0 (확인 필요) | 2025-07 공개, 국내 sovereign AI 선두 | [GitHub](https://github.com/LG-AI-EXAONE/EXAONE-4.0), [TechTimes](https://www.techtimes.com/articles/322610/20260801/open-source-700b-models-released-two-days-apart-korea-nears-sovereign-ai-elimination-round.htm) |
| HyperCLOVA X SEED Think 32B | NAVER | 자체 모델 라이선스(상업 조건 확인 필요) | 추론 특화, arXiv 기술보고서 | [HF](https://huggingface.co/naver-hyperclovax/HyperCLOVAX-SEED-Think-32B), [arXiv 2601.03286](https://arxiv.org/html/2601.03286v1) |
| Kanana 1.5 / 2 | Kakao | Apache 2.0 계열 (확인 필요) | 경량 한국어 | [Vulcan X-Bench](https://vulcanlab.ai/vulcan-x-bench-korean-llm/) |
| Solar Pro 2 / Solar Open 100B | Upstage | 라이선스 확인 필요 | Frontier LM 리더보드 유일 한국 모델 | [MarkTechPost](https://www.marktechpost.com/2025/08/21/meet-south-koreas-llm-powerhouses-hyperclova-ax-solar-pro-and-more/), [Artificial Analysis](https://artificialanalysis.ai/models/comparisons/hyperclova-x-seed-think-32b-vs-solar-open-100b-reasoning) |
| A.X 4.0 / Mi:dm 2.0 | SKT / KT | 확인 필요 | sovereign AI 경쟁 참여 | [BenchLM](https://benchlm.ai/leaderboards/korean-llm) |

**보안 특화 LLM**
| 모델 | 제공 | 라이선스 | 특징 | 출처 |
|---|---|---|---|---|
| Foundation-Sec-8B (Base/Instruct/Reasoning) | Cisco Foundation AI | Apache 2.0 (Llama 3.1 기반, 확인 필요) | 5.1B 보안 토큰 계속 사전학습, SOC 트리아지·TTP 매핑 | [HF](https://huggingface.co/fdtn-ai/Foundation-Sec-8B), [Cisco](https://blogs.cisco.com/security/foundation-sec-8b-reasoning-first-open-weight-security-reasoning-model) |
| Llama-Primus (Base/Merged/Reasoning) | Trend Micro | MIT(+Llama 3.1 CLA) | Primus 데이터셋, 보안 벤치 +15.88% | [HF](https://huggingface.co/trendmicro-ailab/Llama-Primus-Reasoning), [arXiv 2502.11191](https://arxiv.org/pdf/2502.11191) |
| RedSage | 학계 | 확인 필요 | 보안 제너럴리스트 LLM | [arXiv 2601.22159](https://arxiv.org/pdf/2601.22159) |
| Lily-Cybersecurity-7B | segolilylabs | 확인 필요 | Mistral 7B 기반 보안 채팅(구세대) | (HF 모델카드 확인 필요) |

### 6.3 배치 토폴로지
| 토폴로지 | 적합 상황 | 핵심 구성 | 근거 |
|---|---|---|---|
| **On-prem (완전 폐쇄망)** | 공공·금융·국방, 로그 반출 불가 | Wazuh/Elastic + vLLM(8B 보안 + 32B 한국어) + Firecracker/gVisor 샌드박스 + 사설 marketplace.json | [netguardia](https://netguardia.com/security-operations/software-tools/the-2026-siem-landscape-splunk-elastic-chronicle-sentinel-and-the-open-source-challengers/), [Northflank](https://northflank.com/blog/how-to-sandbox-ai-agents) |
| **Private Cloud / VPC** | 그룹사·MSSP | Kubernetes + vLLM/SGLang, KV 캐시 동시성 설계 | [sitepoint](https://www.sitepoint.com/the-2026-definitive-guide-to-running-local-llms-in-production/) |
| **Public Cloud** | 빠른 PoC, 마켓 배포 | AWS Marketplace/Bedrock, Sentinel MCP, Elastic Cloud | [ChatForest](https://chatforest.com/guides/mcp-cybersecurity-threat-intelligence/) |
| **Hybrid** | 일반 기업 기본형 | 민감 트리아지는 로컬 8B, 심층 추론은 클라우드 프론티어 모델 — LLMRouter 로 라우팅, 데이터 등급별 분기 | [LLMRouter](https://github.com/ulab-uiuc/LLMRouter) |

**샌드박스 계층** (기동 시간·격리 강도):
Docker ~500ms(약) → gVisor ~100ms(유저스페이스 커널, I/O 10~30% 오버헤드) → Firecracker/E2B microVM 100~150ms(전용 커널, VFIO GPU 패스스루, 5~30ms 스냅샷 복원) → Kata Containers. 신뢰불가 코드 실행은 microVM 권고 ([Northflank](https://northflank.com/blog/how-to-sandbox-ai-agents), [Spheron](https://www.spheron.network/blog/ai-agent-code-execution-sandbox-e2b-daytona-firecracker/), [dev.to](https://dev.to/aiagentengineering/how-to-sandbox-ai-agents-in-2026-firecracker-gvisor-runtimes-isolation-strategies-14pk)).

### 6.4 규제 / 컴플라이언스
| 프레임워크 | 핵심 내용 | Agent 설계 시사점 | 출처 |
|---|---|---|---|
| **OWASP Top 10 for Agentic Applications 2026** (ASI01~10) | 프롬프트 인젝션, 불안전한 도구 실행, 과잉 권한, 메모리 오염 등; "HW 격리 샌드박스 없는 코드 실행은 치명적" | 도구별 최소권한, 메모리 무결성, 샌드박스 필수 | [Cycode](https://cycode.com/blog/owasp-top-10-agentic-applications/), [NeuralTrust](https://neuraltrust.ai/blog/owasp-top-10-for-agentic-applications-2026), [Promptfoo](https://www.promptfoo.dev/docs/red-team/owasp-agentic-ai/) |
| **OWASP MCP Top 10** (MCP03:2025 Tool Poisoning) | 도구 설명·스키마·응답 내 적대적 지시, rug pull, tool shadowing; 45+ 실서버 대상 공격 성공률 60%+ | MCP 서버 서명·핀닝·설명문 스캐닝 게이트웨이 | [CSA](https://labs.cloudsecurityalliance.org/research/csa-research-note-mcp-tool-poisoning-ai-agent-exfiltration-2/), [TrueFoundry](https://www.truefoundry.com/blog/blog-mcp-tool-poisoning-gateway-defense), [Checkmarx](https://checkmarx.com/learn/mcp-security-risks-real-world-incidents-and-security-controls/) |
| 실제 사고 | postmark-mcp npm 백도어(2025-09), Miasma 웜 73 repo MCP 설정 오염(2026-06), ClawHavoc 1,184 스킬(2026-01) | 패키지 무결성·SBOM·레지스트리 심사 | [Practical DevSecOps](https://www.practical-devsecops.com/mcp-security-statistics-2026-report/), [CSA 2026-07](https://labs.cloudsecurityalliance.org/research/csa-research-note-mcp-tool-poisoning-auto-execution-20260701/), [Unit42](https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/) |
| **NIST AI RMF** / SP 800-53 AI 오버레이 / CSF AI Profile | 2026-03 기준 개정·오버레이 미완 (확인 필요); ISO 42001 과 통제 중복 | Govern/Map/Measure/Manage 4기능을 에이전트 라이프사이클에 매핑 | [Kodem](https://www.kodemsecurity.com/resources/navigating-2026-ai-risk-regulations) |
| **EU AI Act** | Digital Omnibus(Reg. 2026/1744, 2026-07-27 발효) 로 고위험 의무 Annex III → 2027-12-02, Annex I → 2028-08-02 연기; Art.50 투명성·GPAI 벌칙은 2026-08-02 시행 | 보안 에이전트는 대부분 고위험 아님(확인 필요) 이나 투명성·로그 보존 준수 | [Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/), [digitalapplied](https://www.digitalapplied.com/blog/eu-ai-act-august-2026-transparency-obligations-agency-checklist) |
| **韓 AI 기본법** | 2026-01-22 시행; 고영향 AI 사전 판별·안전성 조치, 생성형 AI 표시(워터마크) 의무 | 사업자 스스로 고영향 여부 판단 문서화, 생성 결과 표시 | [세종·신김](https://www.shinkim.com/kor/media/newsletter/3114), [peekaboolabs](https://peekaboolabs.ai/blog/ai-basic-law-guide) |
| **KISA AI 보안 레드티밍 가이드** | 과기정통부·KISA 발간; 프롬프트 인젝션·탈옥·환각·**에이전트 하이재킹** 대상, 다학제 레드팀 구성·심리 지원 권고 | 릴리스 전 레드팀 절차를 패키지 심사에 포함 | [DigitalToday](https://www.digitaltoday.co.kr/news/articleView.html?idxno=682799) |

---

## §7 참고 프로젝트 (GitHub)

| 이름 | 링크 | 스타/라이선스 | 요약 | SeCuardian-Basic 시사점 |
|---|---|---|---|---|
| zhadyz/AI_SOC | https://github.com/zhadyz/AI_SOC | - / - | Foundation-Sec-8B + Wazuh + TheHive + RAG 멀티에이전트 SOC 연구 구현 | 8B 보안 모델 + 오픈소스 SIEM 조합의 레퍼런스 아키텍처 |
| Sec-Link/Argus-Agentic-SOC-Platform | https://github.com/Sec-Link/Argus-Agentic-SOC-Platform | - / - | Next.js + Django/DRF + PostgreSQL, 알림 수집·조사·티켓·자산 상관·워크플로우 | 콘솔 UI/데이터 모델 참고, AG-UI 적용 후보 |
| beenuar/AiSOC | https://github.com/beenuar/AiSOC | - / MIT | alert fusion, purple-team drill, ATT&CK 조사, 셀프호스팅 | MIT 라이선스로 컴포넌트 재사용 가능 |
| usestrix/strix | https://github.com/usestrix/strix | 36k+ / - (확인 필요) | 동적 실행·PoC 검증하는 자율 AI 펜테스터 | 펜테스트 에이전트 패키지 표준 사례 |
| 0x4m4/hexstrike-ai | https://github.com/0x4m4/hexstrike-ai | 7.2k+ / MIT | 150+ 보안 도구를 MCP 서버로 노출, 12+ 에이전트 | "도구 = MCP 서버" 패키징 모델; 단 권한 통제 필수 |
| PurpleAILAB/Decepticon | https://github.com/PurpleAILAB/Decepticon | 5.3k / - | recon→exploit→privesc→lateral→C2 자율 레드팀 | 오프라인 훈련·퍼플팀 시나리오 |
| Repello-AI/Agent-Wiz | https://github.com/Repello-AI/Agent-Wiz | - / - | LangGraph/AutoGen/CrewAI 에이전트 코드 위협모델링·시각화 CLI | 마켓 등록 전 자동 위협모델 산출물 첨부 |
| secureagentics/Adrian | https://github.com/secureagentics/adrian | - / - | 런타임 도구 호출 감시·차단(프롬프트 인젝션·정책 드리프트), Claude Code 플러그인 | 런타임 가드 계층 설계 참고 |
| adithyan-ak/AgentHound | https://github.com/adithyan-ak/agenthound | - / - | MCP/A2A/게이트웨이 대상 공격경로 분석("agentic BloodHound") | 자체 레드티밍 도구로 채택 |
| mukul975/cve-mcp-server | https://github.com/mukul975/cve-mcp-server | - / - | CVE·EPSS·KEV·ATT&CK·Shodan·VT 27도구 MCP | 위협인텔 MCP 번들 표준 후보 |
| mukul975/Anthropic-Cybersecurity-Skills | https://github.com/mukul975/Anthropic-Cybersecurity-Skills | - / Apache 2.0 | 817 보안 스킬, 6 프레임워크 매핑, agentskills.io 표준 | 스킬 메타데이터(프레임워크 매핑) 스키마 참고 |
| anthropics/claude-code-security-review | https://github.com/anthropics/claude-code-security-review | - / - | PR 보안 리뷰 GitHub Action | CI 단계 에이전트 예시 |
| intelowlproject/IntelOwl | https://github.com/intelowlproject/IntelOwl | - / AGPL(확인 필요) | 대규모 위협인텔 분석기 통합 | MCP 래핑 대상 |
| OWASP/Nettacker | https://github.com/OWASP/Nettacker | - / Apache 2.0(확인 필요) | 자동 펜테스트·취약점 스캐너 | 도구 에이전트화 후보 |
| Kritt-ai/open-kritt | https://github.com/Kritt-ai/open-kritt | - / - | 코드 취약점 연구 에이전트 오케스트레이션, 중복제거·순위화·검증 | 결과 검증(validation) 파이프라인 참고 |
| truefoundry/trueforge | https://github.com/truefoundry/trueforge | - / MIT | 벤더 중립 에이전트 하네스(BYO 모델·MCP·샌드박스) | 런타임 계층 대체/참조 |
| ulab-uiuc/LLMRouter | https://github.com/ulab-uiuc/LLMRouter | - / - | 16+ 라우터 라이브러리 | 하이브리드 배치의 로컬/클라우드 라우팅 |
| netresearch/claude-code-marketplace | https://github.com/netresearch/claude-code-marketplace | - / - | Agent Skills 큐레이션 마켓 예시 | marketplace.json 구조 참고 |
| LG-AI-EXAONE/EXAONE-4.0 | https://github.com/LG-AI-EXAONE/EXAONE-4.0 | - / EXAONE 라이선스 | 한국어 32B 오픈 가중치 | 한국어 범용 모델 후보 |
| fdtn-ai/Foundation-Sec-8B (HF) | https://huggingface.co/fdtn-ai/Foundation-Sec-8B | - / Apache 2.0(확인 필요) | 보안 특화 8B | 트리아지 기본 모델 |
| trendmicro-ailab/Llama-Primus (HF) | https://huggingface.co/trendmicro-ailab/Llama-Primus-Reasoning | - / MIT | 보안 추론 8B | 대안/앙상블 모델 |

---

## §8 논문 / 백서

| 제목 | 저자/기관 | 연도 | 링크 | 요약 | 시사점 |
|---|---|---|---|---|---|
| Why Do Multi-Agent LLM Systems Fail? | Cemri, Pan et al. (UC Berkeley) | 2025 | https://arxiv.org/abs/2503.13657 | 150 트레이스, 14 실패 모드, 3 범주 | 검증 에이전트·명세 강화 |
| LLM-Based Multi-Agent Orchestration: A Survey | MDPI Future Internet | 2026 | https://www.mdpi.com/1999-5903/18/6/326 | 3 토폴로지 + 적응성 분류, 캐스케이딩 오류 | 계층형 오케스트레이터 + 롤백 |
| In-Context Prompting Obsoletes Agent Orchestration for Procedural Tasks | arXiv | 2026 | https://arxiv.org/pdf/2604.27891 | 절차 과업은 단일 컨텍스트가 우월 | 에이전트 분할 최소화 |
| A Survey on Trustworthy LLM Agents: Threats and Countermeasures | arXiv | 2025 | https://arxiv.org/pdf/2503.09648 | 신뢰성 위협·대응 분류 | 위협모델 체크리스트 |
| A Systematic Survey of Security Threats and Defenses in LLM-Based AI Agents: Layered Attack Surface | IEEE Access | 2026 | https://arxiv.org/pdf/2604.23338 | 계층별 공격면 프레임워크 | 계층별 통제 매핑 |
| The Evolution of Agentic AI in Cybersecurity | arXiv | 2025 | https://arxiv.org/pdf/2512.06659 | 단일 추론기→MAS→자율 파이프라인 | AI SOC 단계 로드맵 |
| A Survey of Agentic AI and Cybersecurity | arXiv | 2026 | https://arxiv.org/pdf/2601.05293 | 과제·기회·유즈케이스 프로토타입 | 유즈케이스 우선순위 |
| CORTEX: Collaborative LLM Agents for High-Stakes Alert Triage | arXiv | 2025 | https://arxiv.org/pdf/2510.00311 | 협업 트리아지 에이전트 | 트리아지 파이프라인 설계 |
| A Survey of LLM-Driven Penetration Testing | arXiv | 2026 | https://arxiv.org/pdf/2607.02605 | 펜테스트 MAS 분류·공진화 | 펜테스트 모듈 범위 |
| Automation-Exploit: Digital Twin 기반 위험완화 공격 MAS | arXiv | 2026 | https://arxiv.org/pdf/2604.22427 | 디지털 트윈에서 선검증 후 실행 | 안전한 능동 대응 |
| TrinityGuard: Unified Framework for Safeguarding MAS | arXiv | 2026 | https://arxiv.org/pdf/2603.15408 | MAS 통신 프로토콜 보안·방어 | A2A 메시지 검증 |
| Web Fraud Attacks Against LLM-Driven MAS | arXiv | 2025 | https://arxiv.org/pdf/2509.01211 | 웹 콘텐츠 기반 MAS 사기 공격 | 외부 콘텐츠 신뢰 경계 |
| Towards Secure Agent Skills: Architecture, Threat Taxonomy | arXiv | 2026 | https://arxiv.org/html/2604.02837v1 | 스킬 아키텍처·위협 분류 | 스킬 패키지 심사 기준 |
| Under the Hood of SKILL.md: Semantic Supply-chain Attacks | arXiv | 2026 | https://arxiv.org/html/2605.11418v1 | 코드 미변경·SKILL.md 의미 조작으로 심사 회피 | LLM 기반 의미 심사 + 정적 검사 병행 |
| SkillSieve: Hierarchical Triage for Malicious Skills | arXiv | 2026 | https://arxiv.org/html/2604.06550v1 | 계층형 악성 스킬 탐지 | 마켓 인입 파이프라인 |
| Formal Analysis and Supply Chain Security for Agentic AI Skills | arXiv | 2026 | https://arxiv.org/html/2603.00195v1 | 형식 분석 기반 공급망 | 서명·증명 체계 |
| Benchmarking Security Risk Detection in Open Agentic Skill Ecosystems | arXiv | 2026 | https://arxiv.org/pdf/2606.00925 | 스킬 생태계 위험 탐지 벤치 | 심사기 평가 지표 |
| Security of OpenClaw Agents | arXiv | 2026 | https://arxiv.org/pdf/2605.25435 | OpenClaw 공격·대응 정리 | 개인용 에이전트 위협 모델 |
| AgentRedBench | arXiv | 2026 | https://arxiv.org/pdf/2606.02240 | SaaS 통합 에이전트 동적 레드티밍 | KISA 레드티밍 절차 자동화 |
| Adaptive Evaluation of Out-of-Band Defenses Against Prompt Injection | arXiv | 2026 | https://arxiv.org/pdf/2606.26479 | 대역외 방어 적응 평가 | 방어 평가 방법론 |
| Web Agents Should Adopt the Plan-Then-Execute Paradigm | arXiv | 2026 | https://arxiv.org/pdf/2605.14290 | 계획-실행 분리로 인젝션 완화 | 오케스트레이터 설계 원칙 |
| A Technical Taxonomy of LLM Agent Communication Protocols | arXiv | 2026 | https://arxiv.org/pdf/2606.19135 | MCP/A2A/ACP 등 기술 분류 | 프로토콜 선택 근거 |
| Beyond Message Passing: A Semantic View of Agent Communication Protocols | arXiv | 2026 | https://arxiv.org/pdf/2604.02369 | 의미론 관점 프로토콜 분석 | 메시지 스키마 설계 |
| The Agentic Economy | Rothschild, Mobius, Hofman et al. (MSR) | 2025 | https://arxiv.org/abs/2505.15799 | 에이전트 경제의 마찰 감소 | 마켓 가치 제안 |
| Magentic Marketplace | Microsoft | 2025 | https://arxiv.org/abs/2510.25779 | 양면 에이전트 시장 오픈소스 환경 | 마켓 시뮬레이션 |
| Agent Bazaar: Economic Alignment in Multi-Agent Marketplaces | arXiv | 2026 | https://arxiv.org/abs/2605.17698 | 시장 안정성·무결성 평가 | 평판·거버넌스 설계 |
| When Agent Markets Arrive | arXiv | 2026 | https://arxiv.org/html/2604.06688 | 시장 설계 문제 정리 | 마켓 정책 |
| Formal Mechanisms for Market Stability in Self-Interested Agent Societies | arXiv | 2026 | https://arxiv.org/html/2607.08652v1 | 거버넌스·평판 메커니즘 | 마켓 신뢰 점수 |
| Primus: Open-Source Datasets for Cybersecurity LLM Training | Trend Micro | 2025 | https://arxiv.org/pdf/2502.11191 | 보안 사전학습·지시·추론 데이터셋 | 국내 보안 LLM 파인튜닝 데이터 |
| RedSage: A Cybersecurity Generalist LLM | arXiv | 2026 | https://arxiv.org/pdf/2601.22159 | 보안 제너럴리스트 모델 | 모델 후보 |
| HyperCLOVA X 32B Think (기술보고서) | NAVER | 2026 | https://arxiv.org/html/2601.03286v1 | 한국어 추론 32B | 한국어 모델 후보 |
| LLM-based Agents Suffer from Hallucinations: A Survey | arXiv | 2025 | https://arxiv.org/pdf/2509.18970 | 에이전트 환각 분류 | 근거 제시(citation) 강제 |
| Where LLM Agents Fail and How They Can Learn from Failures | arXiv | 2025 | https://arxiv.org/pdf/2509.25370 | 실패 학습 | 사후 분석 루프 |

---

## §9 SeCuardian-Basic 설계 시사점 요약

1. **프로토콜**: MCP(도구) + A2A v1.0(에이전트 간) 을 1급 지원, ACP(IBM) 는 제외. A2A 서명 Agent Card 를 마켓 신뢰 체계의 기본 ID 로 사용 ([§3](#3-프로토콜상호운용)).
2. **패키징**: Agent Plugins 1.0 / Claude Code Plugin 포맷(plugin.json + SKILL.md + MCP 서버) 을 채택하고, 사설 `marketplace.json` 저장소로 배포. 패키징과 배포(심사·서명) 를 분리 ([§4.1](#41-패키징-표준)).
3. **마켓 인입 심사 파이프라인**: (i) 정적 검사(코드·의존성·SBOM) + (ii) SKILL.md 의미 심사(LLM) + (iii) Agent-Wiz 류 위협모델 자동 생성 + (iv) KISA 레드티밍 가이드 기반 레드팀 체크리스트 + (v) 서명·핀닝. ClawHavoc·postmark-mcp·Miasma 사례가 근거 ([§6.4](#64-규제--컴플라이언스), [§8](#8-논문--백서)).
4. **런타임 가드**: 모든 도구 호출을 정책 엔진(Adrian 유형) 으로 분류, 위험 액션은 승인 게이트; 코드 실행은 Firecracker/gVisor 샌드박스 필수(OWASP ASI). DFIR/대응 에이전트는 읽기 전용 기본 ([§5.4](#54-dfir-agent), [§6.3](#63-배치-토폴로지)).
5. **오케스트레이션**: 계층형(오케스트레이터 → 전문 에이전트) + 검증 에이전트 + 체크포인트/롤백(LangGraph 계열). 에이전트 수 최소화, 절차적 과업은 단일 컨텍스트 처리 ([§2.3](#23-mas-실패-양상설계-교훈)).
6. **모델 전략**: 로컬 Foundation-Sec-8B/Llama-Primus(트리아지·TTP 매핑) + 한국어 32B(EXAONE 4.0 / HyperCLOVA X SEED, 라이선스 확인 필요) 를 vLLM/SGLang 으로 동시 서빙; 심층 추론은 LLMRouter 로 클라우드 라우팅(하이브리드) ([§6.1](#61-gpu-사이징표-llm-서빙-2026), [§6.2](#62-서빙-스택)).
7. **하드웨어 기준안**: 48~96GB 급 단일 GPU(L40S / RTX PRO 6000) 또는 RTX 5090 ×2 를 "Basic" 기준, 70B 이상은 H100 ×2 옵션. KV 캐시 동시성(70B 1시퀀스 ≈1.7GB) 을 사이징에 반영 (확인 필요) ([§6.1](#61-gpu-사이징표-llm-서빙-2026)).
8. **SIEM/SOAR 연동**: Wazuh(on-prem 기본) + Elastic/Sentinel 공식 MCP 서버 + cve-mcp-server 를 표준 MCP 번들로 제공; 기존 티켓·플레이북 프로세스를 대체하지 않고 얹는 방식 ([§5.2](#52-siemsoar--agent-연동mcp)).
9. **컴플라이언스 매핑**: OWASP Agentic Top 10 ↔ NIST AI RMF 4기능 ↔ 韓 AI 기본법(고영향 판별·생성물 표시) ↔ EU AI Act Art.50 투명성 매트릭스를 패키지 메타데이터에 포함 ([§6.4](#64-규제--컴플라이언스)).
10. **자체 레드티밍**: AgentHound·AgentRedBench 유형 도구로 MCP/A2A 공격경로를 릴리스마다 점검 ([§5.5](#55-agent-자체를-지키는-보안-도구agent-security)).

### 미확정·추가 조사 항목
- 한국어 모델별 상업 라이선스 조건(EXAONE 4.0 vs K-EXAONE 2.0, HyperCLOVA X SEED, Solar Open 100B) — 모델카드 원문 확인 필요.
- GitHub 스타 수(대부분 '-'), IntelOwl/Nettacker 라이선스 — 저장소 직접 확인 필요.
- Mac Studio 고용량 구성 단종 여부, XBOW 투자 금액, Salesforce AgentExchange 카탈로그 수치 — 2차 출처만 확보.
- NIST AI RMF 개정·SP 800-53 AI 오버레이의 2026-08 현재 상태.
