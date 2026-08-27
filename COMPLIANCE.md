# COMPLIANCE — 정보통신·SaaS (KSIC J)

> 자동 생성. 근거: `domains/ict-saas.yaml` + KSIC 통합표.  
> 규제는 변하므로 하단 **References** 로 재확인 필수.

## 적용 범위 (SeCuardian-Basic)

본 문서는 **순수 코어 런타임**(SeCuardian-Basic)의 `ict-saas` 베이스라인만 다룹니다.
저장소에 보안 도메인 Agent 는 동봉되지 않으며, **Agent 수준 컴플라이언스
(SIEM/DFIR 수집 데이터 등급, ISMS-P 증적, 레드팀 격리 요건 등)는
SeCuardian-Marketplace 에서 설치한 각 Addon 의 매니페스트
(`governance`, `required_env`, `permissions`)와 해당 Agent 문서가 규정**합니다.
코어는 설치 파이프라인에서 sha256 기록·scan_zip 정적 검증·supervisor/admin 전용
설치 권한으로 무결성·접근통제 베이스라인을 제공합니다.

## 분류 / Classification

| 항목 | 값 |
|------|-----|
| KSIC | J (정보통신) |
| ISIC | J |
| NACE | J |
| NAICS | 51 |
| 설명 | 소프트웨어·정보통신·SaaS — 기본 베이스라인 |

## 한국 규제 (1순위)

| 규제명 | 시행/근거 | 영향 |
|--------|----------|------|
| 정보통신망법 | 현행 | 네트워크·정보보호 의무(§47=ISMS 근거), 침해사고 신고 |
| 개인정보보호법(PIPA) | 현행 | PII 동의·최소화·유출통지(§32-2) |
| ISMS-P | 현행 (3년 주기) | 대형 ICT 서비스 의무, 접근로그·변경관리·암호화 증적 |
| CSAP(클라우드) | 2025 온라인 발급 | 공공/정부 클라우드 판매 시 IaaS/SaaS/DaaS 인증 |

## 국제 기준

- SOC 2 Type II (US SaaS, 6~12개월 통제)
- ISO/IEC 27001 (SOC2와 40~85% 통제 중첩)
- GDPR (EU 고객/테넌트)

## 데이터 등급

| 데이터 | 등급 | 주의사항 |
|--------|------|---------|
| 테넌트 데이터 | 민감 | 고객별 격리(RLS/스키마/DB) |
| 고객 PII | 민감 | PIPA/GDPR 적용 |
| 인증/RBAC 토큰 | **규제대상** | **비-프로덕션(dev/staging/test)에 실데이터 반입 금지** |
| 감사로그/텔레메트리 | 내부 | SOC2/ISO 보관·삭제 정책 |

> ⚠️ **`규제대상` 등급 데이터는 dev/staging/test 환경에 실 데이터 반입 금지.**

## 인프라 패턴

- 멀티테넌트 격리 (RLS/스키마/DB-per-tenant)
- 관측성 (OpenTelemetry 콜렉터→티어드 스토리지, 검증된 삭제 CC6.5/A.8.10)
- 피처플래그, API 게이트웨이, 수평 오토스케일, 시크릿 관리
- 표준 CI/CD

## 개발환경 특수 요구

- 테넌트 격리 테스트 (크로스테넌트 누출 단언, RLS 강제)
- 표준 CI/CD (lint/type/test/build/deploy)
- 텔레메트리 보관/삭제 검증 (CC6.5/A.8.10)
- OpenAPI 계약 테스트
- SOC2/ISO 통제 증적 자동화 (접근로그·변경관리)

## 추가 시험 (`test/` 반영)

- 크로스테넌트 데이터 누출 차단 (RLS)
- OpenAPI 계약 적합성 (contract test)
- 감사로그 보관기간 경과 삭제 증명

## References

- [ISMS-P](https://isms-p.or.kr/sysm/intro/selectSysmCertDetail.do)
- [CSAP 2025](https://isms.kisa.or.kr/main/csap/notice/)
- [SOC2 vs ISO27001](https://secureframe.com/blog/soc-2-vs-iso-27001)
- [텔레메트리 보관 (CC6.5/A.8.10)](https://oneuptime.com/blog/post/2026-02-06-telemetry-retention-soc2-iso27001/view)
